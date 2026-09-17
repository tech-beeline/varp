/*
	Copyright 2026 VimpelCom PJSC

	Licensed under the Apache License, Version 2.0 (the "License");
	you may not use this file except in compliance with the License.
	You may obtain a copy of the License at

		http://www.apache.org/licenses/LICENSE-2.0

	Unless required by applicable law or agreed to in writing, software
	distributed under the License is distributed on an "AS IS" BASIS,
	WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
	See the License for the specific language governing permissions and
	limitations under the License.
*/

import {
    DefaultScopeProvider, Scope, ReferenceInfo, AstUtils,
    AstNode, LangiumCoreServices, AstNodeDescription, MapScope, WorkspaceCache,
    LangiumDocument, Stream, stream} from 'langium';
import { isModelBlock, isWorkspace, isNamedElement, Workspace, NamedElement, isArchetypeDefinition, isDeploymentEnvironment, isInclude, Include, isC4Document, isGroup, isIdentifiersProperty, isElementExtension } from '../generated/ast';
import { URI } from 'vscode-uri';
import * as includeResolver from './c4-include-resolver';
import { archetypeInstanceTypeByRefText } from './c4-utils';

/**
 * Custom scope provider for C4 DSL that implements:
 * - Hierarchical (FQN-based) and flat identifier resolution for !identifiers style
 * - Suffix alias scoping: shorter name suffixes are visible in ancestor scopes
 * - Cross-file reference resolution via !include and extendsUri
 * - 'this' keyword resolution for sourceThis/targetThis in relationships
 */
/**
 * Per-document package of the LOCAL scope: FQN/name descriptions for all named elements
 * under a scope-traversal root plus the suffix-alias map for ancestor scopes. The package
 * is a constant of the root (it does not depend on the referencing context), so it is cached
 * per root node and reused by every reference resolution within a single build (WorkspaceCache
 * is cleared on document update).
 */
interface LocalScopePackage {
    localDescriptions: AstNodeDescription[];
    suffixAliasesByScope: Map<AstNode, AstNodeDescription[]>;
}

/**
 * Descriptions whose `name` is an identifier (left-hand side of `X = ...` or an
 * `!element` id), as opposed to an element's `name` (right-hand side). Identifier
 * lookup is case-insensitive (matches Structurizr DSL: IdentifiersRegister uses
 * equalsIgnoreCase), while name-based lookup stays case-sensitive (Structurizr
 * Model.getSoftwareSystemWithName uses equals). We tag the identifier descriptions
 * so a case-insensitive fallback can be applied to them without weakening name
 * lookups.
 */
const IDENTIFIER_DESCRIPTION_TAG = Symbol('c4IdentifierDescription');

/**
 * Per-document identifier-style regions: a base region at offset -1 (inherited
 * from the extendsUri chain) plus one region per !identifiers directive, sorted
 * by CST offset. An element's style is the region with the greatest offset not
 * exceeding the element's own CST offset.
 */
interface StyleRegions {
    regions: { offset: number; hierarchical: boolean }[];
}

/**
 * Reference type names that must be resolved through the custom C4 scope
 * provider.
 *
 * The check is done via reflection.getReferenceType(context), which returns
 * the DECLARED reference type verbatim (it does NOT expand unions). So both
 * are required:
 *  - the union aliases 'NamedElement' / 'RelationshipMember' - for the many
 *    references declared as [NamedElement:...] / [RelationshipMember:...];
 *  - the concrete member type names - for references declared with a concrete
 *    type (e.g. [SoftwareSystem:...], [ArchetypeDefinition:...]).
 *
 * Using the declared type instead of a hard-coded property-name list keeps the
 * provider in sync with the grammar and lets non-element references fall back
 * to DefaultScopeProvider.
 */
const ELEMENT_REFERENCE_TYPES = new Set([
    // Union aliases declared in the grammar
    'NamedElement',
    'RelationshipMember',
    // Concrete members of the NamedElement union
    'Person',
    'SoftwareSystem',
    'Container',
    'Component',
    'DeploymentNode',
    'InfrastructureNode',
    'SoftwareSystemInstance',
    'ContainerInstance',
    'GenericInstance',
    'Relationship',
    'ElementExtension',
    'ArchetypeInstance',
    'ArchetypeDefinition',
    'CustomElement',
    'Group',
    'DeploymentGroup',
    'DeploymentEnvironment'
]);

/**
 * Case-insensitive wrapper for a scope chain that targets identifiers only.
 *
 * Structurizr DSL resolves element/relationship identifiers case-insensitively
 * (IdentifiersRegister.getElement uses String.equalsIgnoreCase, and
 * DslContext.getElement lowercases the identifier before lookup), while
 * NAME-based references stay case-sensitive (Model.getSoftwareSystemWithName
 * uses String.equals). So a plain `caseInsensitive` MapScope/StreamScope would
 * be too aggressive - it would also weaken name lookups.
 *
 * This wrapper delegates to the wrapped scope chain and only when the exact
 * lookup misses does it do a case-insensitive fallback, restricted to
 * descriptions that represent identifiers (tagged with
 * IDENTIFIER_DESCRIPTION_TAG). It honours the chain's priority order: a hit in
 * an inner scope shadows the same (case-variant) name in an outer scope.
 */
class CaseInsensitiveIdentifierScope implements Scope {
    private readonly wrapped: Scope;
    private readonly identifierDescriptions: AstNodeDescription[];

    constructor(wrapped: Scope, taggedDescriptions: Iterable<AstNodeDescription>) {
        this.wrapped = wrapped;
        this.identifierDescriptions = Array.from(taggedDescriptions);
    }

    getElement(name: string): AstNodeDescription | undefined {
        const exact = this.wrapped.getElement(name);
        if (exact) {
            return exact;
        }
        const lower = name.toLowerCase();
        // Fallback restricted to identifier descriptions (exact match also
        // missed, so a lowercased description name or a case-insensitive match
        // would hit here).
        for (const desc of this.identifierDescriptions) {
            if (desc.name.toLowerCase() === lower) {
                return desc;
            }
        }
        return undefined;
    }

    getElements(name: string): Stream<AstNodeDescription> {
        const exacts = this.wrapped.getElements(name).toArray();
        if (exacts.length > 0) {
            return stream(exacts);
        }
        const lower = name.toLowerCase();
        const matches = this.identifierDescriptions.filter((d) => d.name.toLowerCase() === lower);
        return stream(matches);
    }

    getAllElements(): Stream<AstNodeDescription> {
        return this.wrapped.getAllElements();
    }
}

export class C4ScopeProvider extends DefaultScopeProvider {
    protected readonly services: LangiumCoreServices;
    // Cache of identifier-style regions per document (base style inherited from
    // extendsUri + sorted !identifiers directive offsets). Answers an element's
    // style via binary search instead of climbing the container chain per
    // element (O(elements x depth) -> O(log directives)).
    private readonly styleRegionsCache: WorkspaceCache<string, StyleRegions>;
    // Cache for extends-resolved elements to avoid repeated traversal
    private readonly extendedElementsCache: WorkspaceCache<string, AstNodeDescription[]>;
    // Cache of the inherited identifier style per included-fragment URI. Computing
    // it walks the ancestor chain + the parent AST to find the matching !include
    // directive, so the result is memoized per fragment URI (cleared on any
    // workspace change via WorkspaceCache).
    private readonly fragmentStyleCache: WorkspaceCache<string, boolean | undefined>;
    // Per-ancestor-document index: included-target URI -> CST offset of the !include
    // directive. Built once per ancestor document and reused by inheritedIncludeStyle
    // for every fragment.
    private readonly includeTargetOffsetCache: WorkspaceCache<string, Map<string, number>>;
    // Cache for the local element package (FQN/name descriptions + suffix aliases) per
    // root node, built once per root per build (see buildLocalScopePackage) and reused
    // by getScope().
    private readonly localScopeCache: WorkspaceCache<string, LocalScopePackage>;

    constructor(services: LangiumCoreServices) {
        super(services);
        this.services = services;

        // Initialize caches. Automatically cleared on ANY project change via WorkspaceCache.
        this.styleRegionsCache = new WorkspaceCache<string, StyleRegions>(services.shared);
        this.extendedElementsCache = new WorkspaceCache<string, AstNodeDescription[]>(services.shared);
        this.fragmentStyleCache = new WorkspaceCache<string, boolean | undefined>(services.shared);
        this.includeTargetOffsetCache = new WorkspaceCache<string, Map<string, number>>(services.shared);
        this.localScopeCache = new WorkspaceCache<string, LocalScopePackage>(services.shared);
    }

    /**
     * Recursively climbs the AST $container chain to find the nearest enclosing NamedElement
     * (System, Container, Component, etc.). Used for 'this' resolution in sourceThis/targetThis.
     */
    private findNearestNamedElement(node: AstNode | undefined): NamedElement | undefined {
        let current = node;
        while (current) {
            if (isNamedElement(current)) {
                return current;
            }
            current = current.$container;
        }
        return undefined;
    }

    /**
     * Exports element descriptions for the scope system.
     *
     * Each element is registered in up to three ways to support different reference styles:
     *
     * 1. **By ID (FQN or flat)**:
     *    - In **hierarchical mode** (`!identifiers hierarchical`): the element is registered with its
     *      fully-qualified name (FQN) like `system.container.component`. Additionally, suffix aliases
     *      are created for each ancestor scope so the element can be referenced by a shorter name
     *      from within that ancestor. For example, `myComponent` is visible in its parent Container's
     *      scope, `myContainer.myComponent` in the grandparent SoftwareSystem's scope, etc.
     *    - In **flat mode** (`!identifiers flat`): the element is registered only by its plain id.
     *
     * 2. **By Name**: The element's `name` property is also registered as a separate description.
     *    This enables string-based references like `environment="Live"` where the value is matched
     *    against element names rather than IDs.
     *
     * The `suffixAliasesByScope` map accumulates suffix aliases across all elements. After all
     * elements are processed, these aliases are used to build the chained scope hierarchy
     * (see getScope() step 4).
     *
     * @param element The AST element to create descriptions for
     * @param document The document containing the element
     * @param isHierarchical Whether to use hierarchical (FQN) or flat naming
     * @param suffixAliasesByScope Optional map to collect suffix aliases per ancestor scope
     * @returns Array of AstNodeDescription for the element
     */
    /**
     * Returns true when `node` sits inside an `!element` (ElementExtension)
     * container chain. Elements contributed via an ElementExtension body are
     * namespaced by the extension's own id (e.g. `ENS` inside `!element ENSEMBLE`
     * resolves as `ENSEMBLE.ENS`), so they must be exposed with that FQN prefix.
     */
    private hasElementExtensionAncestor(node: AstNode | undefined): boolean {
        let current = node;
        while (current) {
            if (isElementExtension(current)) {
                return true;
            }
            current = current.$container;
        }
        return false;
    }

    private exportElementDescriptions(
        element: AstNode,
        document: LangiumDocument,
        isHierarchical: boolean,
        suffixAliasesByScope?: Map<AstNode, AstNodeDescription[]>
    ): AstNodeDescription[] {
        const descriptions: AstNodeDescription[] = [];

        let elementId = (element as any).id;
        if (!elementId && isArchetypeDefinition(element)) {
            elementId = (element as any).name;
        }
        const elementName = (element as any).name;

        // 1. Register by ID (if present)
        if (elementId) {
            if (isHierarchical) {
                // Build FQN: [ancestor_n, ..., parent, elementId]
                const parts = this.calculateHierarchicalParts(element, elementId);
                const fqn = parts.join('.');
                const fqnDesc = this.services.workspace.AstNodeDescriptionProvider.createDescription(element, fqn, document);
                // Tag as identifier: FQN lookup is case-insensitive (Structurizr's
                // IdentifiersRegister.getElement uses equalsIgnoreCase).
                (fqnDesc as any)[IDENTIFIER_DESCRIPTION_TAG] = true;
                descriptions.push(fqnDesc);

                // Create suffix aliases for ancestor scopes.
                // k=1: suffix=elementId — visible in immediate parent scope
                // k=2: suffix="parent.elementId" — visible in grandparent scope
                // ... and so on up the chain.
                if (suffixAliasesByScope) {
                    const ancestors = this.collectHierarchicalAncestors(element);
                    for (let k = 1; k < parts.length; k++) {
                        const suffix = parts.slice(parts.length - k).join('.');
                        const scopeOwner = ancestors[k - 1];
                        if (!scopeOwner) break;
                        const list = suffixAliasesByScope.get(scopeOwner) ?? [];
                        const aliasDesc = { ...fqnDesc, name: suffix };
                        (aliasDesc as any)[IDENTIFIER_DESCRIPTION_TAG] = true;
                        list.push(aliasDesc);
                        suffixAliasesByScope.set(scopeOwner, list);
                    }
                }
            } else {
                // Flat mode: just use the bare ID
                const fqnDesc = this.services.workspace.AstNodeDescriptionProvider.createDescription(element, elementId, document);
                (fqnDesc as any)[IDENTIFIER_DESCRIPTION_TAG] = true;
                descriptions.push(fqnDesc);

                // Elements nested inside an `!element` (ElementExtension) are
                // additionally registered under their FULL hierarchical path
                // (e.g. ENSEMBLE.ENS) because the !element id acts as a
                // namespace prefix that must resolve even in flat mode.
                // This makes `ENSEMBLE.ENS -> CCBO` (added via a !element)
                // resolvable regardless of the document's identifier style.
                if (this.hasElementExtensionAncestor(element)) {
                    const parts = this.calculateHierarchicalParts(element, elementId);
                    if (parts.length > 1) {
                        const fqn = parts.join('.');
                        const fqnExt = this.services.workspace.AstNodeDescriptionProvider.createDescription(element, fqn, document);
                        (fqnExt as any)[IDENTIFIER_DESCRIPTION_TAG] = true;
                        descriptions.push(fqnExt);
                    }
                }
            }
        }

        // 2. Register by Name (for string-based references like environment="Live")
        if (elementName && elementName !== elementId) {
            descriptions.push(this.services.workspace.AstNodeDescriptionProvider.createDescription(element, elementName, document));
        }

        return descriptions;
    }

    /**
     * Builds a hierarchical path as an array of parts: [root_id, ..., parent_id, elementId].
     * Only NamedElement containers with id or name participate. Groups (Group) are skipped
     * as they are visual only and don't affect hierarchical identifiers.
     */
    private calculateHierarchicalParts(node: AstNode, nodeId: string): string[] {
        const parts: string[] = [nodeId];
        let current = node.$container;
        while (current) {
            const parentId = (current as any).id || (current as any).name;
            if (parentId && isNamedElement(current) && !isGroup(current)) {
                parts.unshift(parentId);
            }
            current = current.$container;
        }
        return parts;
    }

    /**
     * Returns the chain of hierarchical ancestors: [parent, grandparent, ...].
     * Each ancestor is a NamedElement with id or name. Groups are skipped.
     */
    private collectHierarchicalAncestors(node: AstNode): AstNode[] {
        const ancestors: AstNode[] = [];
        let current = node.$container;
        while (current) {
            const parentId = (current as any).id || (current as any).name;
            if (parentId && isNamedElement(current) && !isGroup(current)) {
                ancestors.push(current);
            }
            current = current.$container;
        }
        return ancestors;
    }

    /**
     * Main scope computation override — the core of C4 DSL name resolution.
     *
     * How scope resolution works:
     *
     * 1. **'this' keyword** (`sourceThis`/`targetThis` in relationships):
     *    Resolves to the nearest enclosing NamedElement (e.g., a Container inside which
     *    the relationship is defined). This allows `this -> anotherElement` syntax.
     *
     * 2. **NamedElement references** (element IDs, names, environment refs):
     *    Builds a multi-layered scope chain from three sources:
     *
     *    a) **!include files**: Elements from included files are collected recursively.
     *       They are registered with global FQN only (e.g., `system.container.component`)
     *       without local shortcut aliases, since external files shouldn't pollute
     *       the local naming scope with short names.
     *
     *    b) **extendsUri chain**: Elements from parent workspaces (via workspace extension)
     *       are resolved similarly — global FQN only, recursively following the chain.
     *       Results are cached via extendedElementsCache to avoid repeated traversal.
     *
     *    c) **Local elements**: Direct children of the workspace/model are collected with
     *       full hierarchical naming support. Each element is registered as:
     *       - FQN (e.g., `my-system.my-container.my-component`) for global reference
     *       - Suffix aliases (e.g., `my-component` in parent's scope, `my-container.my-component`
     *         in grandparent's scope) for convenient shorthand references
     *       - Plain name as fallback for string-based refs like environment="Live"
     *
     * 3. **Scope chaining**: Creates a chain of MapScopes from root to the nearest enclosing
     *    NamedElement. When a reference is resolved, Langium searches innermost scope first,
     *    then works outward. This means local names (suffix aliases) take priority over
     *    global FQN names when there's a conflict.
     *
     * 4. **Fallback**: For non-NamedElement references (keywords, properties, etc.),
     *    delegates to DefaultScopeProvider.getScope().
     *
     * @param context ReferenceInfo describing what property of which AST node is being resolved
     * @returns A Scope object containing all eligible element descriptions
     */
    override getScope(context: ReferenceInfo): Scope {
        
        // Handle 'this' keyword for sourceThis/targetThis in relationships
        if (context.property === 'targetThis' || context.property === 'sourceThis') {
            const currentContainer = this.findNearestNamedElement(context.container);
            if (currentContainer) {
                return new MapScope([this.descriptions.createDescription(currentContainer, 'this')]);
            }
        }

        // Check whether this reference targets a C4 named element by its
        // DECLARED TYPE (see ELEMENT_REFERENCE_TYPES above), instead of a
        // hard-coded property-name list.
        const referenceType = this.reflection.getReferenceType(context);
        const isElementRef = ELEMENT_REFERENCE_TYPES.has(referenceType);

        if (isElementRef) {
            // Locate the scope root in a single climb up the container chain,
            // collecting the Workspace, ModelBlock and C4Document ancestors.
            //
            // The nesting order is C4Document > Workspace > ModelBlock > element, so the
            // upward walk meets the ModelBlock first, then the Workspace, then the
            // C4Document; it stops early once both are known, since the C4Document is
            // only needed when neither exists (see the root rule below).
            let workspace: Workspace | undefined;
            let model: AstNode | undefined;
            let document: AstNode | undefined;
            let cur: AstNode | undefined = context.container;
            while (cur) {
                if (!model && isModelBlock(cur)) model = cur;
                else if (!workspace && isWorkspace(cur)) workspace = cur;
                else if (!document && isC4Document(cur)) document = cur;
                if (model && workspace) break;
                cur = cur.$container;
            }
            // Determine the root for scope traversal: start from ModelBlock if inside one,
            // otherwise from Workspace, or finally from C4Document
            let root = model || workspace || document;

            // If the reference sits inside an !include fragment (no workspace of
            // its own), its scope must also contain the ROOT workspace that
            // includes it. Otherwise a `!element` declared in the fragment cannot
            // resolve the element it extends (e.g. `!element ENSEMBLE { ... }` in
            // a fragment, where `ENSEMBLE` is declared in the parent file). Climb
            // the include/extends ancestor chain and use the owning workspace as
            // the scope root, so its local elements become visible here.
            if (root && !workspace) {
                const containerDoc = AstUtils.getDocument(context.container);
                if (containerDoc) {
                    const chain = includeResolver.getAncestorChain(this.services.shared, containerDoc.uri.toString());
                    // Walk from the NEAREST ancestor (chain[0]) toward the root, and stop at the
                    // first document that owns a workspace. That workspace is the one that (directly
                    // or via a fragment chain) includes the current reference, so it is the correct
                    // scope root. Its extends-ancestors are pulled in separately by
                    // resolveExtendsRecursive below, which recurses up the whole extendsUri chain.
                    for (let i = 0; i < chain.length; i++) {
                        const ancDoc = this.services.shared.workspace.LangiumDocuments.getDocument(URI.parse(chain[i]));
                        const ancRoot = ancDoc?.parseResult.value;
                        if (!ancRoot) continue;
                        const ancWs = isWorkspace(ancRoot)
                            ? ancRoot
                            : (isC4Document(ancRoot) && ancRoot.workspaces.length > 0 ? ancRoot.workspaces[0] : undefined);
                        if (ancWs) {
                            workspace = ancWs;
                            model = ancWs.modelBlocks[0] ?? undefined;
                            root = model || ancWs;
                            break;
                        }
                    }
                }
            }

            if (root) {
                const globalDescriptions: AstNodeDescription[] = [];

                const currentDoc = AstUtils.getDocument(root);

                // 2. LOAD ELEMENTS FROM EXTENDS (global only, cached; external workspace
                //    elements stay FQN-only - they are not part of the local element tree)
                if (workspace?.extendsUri) {
                    const workspaceUri = AstUtils.getDocument(workspace).uri.toString();
                    const extDescriptions = this.extendedElementsCache.get(workspaceUri, () =>
                        this.resolveExtendsRecursive(workspace, new Set())
                    );
                    globalDescriptions.push(...extDescriptions);
                }

                // 3. Collect local elements with suffix alias scoping, cached per
                // scope root. `root` is the start node of the walk (a ModelBlock, the
                // Workspace or the C4Document), not the AST root, which is always the
                // C4Document. One document can therefore yield different scope roots:
                // inside `model {}` the walk starts at the ModelBlock and sees only the
                // model subtree, while a reference in `views {}` walks from the
                // Workspace and additionally sees view-level ElementExtension
                // (`!element`), Relationship and Group nodes. Since a Workspace may
                // hold several ModelBlocks, the key includes the root node's
                // type/offset; keying by document URI alone would let whichever scope
                // root is cached first serve the other.
                const rootDocUri = currentDoc.uri.toString();
                const rootKey = `${rootDocUri}#${root.$type}@${root.$cstNode?.offset ?? -1}`;
                const pkg = this.localScopeCache.get(rootKey, () => this.buildLocalScopePackage(root));
                globalDescriptions.push(...pkg.localDescriptions);

                const globalScope = this.getGlobalScope(referenceType, context);

                // Name -> ArchetypeDefinition node, built from the descriptions
                // collected for this scope root. Lookups go through `$refText`, not
                // `.ref`, so resolving an `archetype` reference does not re-enter the
                // linker.
                const archetypesByName = new Map<string, AstNode>();
                for (const desc of globalDescriptions) {
                    const node = (desc as any).node as AstNode | undefined;
                    // Accepts ArchetypeDefinition and its ArchetypeNamed subtype.
                    if (!node || !isArchetypeDefinition(node)) {
                        continue;
                    }
                    // Flat mode indexes the bare name; hierarchical mode prefixes it with
                    // the ancestor path, so the trailing suffix is accepted as well.
                    const keys = [desc.name, desc.name.toLowerCase()];
                    const dot = desc.name.lastIndexOf('.');
                    if (dot >= 0) {
                        const suffix = desc.name.slice(dot + 1);
                        keys.push(suffix, suffix.toLowerCase());
                    }
                    for (const key of keys) {
                        if (!archetypesByName.has(key)) {
                            archetypesByName.set(key, node);
                        }
                    }
                }
                const lookupArchetype = (name: string | undefined): AstNode | undefined =>
                    name === undefined
                        ? undefined
                        : archetypesByName.get(name) ?? archetypesByName.get(name.toLowerCase());

                // Descriptions in the local/extends packages are cached per scope root
                // and therefore cover EVERY named element of that root, regardless of
                // which reference is being resolved. A reference declared with a
                // concrete type (`softwareSystem=[SoftwareSystem]`) must only see
                // descriptions that are subtypes of that type; otherwise a name shared
                // with another element kind resolves to the wrong node - e.g.
                // `!element ENSEMBLE` shadowing the real `softwareSystem ENSEMBLE`,
                // which emitted a dangling `elementextension_*` id that no model
                // element carries. Filtering happens here, per call, because the cached
                // package is type-agnostic and shared by every reference type.
                const isAssignable = (desc: AstNodeDescription): boolean => {
                    if (this.reflection.isSubtype(desc.type, referenceType)) {
                        return true;
                    }
                    // An ArchetypeInstance is assignable through the base type of its
                    // archetype (e.g. `b = externalSoftwareSystem "B"` behaves as a
                    // SoftwareSystem), resolved via $refText.
                    const effective = archetypeInstanceTypeByRefText((desc as any).node, lookupArchetype);
                    return !!effective && this.reflection.isSubtype(effective, referenceType);
                };

                // 4. Build chained MapScope: from nearest enclosing NamedElement to root.
                let scope: Scope = new MapScope(globalDescriptions.filter(isAssignable), globalScope);

                // Keys of suffixAliasesByScope are only ever NamedElement nodes
                // (exportElementDescriptions writes via collectHierarchicalAncestors,
                // which filters isNamedElement), so the `has` lookup already implies
                // the type. The alias descriptions themselves still need filtering:
                // an alias pointing at a nested element must not satisfy a reference
                // to an unrelated type.
                const enclosingChain: AstNode[] = [];
                let enclosing: AstNode | undefined = context.container;
                while (enclosing) {
                    if (pkg.suffixAliasesByScope.has(enclosing)) {
                        enclosingChain.push(enclosing);
                    }
                    enclosing = enclosing.$container;
                }

                for (let i = enclosingChain.length - 1; i >= 0; i--) {
                    const aliases = pkg.suffixAliasesByScope.get(enclosingChain[i])!;
                    const assignableAliases = aliases.filter(isAssignable);
                    if (assignableAliases.length > 0) {
                        scope = new MapScope(assignableAliases, scope);
                    }
                }

                // 5. Case-insensitive fallback for IDENTIFIERS only.
                const tagged: AstNodeDescription[] = [];
                const collectTagged = (descs: Iterable<AstNodeDescription>) => {
                    for (const d of descs) {
                        if ((d as any)[IDENTIFIER_DESCRIPTION_TAG] && isAssignable(d)) tagged.push(d);
                    }
                };
                collectTagged(globalDescriptions);
                for (const aliases of pkg.suffixAliasesByScope.values()) {
                    collectTagged(aliases);
                }
                scope = new CaseInsensitiveIdentifierScope(scope, tagged);

                return scope;
            }
        }
        return super.getScope(context);
    }

    /**
     * Builds the per-root LOCAL scope package for a scope-traversal root (ModelBlock, Workspace
     * or C4Document): FQN/name descriptions for every local NamedElement plus the suffix-alias
     * map for ancestor scopes. The result is a constant of the root (identifier style and element
     * set), so it is cached in localScopeCache and reused across all reference resolutions within
     * a single build.
     *
     * @param root The scope-traversal root (ModelBlock, Workspace or C4Document)
     * @returns The local scope package for the root's document
     */
    private buildLocalScopePackage(root: AstNode): LocalScopePackage {
        const localDescriptions: AstNodeDescription[] = [];
        // Map: enclosing NamedElement -> list of suffix aliases for nested elements.
        // Keys are the REAL AST nodes of the ancestors (from the root document or from
        // any included fragment) so that `enclosingChain` in getScope (which walks the
        // $container chain of the reference) finds the exact same nodes as keys.
        const suffixAliasesByScope = new Map<AstNode, AstNodeDescription[]>();

        // For each NamedElement in the root, determine if hierarchical or flat mode,
        // then create FQN descriptions and optional suffix aliases for ancestor scopes.
        AstUtils.streamAllContents(root)
            .filter(isNamedElement)
            .forEach((element) => {
                const isHierarchical = this.isHierarchicalMode(element, element.$cstNode?.offset ?? 0);
                const document = AstUtils.getDocument(element);
                const elementDescriptions = this.exportElementDescriptions(
                    element, document, isHierarchical, suffixAliasesByScope
                );
                localDescriptions.push(...elementDescriptions);
            });

        // Elements contributed via `!include` fragments are ALSO registered with the
        // SAME suffix-alias map. In Structurizr a fragment is spliced inline into the
        // including file, so `a -> b` inside a `softwareSystem` defined in a fragment
        // must resolve `a`/`b` against the fragment's own enclosing scope (see the
        // sibling-relationship scenario). Without this, include elements only get FQN
        // descriptions (`s.a`, `s.b`) and short names are invisible.
        const currentDoc = AstUtils.getDocument(root);
        const docUri = currentDoc?.uri.toString() ?? '';
        const includeDescriptions = this.resolveIncludesRecursive(root, new Set<string>([docUri]));
        localDescriptions.push(...includeDescriptions);

        // Suffix aliases for included elements cannot be replayed from the cached
        // descriptions (they need the real ancestor AST nodes as map keys), so build
        // them with a dedicated pass sharing this root's suffixAliasesByScope map.
        this.collectIncludeSuffixAliases(root, suffixAliasesByScope, new Set<string>([docUri]));

        return { localDescriptions, suffixAliasesByScope };
    }

    /**
     * Recursively walks `!include` fragments reachable from `node` and registers the
     * suffix aliases of their NamedElements into `suffixAliasesByScope` (keys are the
     * real AST nodes of the ancestors inside the fragments). This mirrors
     * exportElementDescriptions' suffix logic but for fragments, so short sibling
     * names resolve inside relationship scopes that live in those fragments.
     */
    private collectIncludeSuffixAliases(
        node: AstNode,
        suffixAliasesByScope: Map<AstNode, AstNodeDescription[]>,
        visitedUris: Set<string>
    ): void {
        for (const inc of AstUtils.streamAllContents(node).filter(isInclude).toArray()) {
            const uri = this.resolvePathToUri(inc.file, node);
            if (!uri || visitedUris.has(uri.toString())) continue;
            visitedUris.add(uri.toString());

            const langiumDoc = this.services.shared.workspace.LangiumDocuments.getDocument(uri);
            if (!langiumDoc) continue;
            const rootNode = langiumDoc.parseResult.value;
            if (!rootNode) continue;

            const hasOwnDirective = this.hasOwnIdentifiersDirective(langiumDoc);
            const inheritedHierarchical = hasOwnDirective
                ? undefined
                : this.inheritedIncludeStyle(uri.toString());

            AstUtils.streamAllContents(rootNode)
                .filter(isNamedElement)
                .forEach((element) => {
                    const hierarchical = inheritedHierarchical
                        ?? this.isHierarchicalMode(element, element.$cstNode?.offset ?? 0);
                    this.exportElementDescriptions(element, langiumDoc, hierarchical, suffixAliasesByScope);
                });

            this.collectIncludeSuffixAliases(rootNode, suffixAliasesByScope, visitedUris);
        }
    }

    /**
     * Recursively resolves !include directives to collect element descriptions from external files.
     *
     * How it works:
     * 1. Finds ALL Include nodes in the current AST subtree (not just direct children — uses streamAllContents).
     * 2. For each include, resolves the file URI relative to the current document, skipping visited URIs.
     * 3. Attempts to get the included document either via IndexManager (fast, cached) or LangiumDocuments.
     * 4. Computes the identifier style (hierarchical/flat) for the external file independently
     *    — external files may use a different !identifiers style than the current file.
     * 5. Manually traverses all NamedElement nodes in the included file and exports their descriptions.
     * 6. Recurse into nested !include directives within the included file.
     *
     * @param node The AST node to search for !include directives
     * @param visitedUris Set of already-processed document URIs (cycle prevention)
     * @param suffixAliasesByScope Optional suffix-alias map, shared with the caller's
     *        local scope package so fragment elements create suffix aliases for their
     *        ancestor scopes (matching Structurizr's inline-splice semantics - a
     *        relationship from one child to a sibling within a fragment's element
     *        resolves the short names). When omitted, elements are FQN-only.
     * @returns Flat array of AstNodeDescription for all elements found in included files
     */
    private resolveIncludesRecursive(
        node: AstNode,
        visitedUris: Set<string>,
        suffixAliasesByScope?: Map<AstNode, AstNodeDescription[]>
    ): AstNodeDescription[] {
        const descriptions: AstNodeDescription[] = [];
        const includes = AstUtils.streamAllContents(node).filter(isInclude).toArray();

        for (const inc of includes) {
            const uri = this.resolvePathToUri(inc.file, node);
            if (!uri || visitedUris.has(uri.toString())) continue;

            const uriString = uri.toString();
            visitedUris.add(uriString);

            // Get the document directly from LangiumDocuments - the document builder
            // already loaded it (including remote URLs) under this exact URI.
            const langiumDoc = this.services.shared.workspace.LangiumDocuments.getDocument(uri);

            if (langiumDoc?.parseResult.value) {
                const rootNode = langiumDoc.parseResult.value;

                // Identifier style for included elements. In Structurizr, `!include` is an
                // inline splice at the directive's position into the SAME IdentifiersRegister
                // that the including file uses, so the fragment inherits the identifier style
                // of the region where the !include directive sits in the parent:
                //  - if the fragment has its OWN `!identifiers` directive (possibly several),
                //    they build their own style regions exactly like a standalone document
                //    (default flat until the first directive, then per-region shifts);
                //  - otherwise the fragment uses the parent's style for the region at the
                //    offset of the `!include` directive (closest ancestor that includes it).
                const hasOwnDirective = this.hasOwnIdentifiersDirective(langiumDoc);
                const inheritedHierarchical = hasOwnDirective
                    ? undefined
                    : this.inheritedIncludeStyle(uriString);

                // Traverse all named elements and register them. When `suffixAliasesByScope`
                // is provided (from buildLocalScopePackage), fragment elements also get
                // suffix aliases in their ancestor scopes, so short sibling names are
                // visible to relationships defined inside the fragment.
                AstUtils.streamAllContents(rootNode)
                    .filter(isNamedElement)
                    .forEach((element) => {
                        const hierarchical = inheritedHierarchical
                            ?? this.isHierarchicalMode(element, element.$cstNode?.offset ?? 0);
                        descriptions.push(...this.exportElementDescriptions(
                            element, langiumDoc, hierarchical, suffixAliasesByScope
                        ));
                    });

                // Recurse into nested includes within the included file
                descriptions.push(...this.resolveIncludesRecursive(rootNode, visitedUris, suffixAliasesByScope));
            }
        }
        return descriptions;
    }

    /**
     * Resolves element descriptions from workspace extendsUri chain.
     *
     * How it works:
     * 1. Resolves the extendsUri to a target file URI.
     * 2. Uses IndexManager to find any indexed element in the target file.
     * 3. Climbs up to find the Workspace root of the target file.
     * 4. If that workspace also extends another, recurses (supports multi-level inheritance).
     * 5. Computes identifier style for each external workspace independently.
     * 6. Traverses all NamedElement nodes and exports their descriptions (FQN only).
     *
     * Results are cached via extendedElementsCache to avoid re-traversing
     * the extends chain on every scope lookup.
     *
     * @param currentWs The workspace whose extendsUri to resolve
     * @param visitedUris Set of already-processed URIs (cycle prevention)
     * @returns Flat array of AstNodeDescription for all inherited elements
     */
    private resolveExtendsRecursive(currentWs: Workspace, visitedUris: Set<string>): AstNodeDescription[] {
        const descriptions: AstNodeDescription[] =[];
        const uri = this.resolveWorkspaceUri(currentWs);
        
        if (!uri || visitedUris.has(uri.toString())) return descriptions;
        
        const uriString = uri.toString();
        visitedUris.add(uriString);

        // Find any indexed element in the target file via IndexManager
        const rootExDesc = this.indexManager.allElements(undefined, new Set([uriString])).head();

        if (rootExDesc?.node) {
            // We may have found any element (e.g., a SoftwareSystem). Climb to the Workspace root.
            const rootEx = isWorkspace(rootExDesc.node)
                ? rootExDesc.node
                : AstUtils.getContainerOfType(rootExDesc.node, isWorkspace);

            if (rootEx) {
                // Support multi-level inheritance: recurse if this workspace also extends another
                if (rootEx.extendsUri) {
                    descriptions.push(...this.resolveExtendsRecursive(rootEx, visitedUris));
                }

                AstUtils.streamAllContents(rootEx)
                    .filter(isNamedElement)
                    .forEach((element) => {
                        const document = AstUtils.getDocument(element);
                        // Each element uses the region its own !identifiers directive falls in.
                        const hierarchical = this.isHierarchicalMode(element, element.$cstNode?.offset ?? 0);
                        descriptions.push(...this.exportElementDescriptions(element, document, hierarchical));
                    });

                // An extended workspace may itself pull in elements via !include
                // (e.g. a system declared in a fragment included by the parent
                // workspace). Without this, those elements are invisible to the
                // extending workspace and to any fragment included downstream
                // ("Could not resolve reference to 'X'").
                descriptions.push(...this.resolveIncludesRecursive(rootEx, new Set<string>([uriString])));
            }
        }
        
        return descriptions;
    }

    /**
     * Returns the identifier style (hierarchical for !identifiers hierarchical,
     * flat otherwise) that applies at the given CST offset.
     */
    private isHierarchicalMode(node: AstNode, offset: number): boolean {
        return this.styleAtOffset(AstUtils.getDocument(node), offset);
    }

    /**
     * Returns true when the document declares at least one `!identifiers` directive
     * of its own. Derived from the cached style regions: a document without its
     * own directive has only the single base region at offset -1.
     */
    private hasOwnIdentifiersDirective(doc: LangiumDocument): boolean {
        return this.getStyleRegions(doc).regions.length > 1;
    }

    /**
     * Returns the identifier-style regions of a document: a base region at offset -1
     * (inherited from the extendsUri chain) plus one region per !identifiers directive,
     * sorted by CST offset. Cached per document URI.
     */
    private getStyleRegions(doc: LangiumDocument, visitedUris?: Set<string>): StyleRegions {
        return this.styleRegionsCache.get(doc.uri.toString(), () => {
            const visited = visitedUris ?? new Set<string>();
            visited.add(doc.uri.toString());

            const regions: { offset: number; hierarchical: boolean }[] = [
                { offset: -1, hierarchical: this.computeBaseStyle(doc, visited) ?? false }
            ];
            const root = doc.parseResult.value;
            if (root) {
                AstUtils.streamAllContents(root)
                    .filter(isIdentifiersProperty)
                    .forEach((prop) => {
                        regions.push({ offset: prop.$cstNode?.offset ?? 0, hierarchical: prop.style === 'hierarchical' });
                    });
            }
            regions.sort((a, b) => a.offset - b.offset);
            return { regions };
        });
    }

    /** Binary-search lookup: the last region whose offset is <= the given offset. */
    private styleAtOffset(doc: LangiumDocument, offset: number, visitedUris?: Set<string>): boolean {
        const regions = this.getStyleRegions(doc, visitedUris).regions;
        let lo = 0;
        let hi = regions.length - 1;
        let result = regions[0];
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (regions[mid].offset <= offset) {
                result = regions[mid];
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }
        return result.hierarchical;
    }

    /**
     * Returns the identifier style a document inherits from the `!include` parent
     * at the position of the directive that pulls it in, or undefined when no
     * loaded ancestor includes it.
     *
     * `visitedUris` skips ancestors already walked, so cyclic include chains
     * terminate. A guarded walk is not cached because its result depends on the
     * visited set; the unguarded walk is cached per fragment URI.
     */
    private inheritedIncludeStyle(fragmentUri: string, visitedUris?: Set<string>): boolean | undefined {
        const compute = (): boolean | undefined => {
            const chain = includeResolver.getAncestorChain(this.services.shared, fragmentUri);
            for (const ancUri of chain) {
                if (visitedUris?.has(ancUri)) continue;

                const ancDoc = this.services.shared.workspace.LangiumDocuments.getDocument(URI.parse(ancUri));
                const ancRoot = ancDoc?.parseResult.value;
                if (!ancRoot) continue;

                // Per-ancestor map of included-target URI -> !include directive CST offset,
                // built once per ancestor document and reused for every fragment.
                const offsets = this.includeTargetOffsetCache.get(ancUri, () => {
                    const map = new Map<string, number>();
                    for (const inc of AstUtils.streamAllContents(ancRoot).filter(isInclude).toArray()) {
                        const targetUri = this.resolvePathToUri(inc.file, inc);
                        if (targetUri && !map.has(targetUri.toString())) {
                            map.set(targetUri.toString(), inc.$cstNode?.offset ?? 0);
                        }
                    }
                    return map;
                });
                const offset = offsets.get(fragmentUri);
                if (offset !== undefined) {
                    return this.styleAtOffset(ancDoc, offset, visitedUris);
                }
            }
            return undefined;
        };

        return visitedUris
            ? compute()
            : this.fragmentStyleCache.get(fragmentUri, compute);
    }

    /**
     * Computes the identifier style of the region before a document's first
     * !identifiers directive: the style of the include parent at the directive
     * that pulls this document in, otherwise the last region of the extended
     * workspace, otherwise undefined (flat).
     */
    private computeBaseStyle(doc: LangiumDocument, visitedUris: Set<string>): boolean | undefined {
        const inherited = this.inheritedIncludeStyle(doc.uri.toString(), visitedUris);
        if (inherited !== undefined) {
            return inherited;
        }

        const workspace = this.findWorkspaceNode(doc.parseResult.value);
        if (!workspace?.extendsUri) return undefined;

        const uri = this.resolveWorkspaceUri(workspace);
        if (!uri || visitedUris.has(uri.toString())) return undefined;
        visitedUris.add(uri.toString());

        const parentDoc = this.services.shared.workspace.LangiumDocuments.getDocument(uri);
        if (!parentDoc?.parseResult.value) return undefined;

        const parentRegions = this.getStyleRegions(parentDoc, visitedUris);
        return parentRegions.regions[parentRegions.regions.length - 1].hierarchical;
    }

    /** Returns the Workspace AST node of a document (bare root or inside a C4Document), if any. */
    private findWorkspaceNode(root: any): Workspace | undefined {
        if (isWorkspace(root)) return root;
        if (isC4Document(root) && Array.isArray(root.workspaces) && root.workspaces.length > 0) {
            return root.workspaces[0];
        }
        return undefined;
    }

    /**
     * Resolves the URI of an extended workspace via extendsUri.
     * Strips quotes and substitutes ${CONST} placeholders.
     */
    private resolveWorkspaceUri(workspace: Workspace): URI | undefined {
        if (!workspace.extendsUri) return undefined;

        return this.resolveTargetUri(workspace.extendsUri, workspace);
    }

    /**
     * Universal path resolver for both extends and include directives.
     * Handles quote stripping and ${CONST} placeholder substitution.
     */
    private resolvePathToUri(rawPath: string, contextNode: AstNode): URI | undefined {
        return this.resolveTargetUri(rawPath, contextNode);
    }

    /**
     * Resolves a raw path (relative path or http(s) URL) to an absolute URI,
     * relative to the document that contains `contextNode`. Remote http(s)
     * URLs are parsed as-is, so remote !include / extendsUri targets resolve
     * to the same URI the document builder loads them under (see
     * C4DocumentBuilder.resolveTargetUri).
     */
    private resolveTargetUri(rawPath: string, contextNode: AstNode): URI | undefined {
        // Single shared resolution pipeline (quotes, ${CONST}, http(s), relative
        // paths) - matches the document builder, validator and JSON generator.
        return includeResolver.resolveTargetUri(rawPath, contextNode, {
            constants: (path, node) => includeResolver.substituteConstants(this.services.shared, path, node),
        });
    }


}
