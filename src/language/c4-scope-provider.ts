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
    LangiumDocument} from 'langium';
import { isModelBlock, isWorkspace, isNamedElement, Workspace, NamedElement, isArchetypeDefinition, isDeploymentEnvironment, isInclude, Include, isC4Document, isConstant, isGroup } from '../generated/ast';
import { URI, Utils } from 'vscode-uri';

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

export class C4ScopeProvider extends DefaultScopeProvider {
    protected readonly services: LangiumCoreServices;
    // Cache for identifier style (hierarchical/flat) per document scope
    private readonly styleCache: WorkspaceCache<string, boolean>;
    // Cache for extends-resolved elements to avoid repeated traversal
    private readonly extendedElementsCache: WorkspaceCache<string, AstNodeDescription[]>;
    // Cache for include-resolved elements
    private readonly includeCache: WorkspaceCache<string, AstNodeDescription[]>;
    // Cache for the local element package (FQN/name descriptions + suffix aliases) per root
    // node. Built once per root per build (see buildLocalScopePackage) - this removes the
    // O(references x elements) blow-up where every getScope() call re-traversed the whole
    // AST and recomputed FQNs from scratch.
    private readonly localScopeCache: WorkspaceCache<string, LocalScopePackage>;

    constructor(services: LangiumCoreServices) {
        super(services);
        this.services = services;

        // Initialize caches. Automatically cleared on ANY project change via WorkspaceCache.
        this.styleCache = new WorkspaceCache<string, boolean>(services.shared);
        this.extendedElementsCache = new WorkspaceCache<string, AstNodeDescription[]>(services.shared);
        this.includeCache = new WorkspaceCache<string, AstNodeDescription[]>(services.shared);
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
                        list.push({ ...fqnDesc, name: suffix });
                        suffixAliasesByScope.set(scopeOwner, list);
                    }
                }
            } else {
                // Flat mode: just use the bare ID
                const fqnDesc = this.services.workspace.AstNodeDescriptionProvider.createDescription(element, elementId, document);
                descriptions.push(fqnDesc);
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

        // Check if this property references a NamedElement
        const isElementRef = [
            'person','source', 'target', 'softwareSystem', 'container', 'component',
            'workspace', 'archetype', 'baseArchetype', 'elements', 'element',
            'from', 'targetThis', 'sourceThis', 'element', 'group', 'deploymentGroup', 'environment', 'softwareSystemInstance', 'containerInstance', 'deploymentEnvironment', 'deploymentGroups', 'DeploymentEnvironment'
        ].includes(context.property);

        if (isElementRef) {
            const workspace = AstUtils.getContainerOfType(context.container, isWorkspace);
            const model = AstUtils.getContainerOfType(context.container, isModelBlock);
            // Determine the root for scope traversal: start from ModelBlock if inside one,
            // otherwise from Workspace, or finally from C4Document
            const root = model || workspace || AstUtils.getContainerOfType(context.container, isC4Document);

            if (root) {
                const globalDescriptions: AstNodeDescription[] = [];

                // --- 1. RESOLVE !include FILES ---
                // External elements get global FQN only. No suffix aliases are created for them
                // because external files should not introduce shorthand names into the local scope.
                const currentDoc = AstUtils.getDocument(root);
                const includeDescriptions = this.includeCache.get(currentDoc.uri.toString(), () => {
                    const visited = new Set<string>([currentDoc.uri.toString()]);
                    return this.resolveIncludesRecursive(root, visited);
                });
                globalDescriptions.push(...includeDescriptions);

                // 2. LOAD ELEMENTS FROM EXTENDS (also global only, cached)
                if (workspace?.extendsUri) {
                    const workspaceUri = AstUtils.getDocument(workspace).uri.toString();
                    const extDescriptions = this.extendedElementsCache.get(workspaceUri, () =>
                        this.resolveExtendsRecursive(workspace, new Set())
                    );
                    globalDescriptions.push(...extDescriptions);
                }

                // 3. COLLECT LOCAL ELEMENTS with suffix alias scoping (cached per root node).
                // The local package is a constant of the root - it does not depend on the
                // referencing context - so it is built once per root per build (see
                // buildLocalScopePackage) instead of being re-traversed on every reference.
                // The cache key is the root document URI plus the root node's type/offset,
                // because one document can resolve to different roots (ModelBlock vs Workspace
                // vs C4Document) depending on where the reference sits.
                const rootDocUri = currentDoc.uri.toString();
                const rootKey = `${rootDocUri}#${root.$type}@${root.$cstNode?.offset ?? -1}`;
                const pkg = this.localScopeCache.get(rootKey, () => this.buildLocalScopePackage(root));
                globalDescriptions.push(...pkg.localDescriptions);

                const globalScope = this.getGlobalScope(this.reflection.getReferenceType(context), context);

                // 4. Build chained MapScope: from nearest enclosing NamedElement to root.
                // Langium's scope lookup works bottom-up — the innermost scope is searched first.
                // The outermost level contains global FQN descriptions + external (include/extends).
                let scope: Scope = new MapScope(globalDescriptions, globalScope);

                // Collect enclosing NamedElement chain for the context container
                const enclosingChain: AstNode[] = [];
                let cur: AstNode | undefined = context.container;
                while (cur) {
                    if (isNamedElement(cur) && pkg.suffixAliasesByScope.has(cur)) {
                        enclosingChain.push(cur);
                    }
                    cur = cur.$container;
                }

                // Wrap from farthest ancestor to nearest (reverse order),
                // so the nearest ancestor becomes the innermost (highest priority) scope.
                for (let i = enclosingChain.length - 1; i >= 0; i--) {
                    const aliases = pkg.suffixAliasesByScope.get(enclosingChain[i])!;
                    scope = new MapScope(aliases, scope);
                }

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
        // Map: enclosing NamedElement -> list of suffix aliases for nested elements
        const suffixAliasesByScope = new Map<AstNode, AstNodeDescription[]>();

        // For each NamedElement in the root, determine if hierarchical or flat mode,
        // then create FQN descriptions and optional suffix aliases for ancestor scopes.
        AstUtils.streamAllContents(root)
            .filter(isNamedElement)
            .forEach((element) => {
                const isHierarchical = this.isHierarchicalMode(element, element.$cstNode?.offset);
                const document = AstUtils.getDocument(element);
                const elementDescriptions = this.exportElementDescriptions(
                    element, document, isHierarchical, suffixAliasesByScope
                );
                localDescriptions.push(...elementDescriptions);
            });

        return { localDescriptions, suffixAliasesByScope };
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
     * IMPORTANT: External elements are registered with global FQN only.
     * No suffix aliases are created because external files should not introduce
     * shorthand names that could conflict with local scope names.
     *
     * @param node The AST node to search for !include directives
     * @param visitedUris Set of already-processed document URIs (cycle prevention)
     * @returns Flat array of AstNodeDescription for all elements found in included files
     */
    private resolveIncludesRecursive(node: AstNode, visitedUris: Set<string>): AstNodeDescription[] {
        const descriptions: AstNodeDescription[] = [];
        const includes = AstUtils.streamAllContents(node).filter(isInclude).toArray();

        for (const inc of includes) {
            const uri = this.resolvePathToUri(inc.file, node);
            if (!uri || visitedUris.has(uri.toString())) continue;

            const uriString = uri.toString();
            visitedUris.add(uriString);

            // Try IndexManager first (fast path — the document may already be indexed)
            const rootDesc = this.indexManager.allElements(undefined, new Set([uriString])).head();
            
            // Fallback: get document directly from LangiumDocuments (works synchronously)
            const langiumDoc = rootDesc?.node
                ? AstUtils.getDocument(rootDesc.node)
                : this.services.shared.workspace.LangiumDocuments.getDocument(uri);

            if (langiumDoc?.parseResult.value) {
                const rootNode = langiumDoc.parseResult.value;

                // Each external file determines its own identifier style independently
                const remoteHierarchical = this.isHierarchicalModeCached(rootNode);
                // Traverse all named elements and register them (FQN only, no suffix aliases)
                AstUtils.streamAllContents(rootNode)
                    .filter(isNamedElement)
                    .forEach((element) => {
                        descriptions.push(...this.exportElementDescriptions(element, langiumDoc, remoteHierarchical));
                    });

                // Recurse into nested includes within the included file
                descriptions.push(...this.resolveIncludesRecursive(rootNode, visitedUris));
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

                // External workspace uses its own identifier style
                const remoteHierarchical = this.isHierarchicalMode(rootEx);

                AstUtils.streamAllContents(rootEx)
                    .filter(isNamedElement)
                    .forEach((element) => {
                         const document = AstUtils.getDocument(element);
                         descriptions.push(...this.exportElementDescriptions(element, document, remoteHierarchical));
                    });
            }
        }
        
        return descriptions;
    }

    /**
     * Cached wrapper for isHierarchicalMode. Keyed by document URI + CST node offset.
     */
    private isHierarchicalModeCached(node: AstNode): boolean {
        if (!node.$cstNode) return this.isHierarchicalMode(node);

        const doc = AstUtils.getDocument(node);
        const cacheKey = `${doc.uri.toString()}:${node.$cstNode.offset}`;

        return this.styleCache.get(cacheKey, () => this.isHierarchicalMode(node));
    }

    /**
     * Determines whether the current scope uses hierarchical (!identifiers hierarchical)
     * or flat (!identifiers flat) identifier style. Searches up the AST container chain
     * and through extendsUri chain for !identifiers directives.
     */
    private isHierarchicalMode(node: AstNode, offset?: number): boolean {
        const visitedUris = new Set<string>();
        const doc = AstUtils.getDocument(node);
        visitedUris.add(doc.uri.toString());

        // If offset not specified, use -1 to search for the "last style in block/file"
        const searchOffset = offset ?? -1;
        
        return this.findStyleRecursive(node, searchOffset, visitedUris) ?? false;
    }

    /**
     * Recursively searches for !identifiers directives by climbing the AST container chain
     * and following extendsUri. Returns true if hierarchical mode was last set, false if flat.
     */
    private findStyleRecursive(node: AstNode, offset: number, visitedUris: Set<string>): boolean | undefined {
        let current: AstNode | undefined = node;

        // 1. Search upward through the current AST tree
        while (current) {
            // Check for 'identifiers' property (present in Workspace and ModelBlock per grammar)
            const identifiers = (current as any).identifiers;
            if (Array.isArray(identifiers) && identifiers.length > 0) {
                let lastStyle: string | undefined;

                for (const idProp of identifiers) {
                    // If offset === -1 (external file), take the last directive.
                    // Otherwise check that the directive is physically ABOVE our element.
                    if (offset === -1 || (idProp.$cstNode && idProp.$cstNode.offset < offset)) {
                        lastStyle = idProp.style;
                    }
                }
                
                if (lastStyle) {
                    return lastStyle === 'hierarchical';
                }
            }

            // 2. If we reached Workspace, check the extendsUri chain
            if (isWorkspace(current)) {
                if (current.extendsUri) {
                    const uri = this.resolvePathToUri(current.extendsUri, current);
                    if (uri && !visitedUris.has(uri.toString())) {
                        visitedUris.add(uri.toString());

                        const langiumDoc = this.services.shared.workspace.LangiumDocuments.getDocument(uri);
                        const rootNode = langiumDoc?.parseResult.value;
                        
                        if (rootNode) {
                            // In external files, search the entire scope (offset = -1)
                            const result = this.findStyleRecursive(rootNode, -1, visitedUris);
                            if (result !== undefined) return result;
                        }
                    }
                }
                break; // Exit the loop — nothing above Workspace in C4 DSL
            }
            
            current = current.$container;
        }

        return undefined;
    }

    /**
     * Resolves the URI of an extended workspace via extendsUri.
     * Strips quotes and substitutes ${CONST} placeholders.
     */
    private resolveWorkspaceUri(workspace: Workspace): URI | undefined {
        if (!workspace.extendsUri) return undefined;

        const rawPath = this.substituteConstants(workspace.extendsUri.replace(/['"]/g, ''), workspace);
        const currentDocUri = AstUtils.getDocument(workspace).uri;

        const baseDir = Utils.dirname(currentDocUri);
        return Utils.resolvePath(baseDir, rawPath);
    }

    /**
     * Universal path resolver for both extends and include directives.
     * Handles quote stripping and ${CONST} placeholder substitution.
     */
    private resolvePathToUri(rawPath: string, contextNode: AstNode): URI | undefined {
        const path = this.substituteConstants(rawPath.replace(/['"]/g, ''), contextNode);
        const currentDocUri = AstUtils.getDocument(contextNode).uri;
        const baseDir = Utils.dirname(currentDocUri);
        try {
            return Utils.resolvePath(baseDir, path);
        } catch {
            return undefined;
        }
    }

    /**
     * Substitutes ${NAME} placeholders with constant values (!const/!constant).
     * Priority: current document first, then other workspace documents
     * (constants may be declared in a parent file that !includes the current file).
     * Unknown placeholders are left as-is.
     */
    private substituteConstants(input: string, contextNode: AstNode): string {
        if (!input.includes('${')) return input;
        const doc = AstUtils.getDocument(contextNode);
        const localRoot = doc.parseResult?.value;
        const localConstants = new Map<string, string>();
        if (localRoot) this.collectConstants(localRoot, localConstants);

        return input.replace(/\$\{([^}]+)\}/g, (match, key) => {
            const name = key.trim();
            if (localConstants.has(name)) return localConstants.get(name)!;
            const fromWorkspace = this.lookupConstantInWorkspace(name, doc.uri.toString());
            return fromWorkspace ?? match;
        });
    }

    /** Collects all !constant/!const declarations from the given root AST node into a map */
    private collectConstants(root: AstNode, target: Map<string, string>): void {
        AstUtils.streamAllContents(root).filter(isConstant).forEach((c) => {
            const name = (c.name ?? '').toString().replace(/['"]/g, '');
            const rawValue = (c.value ?? '').toString();
            const value = typeof rawValue === 'string' ? rawValue.replace(/^['"]|['"]$/g, '') : rawValue;
            if (name && !target.has(name)) target.set(name, value);
        });
    }

    /** Looks up a constant by name in all workspace documents except the one specified */
    private lookupConstantInWorkspace(name: string, skipDocUri: string): string | undefined {
        const documents = this.services.shared.workspace.LangiumDocuments.all.toArray();
        for (const otherDoc of documents) {
            if (otherDoc.uri.toString() === skipDocUri) continue;
            const root = otherDoc.parseResult?.value;
            if (!root) continue;
            for (const c of AstUtils.streamAllContents(root).filter(isConstant)) {
                const cname = (c.name ?? '').toString().replace(/['"]/g, '');
                if (cname !== name) continue;
                const rawValue = (c.value ?? '').toString();
                return typeof rawValue === 'string' ? rawValue.replace(/^['"]|['"]$/g, '') : rawValue;
            }
        }
        return undefined;
    }


}
