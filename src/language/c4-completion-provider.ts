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
    CstUtils, DocumentState, type AstNode, type AstNodeDescription, type LangiumDocument,
    type LangiumDocuments, type ReferenceInfo, type Stream, stream
} from 'langium';
import {
    DefaultCompletionProvider, type CompletionContext, type CompletionValueItem, type LangiumServices,
} from 'langium/lsp';
import { CompletionItemKind, type CompletionItem, type CompletionParams, type Position } from 'vscode-languageserver';
import { Utils } from 'vscode-uri';
import type { FileSystemNode, FileSystemProvider } from 'langium';
import { collectDocumentValues, mergeExpressionValues, type DocumentValues, type ExpressionValues } from './c4-expression-values';
import { buildKeywordIndex } from './c4-keywords';
import { describeType } from './c4-utils';
import {
    BORDER_NORMALIZE, ICON_POSITION_NORMALIZE, ROUTING_NORMALIZE, SHAPE_NORMALIZE
} from './c4-validator';

/** A hierarchical path typed before the cursor: `s.` gives `{ path: 's', start: <offset of s> }`. */
interface HierarchicalPath {
    path: string;
    start: number;
}

/** Properties an expression can address on an element or a relationship. */
const EXPRESSION_PROPERTIES: Record<string, string[]> = {
    element: ['tag', 'type', 'parent', 'technology', 'properties', 'group'],
    relationship: ['tag', 'source', 'destination', 'properties'],
};

/** Values accepted by `element.type==`, matching the ElementTypeValue keywords of the grammar. */
const ELEMENT_TYPES = [
    'person', 'softwareSystem', 'container', 'component', 'deploymentNode',
    'infrastructureNode', 'softwareSystemInstance', 'containerInstance', 'custom',
];

/** AST nodes whose children hold view or model expressions. */
const EXPRESSION_CONTAINERS = new Set(['IncludeProperty', 'ExcludeProperty', 'ElementsDirective', 'AnimationStep']);

/** Concrete reference types and the AST types they accept. */
const CONCRETE_REFERENCE_TYPES = new Map<string, Set<string>>([
    ['ArchetypeDefinition', new Set(['ArchetypeDefinition'])],
    ['SoftwareSystem', new Set(['SoftwareSystem'])],
    ['Container', new Set(['Container'])],
    ['DeploymentGroup', new Set(['DeploymentGroup'])],
    ['DeploymentEnvironment', new Set(['DeploymentEnvironment'])],
    ['Relationship', new Set(['Relationship', 'ImplicitRelationship'])],
]);

/** Grammar type of the reference being completed, e.g. `DeploymentEnvironment`. */
function expectedReferenceType(refInfo: ReferenceInfo): string {
    const type = (refInfo.reference as any)?.type as { $refText?: string } | undefined;
    return type?.$refText ?? '';
}

/** Extensions accepted by the path directives; an empty list accepts folders only. */
const PATH_EXTENSIONS: Record<string, string[]> = {
    include: ['.dsl'],
    docs: [],
    adrs: [],
    decisions: [],
    script: ['.groovy', '.kt', '.rb', '.js'],
    plugin: ['.jar'],
    icon: ['.png', '.svg', '.jpg', '.jpeg', '.gif'],
};

/** Property keys read by the renderer. */
const KNOWN_PROPERTY_KEYS = [
    'structurizr.groupSeparator',
    'structurizr.groupPadding',
    'structurizr.boundaryPadding',
    'structurizr.deploymentNodePadding',
    'plantuml.url',
    'plantuml.format',
];


/** AST types that declare tags on relationships. */
const RELATIONSHIP_AST_TYPES = new Set(['Relationship', 'ImplicitRelationship']);

/** AST types that declare tags on elements. */
const ELEMENT_AST_TYPES = new Set([
    'Person', 'SoftwareSystem', 'Container', 'Component', 'CustomElement', 'DeploymentNode',
    'InfrastructureNode', 'SoftwareSystemInstance', 'ContainerInstance', 'GenericInstance', 'ArchetypeInstance',
]);

/** Values of the style properties, matching the normalizers of the model. */
const STYLE_VALUES: Record<string, string[]> = {
    shape: Object.values(SHAPE_NORMALIZE),
    border: Object.values(BORDER_NORMALIZE),
    style: Object.values(BORDER_NORMALIZE),
    routing: Object.values(ROUTING_NORMALIZE),
    iconposition: Object.values(ICON_POSITION_NORMALIZE),
    jump: ['true', 'false'],
    autolayout: ['tb', 'bt', 'lr', 'rl'],
};

/**
 * Completion provider for the C4 DSL.
 *
 * After a hierarchical prefix (`s.`) the provider offers the children of `s` instead of
 * every visible element: the elements whose full hierarchical name is `s.<child>` with
 * no further segments. Children added through `!include` and `!element` take part
 * because the candidates come from the scope provider, which builds hierarchical names
 * across documents.
 *
 * After `element.` or `relationship.` the provider offers the properties of that
 * expression. Each property is part of a single lexer token (`element.tag`), so the
 * default keyword completion cannot produce it.
 */
export class C4CompletionProvider extends DefaultCompletionProvider {

    /** Ask the client for completion on its own after a dot or an arrow (`a -> b`, `s.c1`). */
    override readonly completionOptions = { triggerCharacters: ['.', '>'] };

    private readonly documents: LangiumDocuments;
    private readonly fileSystem: FileSystemProvider;
    private readonly documentValues = new Map<string, DocumentValues>();
    private readonly keywords: Map<string, string[]>;
    private values?: ExpressionValues;

    constructor(services: LangiumServices) {
        super(services);
        this.documents = services.shared.workspace.LangiumDocuments;
        this.fileSystem = services.shared.workspace.FileSystemProvider;
        this.keywords = buildKeywordIndex(services.Grammar);
        services.shared.workspace.DocumentBuilder.onDocumentPhase(DocumentState.Linked, document => {
            this.documentValues.delete(document.uri.toString());
            this.values = undefined;
        });
    }

    override getCompletion(document: LangiumDocument, params: CompletionParams): ReturnType<DefaultCompletionProvider['getCompletion']> {
        const values = this.valueCompletionAt(document, params.position);
        if (values) {
            return Promise.resolve({ isIncomplete: false, items: values });
        }
        const expression = this.expressionAt(document, params.position);
        if (expression) {
            return Promise.resolve({ isIncomplete: false, items: expression });
        }
        const declaration = this.declarationValueAt(document, params.position);
        if (declaration) {
            return Promise.resolve({ isIncomplete: false, items: declaration });
        }
        const paths = this.pathCompletionAt(document, params.position);
        if (paths) {
            return Promise.resolve({ isIncomplete: false, items: paths });
        }
        const keywords = this.keywordCompletionAt(document, params.position);
        if (keywords) {
            return Promise.resolve({ isIncomplete: false, items: keywords });
        }
        return super.getCompletion(document, params);
    }

    /**
     * Files and folders next to the current document for the path directives
     * (`!include`, `!docs`, `!adrs`, `!script`, `!plugin`, `icon`).
     */
    private pathCompletionAt(document: LangiumDocument, position: Position): CompletionItem[] | undefined {
        const text = document.textDocument.getText();
        const offset = document.textDocument.offsetAt(position);
        const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
        const linePrefix = text.slice(lineStart, offset);
        const match = /^\s*(!\w+|icon)\s+(.*)$/i.exec(linePrefix);
        if (!match) return undefined;

        const extensions = PATH_EXTENSIONS[match[1].replace(/^!/, '').toLowerCase()];
        if (!extensions) return undefined;

        const rest = match[2];
        const quoted = rest.startsWith('"') || rest.startsWith("'");
        const typed = quoted ? rest.slice(1) : rest;
        const slash = typed.lastIndexOf('/');
        const directory = typed.slice(0, slash + 1);
        const fragment = typed.slice(slash + 1);

        const base = Utils.dirname(document.uri);
        const folder = directory ? Utils.resolvePath(base, directory) : base;
        let entries: FileSystemNode[];
        try {
            entries = this.fileSystem.readDirectorySync(folder);
        } catch {
            return undefined;
        }

        const needle = fragment.toLowerCase();
        const start = document.textDocument.positionAt(offset - fragment.length);
        const items = entries
            .map(entry => ({ entry, name: Utils.basename(entry.uri) }))
            .filter(({ entry }) => entry.uri.toString() !== document.uri.toString())
            .filter(({ entry, name }) => entry.isDirectory
                ? !name.startsWith('.')
                : extensions.some(extension => name.toLowerCase().endsWith(extension)))
            .filter(({ name }) => {
                const lower = name.toLowerCase();
                return lower.startsWith(needle) && lower !== needle;
            })
            .sort((a, b) => Number(!a.entry.isDirectory) - Number(!b.entry.isDirectory)
                || a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
            .map(({ entry, name }) => ({
                label: entry.isDirectory ? `${name}/` : name,
                kind: entry.isDirectory ? CompletionItemKind.Folder : CompletionItemKind.File,
                labelDetails: { description: entry.isDirectory ? 'folder' : 'file' },
                sortText: `${entry.isDirectory ? '0' : '1'}${name.toLowerCase()}`,
                textEdit: {
                    range: { start, end: position },
                    newText: entry.isDirectory ? `${name}/` : name,
                },
            }));
        return items.length > 0 ? items : undefined;
    }

    /**
     * Values of declarations: tags and technologies of an element or relationship, the tag
     * selectors of styles and filters, and the fixed values of style properties.
     */
    private declarationValueAt(document: LangiumDocument, position: Position): CompletionItem[] | undefined {
        const text = document.textDocument.getText();
        const offset = document.textDocument.offsetAt(position);
        const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
        const linePrefix = text.slice(lineStart, offset);

        const constant = /\$\{([^}]*)$/.exec(linePrefix);
        if (constant) {
            const typed = constant[1];
            const typedStart = lineStart + constant.index + 2;
            return this.valueItems(document, position, this.expressionValues().constants, typed, typedStart, 'constant');
        }

        const propertyKey = /^\s*"([^"]*)$/.exec(linePrefix);
        if (propertyKey && this.isInside(document, lineStart, 'PropertiesBlock')) {
            const known = [...KNOWN_PROPERTY_KEYS, ...this.expressionValues().propertyKeys];
            const typedStart = lineStart + propertyKey[0].length - propertyKey[1].length;
            return this.valueItems(document, position, [...new Set(known)], propertyKey[1], typedStart, 'property');
        }

        const tags = /^\s*tags?\s+(.*)$/i.exec(linePrefix);
        if (tags) {
            const rest = tags[1];
            const quoted = (rest.match(/"/g) ?? []).length % 2 === 1;
            const start = quoted
                ? rest.lastIndexOf('"') + 1
                : Math.max(rest.lastIndexOf(' '), rest.lastIndexOf(',')) + 1;
            const typedStart = lineStart + tags[0].length - rest.length + start;
            return this.valueItems(document, position, this.tagsAt(document, lineStart), rest.slice(start), typedStart, 'tag');
        }

        const technology = /^\s*technology\s+(.*)$/i.exec(linePrefix);
        if (technology) {
            const rest = technology[1];
            const start = (rest.match(/"/g) ?? []).length % 2 === 1 ? rest.lastIndexOf('"') + 1 : 0;
            const typedStart = lineStart + technology[0].length - rest.length + start;
            return this.valueItems(document, position, this.expressionValues().technologies, rest.slice(start), typedStart, 'technology');
        }

        const selector = /^\s*(?:element|relationship)\s+"([^"]*)$/i.exec(linePrefix);
        if (selector) {
            const typedStart = lineStart + selector[0].length - selector[1].length;
            return this.valueItems(document, position, this.expressionValues().elementTags, selector[1], typedStart, 'tag');
        }

        const filter = /^\s*filtered\b[^\n]*\b(?:include|exclude)\s+"([^"]*)$/i.exec(linePrefix);
        if (filter) {
            const typedStart = lineStart + filter[0].length - filter[1].length;
            return this.valueItems(document, position, this.expressionValues().elementTags, filter[1], typedStart, 'tag');
        }

        const base = /^\s*filtered\s+(\S*)$/i.exec(linePrefix);
        if (base) {
            const typed = base[1];
            const typedStart = lineStart + base[0].length - typed.length;
            return this.valueItems(document, position, this.expressionValues().views, typed, typedStart, 'view');
        }

        const style = /^\s*(shape|border|style|routing|jump|iconPosition|autoLayout)\s+(\S*)$/i.exec(linePrefix);
        if (style) {
            const candidates = STYLE_VALUES[style[1].toLowerCase()];
            const typed = style[2];
            return this.valueItems(document, position, candidates, typed, lineStart + style[0].length - typed.length, 'value');
        }

        return undefined;
    }

    /** Tags to offer for a `tags` declaration: relationship tags inside a relationship. */
    private tagsAt(document: LangiumDocument, offset: number): string[] {
        const root = document.parseResult?.value?.$cstNode;
        const leaf = root ? CstUtils.findLeafNodeBeforeOffset(root, offset) : undefined;
        let node: AstNode | undefined = leaf?.astNode;
        while (node) {
            if (RELATIONSHIP_AST_TYPES.has(node.$type)) return this.expressionValues().relationshipTags;
            if (ELEMENT_AST_TYPES.has(node.$type)) return this.expressionValues().elementTags;
            node = node.$container;
        }
        return this.expressionValues().elementTags;
    }

    /** Whether the offset sits inside a node of the given AST type. */
    private isInside(document: LangiumDocument, offset: number, type: string): boolean {
        const root = document.parseResult?.value?.$cstNode;
        const leaf = root ? CstUtils.findLeafNodeBeforeOffset(root, offset) : undefined;
        let node: AstNode | undefined = leaf?.astNode;
        while (node) {
            if (node.$type === type) return true;
            node = node.$container;
        }
        return false;
    }

    /**
     * Values to offer after `element.technology==`, `element.tag==`, `element.group==`,
     * `element.type==` and inside `properties["name"]==` of both expressions. The values
     * come from the workspace, so the list reflects the tags, technologies, groups and
     * properties that are actually declared.
     */
    private valueCompletionAt(document: LangiumDocument, position: Position): CompletionItem[] | undefined {
        const text = document.textDocument.getText();
        const offset = document.textDocument.offsetAt(position);
        const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
        const linePrefix = text.slice(lineStart, offset);
        const values = this.expressionValues();

        const propertyKey = /(element|relationship)\.properties\[\s*"?([^"\]]*)$/i.exec(linePrefix);
        if (propertyKey && this.isExpression(document, linePrefix, lineStart + propertyKey.index)) {
            const keys = propertyKey[1].toLowerCase() === 'element'
                ? values.elementPropertyKeys
                : values.relationshipPropertyKeys;
            return this.valueItems(document, position, keys, propertyKey[2], lineStart + propertyKey.index + propertyKey[0].length - propertyKey[2].length, 'property');
        }

        const propertyValue = /(element|relationship)\.properties\[\s*"([^"]*)"\s*\]\s*==\s*(.*)$/i.exec(linePrefix);
        if (propertyValue && this.isExpression(document, linePrefix, lineStart + propertyValue.index)) {
            const byKey = propertyValue[1].toLowerCase() === 'element'
                ? values.elementPropertyValues
                : values.relationshipPropertyValues;
            const typed = propertyValue[3];
            return this.valueItems(document, position, byKey.get(propertyValue[2]) ?? [], typed, lineStart + propertyValue.index + propertyValue[0].length - typed.length, 'property value');
        }

        const comparison = /(element|relationship)\.(tag|type|technology|group)\s*(?:==|!=)\s*(.*)$/i.exec(linePrefix);
        if (!comparison || !this.isExpression(document, linePrefix, lineStart + comparison.index)) {
            return undefined;
        }

        const subject = comparison[1].toLowerCase();
        const property = comparison[2].toLowerCase();
        const candidates = property === 'type'
            ? ELEMENT_TYPES
            : property === 'technology'
                ? values.technologies
                : property === 'group'
                    ? values.groups
                    : subject === 'element' ? values.elementTags : values.relationshipTags;
        const detail = property === 'type' ? 'element type' : property;

        // `element.tag==a, b` compares several tags, so only the last segment is completed.
        const typed = comparison[3];
        const segmentStart = property === 'tag' ? typed.lastIndexOf(',') + 1 : 0;
        const segment = typed.slice(segmentStart);
        const start = lineStart + comparison.index + comparison[0].length - typed.length + segmentStart;
        return this.valueItems(document, position, candidates, segment, start, detail);
    }

    /** Items replacing the typed text with the chosen value. */
    private valueItems(
        document: LangiumDocument,
        position: Position,
        candidates: string[],
        typed: string,
        typedStart: number,
        detail: string
    ): CompletionItem[] {
        const leading = typed.length - typed.trimStart().length;
        const needle = typed.trim().toLowerCase();
        const start = document.textDocument.positionAt(typedStart + leading);
        return candidates
            .filter(value => value.toLowerCase().startsWith(needle) && value.toLowerCase() !== needle)
            .map(value => ({
                label: value,
                labelDetails: { description: detail },
                kind: CompletionItemKind.Value,
                textEdit: {
                    range: { start, end: position },
                    newText: value.includes(',') ? `"${value}"` : value,
                },
            }));
    }

    /** Workspace values; each document is scanned once and rescanned only after it changes. */
    private expressionValues(): ExpressionValues {
        if (this.values) return this.values;
        const perDocument: DocumentValues[] = [];
        for (const document of this.documents.all) {
            const key = document.uri.toString();
            let values = this.documentValues.get(key);
            if (!values) {
                values = collectDocumentValues(document.parseResult.value);
                this.documentValues.set(key, values);
            }
            perDocument.push(values);
        }
        return this.values = mergeExpressionValues(perDocument);
    }

    /** Properties to offer when the cursor follows `element.` or `relationship.` in an expression. */
    private expressionAt(document: LangiumDocument, position: Position): CompletionItem[] | undefined {
        const text = document.textDocument.getText();
        const offset = document.textDocument.offsetAt(position);
        const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
        const linePrefix = text.slice(lineStart, offset);
        const match = /\b(element|relationship)\.([\w\u00A0-\uFFFF]*)$/i.exec(linePrefix);
        if (!match || !this.isExpression(document, linePrefix, lineStart + match.index)) {
            return undefined;
        }

        const subject = match[1].toLowerCase();
        const typed = match[2].toLowerCase();
        const start = document.textDocument.positionAt(lineStart + match.index);
        return EXPRESSION_PROPERTIES[subject]
            .filter(name => name.startsWith(typed))
            .map(name => {
                const label = `${subject}.${name}`;
                return {
                    label,
                    kind: CompletionItemKind.Property,
                    textEdit: { range: { start, end: position }, newText: label },
                };
            });
    }

    /**
     * Keywords that can start the next line of the current block. The grammar spells its
     * keywords as terminal rules and requires a newline before every child, so the
     * completion parser reports no expected keyword at the start of a line.
     */
    private keywordCompletionAt(document: LangiumDocument, position: Position): CompletionItem[] | undefined {
        const text = document.textDocument.getText();
        const offset = document.textDocument.offsetAt(position);
        const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
        const typed = text.slice(lineStart, offset).trim();
        if (typed !== '' && !/^[!A-Za-z_][A-Za-z0-9_!-]*$/.test(typed)) return undefined;

        const block = this.blockBefore(document, offset - typed.length);
        const keywords = block ? this.keywords.get(block) : undefined;
        if (!keywords) return undefined;

        const needle = typed.toLowerCase();
        const start = document.textDocument.positionAt(offset - typed.length);
        const items = keywords
            .filter(keyword => keyword.toLowerCase().startsWith(needle) && keyword.toLowerCase() !== needle)
            .map((keyword, index) => ({
                label: keyword,
                kind: CompletionItemKind.Keyword,
                sortText: index.toString().padStart(3, '0'),
                textEdit: { range: { start, end: position }, newText: keyword },
            }));
        return items.length > 0 ? items : undefined;
    }

    /** Type of the innermost block that the offset belongs to. */
    private blockBefore(document: LangiumDocument, offset: number): string | undefined {
        const root = document.parseResult?.value?.$cstNode;
        if (!root) return undefined;
        const leaf = CstUtils.findLeafNodeBeforeOffset(root, offset);
        let node = leaf?.astNode;
        while (node) {
            const cst = node.$cstNode;
            // The leaf closes this node, so the cursor is already outside of it.
            if (cst && leaf && leaf.offset + leaf.length >= cst.offset + cst.length) {
                node = node.$container;
                continue;
            }
            if (this.keywords.has(node.$type)) return node.$type;
            node = node.$container;
        }
        return undefined;
    }

    /**
     * True when the expression keyword at `index` sits in an expression. The AST check
     * covers regular views; a view body included from another file parses as a fragment
     * without the enclosing view node, so the position is also accepted when the keyword
     * starts a line, follows `include`/`exclude`, or opens a quoted or grouped expression.
     */
    private isExpression(document: LangiumDocument, linePrefix: string, offset: number): boolean {
        if (this.isExpressionPosition(document, offset)) return true;
        const text = document.textDocument.getText();
        const relative = offset - (text.lastIndexOf('\n', offset - 1) + 1);
        const before = linePrefix.slice(0, relative).trimEnd();
        return before === '' || /(?:^|\s)(?:include|exclude)$/i.test(before) || /["(,]$/.test(before);
    }

    /** True when the offset sits inside a view or model expression. */
    private isExpressionPosition(document: LangiumDocument, offset: number): boolean {
        const root = document.parseResult?.value?.$cstNode;
        if (!root) return false;
        // An incomplete expression (`element.technology==` with no value) has no CST
        // node at the cursor, so fall back to the last node before the gap.
        const leaf = CstUtils.findLeafNodeAtOffset(root, offset) ?? CstUtils.findLeafNodeBeforeOffset(root, offset);
        let node: AstNode | undefined = leaf?.astNode;
        while (node) {
            if (EXPRESSION_CONTAINERS.has(node.$type)) return true;
            node = node.$container;
        }
        return false;
    }

    protected override getReferenceCandidates(refInfo: ReferenceInfo, context: CompletionContext): Stream<AstNodeDescription> {
        const prefix = this.hierarchicalPathBefore(context);
        let candidates: Stream<AstNodeDescription>;
        if (prefix) {
            const children = this.childDescriptions(refInfo, prefix.path);
            candidates = children.length > 0 ? stream(children) : super.getReferenceCandidates(refInfo, context);
        } else {
            candidates = super.getReferenceCandidates(refInfo, context);
        }

        // A reference to one concrete type (`deployment <system> <environment>`,
        // `instanceOf <archetype>`) only accepts that type, while union-typed
        // references such as `NamedElement` take every element.
        const expected = CONCRETE_REFERENCE_TYPES.get(expectedReferenceType(refInfo));
        return expected ? candidates.filter(description => expected.has(description.type)) : candidates;
    }

    protected override createReferenceCompletionItem(
        nodeDescription: AstNodeDescription,
        refInfo: ReferenceInfo,
        context: CompletionContext
    ): CompletionValueItem {
        const item = super.createReferenceCompletionItem(nodeDescription, refInfo, context);
        const labelDetails = { description: describeType(nodeDescription.type) };
        const prefix = this.hierarchicalPathBefore(context);
        if (prefix) {
            // Replace the whole typed path (`s.` / `s.c`) with the full name; the
            // default edit only covers the current token and the default fuzzy match
            // rejects a dotted identifier.
            return {
                ...item,
                label: nodeDescription.name,
                detail: undefined,
                labelDetails,
                textEdit: {
                    range: {
                        start: context.textDocument.positionAt(prefix.start),
                        end: context.position,
                    },
                    newText: nodeDescription.name,
                },
            };
        }
        return { ...item, detail: undefined, labelDetails };
    }

    /** Descriptions named `<path>.<child>` with no further segments, in scope order. */
    private childDescriptions(refInfo: ReferenceInfo, path: string): AstNodeDescription[] {
        const prefix = path + '.';
        const seen = new Set<string>();
        return this.scopeProvider.getScope(refInfo).getAllElements().filter(description => {
            if (!description.name.startsWith(prefix)) return false;
            if (description.name.slice(prefix.length).includes('.')) return false;
            if (seen.has(description.name)) return false;
            seen.add(description.name);
            return true;
        }).toArray();
    }

    /** The dotted path that ends right at the cursor, if the cursor follows a dot. */
    private hierarchicalPathBefore(context: CompletionContext): HierarchicalPath | undefined {
        const text = context.textDocument.getText();
        const lineStart = text.lastIndexOf('\n', context.offset - 1) + 1;
        const linePrefix = text.slice(lineStart, context.offset);
        const match = /([\w\u00A0-\uFFFF][\w\u00A0-\uFFFF.\/:]*)\.$/.exec(linePrefix);
        if (!match) return undefined;
        return { path: match[1], start: lineStart + match.index };
    }
}
