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

import { AstUtils, CstUtils, type AstNode, type LangiumDocument } from 'langium';
import { AstNodeHoverProvider, type LangiumServices } from 'langium/lsp';
import type { Hover, HoverParams } from 'vscode-languageserver';
import {
    isArchetypeInstance, isComponent, isConstant, isContainer, isContainerInstance, isCustomElement,
    isDeploymentNode, isGenericInstance, isGroup, isImplicitRelationship, isInclude,
    isInfrastructureNode, isPerson, isRelationship, isSoftwareSystem, isSoftwareSystemInstance
} from '../generated/ast';
import { C4Utils, declaredIdentifier, describeType } from './c4-utils';
import { declaredTagsOf, groupPathOf } from './c4-expression-values';

/**
 * Hover cards for the C4 DSL: the kind and the name of the hovered node, its description
 * and the details that belong to its type, followed by the comment written above the
 * declaration in the source.
 */
export class C4HoverProvider extends AstNodeHoverProvider {

    constructor(services: LangiumServices) {
        super(services);
    }

    override async getHoverContent(document: LangiumDocument, params: HoverParams): Promise<Hover | undefined> {
        const root = document.parseResult?.value?.$cstNode;
        if (root) {
            const offset = document.textDocument.offsetAt(params.position);
            const leaf = CstUtils.findDeclarationNodeAtOffset(root, offset);
            if (leaf && !leaf.hidden && leaf.offset + leaf.length > offset && leaf.text.trim() !== '') {
                const targets = this.references.findDeclarations(leaf);
                const content = targets.length > 0
                    ? this.combine(targets)
                    : this.nearestContent(leaf.astNode);
                if (content) {
                    return { contents: { kind: 'markdown', value: content } };
                }
            }
        }
        return super.getHoverContent(document, params);
    }

    protected getAstNodeHoverContent(node: AstNode): string | undefined {
        const content = elementContent(node)
            ?? groupContent(node)
            ?? viewContent(node)
            ?? relationshipContent(node)
            ?? constantContent(node)
            ?? includeContent(node);
        if (!content) return undefined;
        const comment = this.leadingComment(node);
        return comment ? `${content}\n\n---\n\n${quote(comment)}` : content;
    }

    private combine(nodes: AstNode[]): string | undefined {
        const contents = nodes
            .map(node => this.getAstNodeHoverContent(node))
            .filter((content): content is string => typeof content === 'string');
        return contents.length > 0 ? contents.join('\n\n') : undefined;
    }

    /** Content of the nearest enclosing node that has a card (view keys, relationships, groups). */
    private nearestContent(leaf: AstNode | undefined): string | undefined {
        let node = leaf;
        while (node) {
            const content = this.getAstNodeHoverContent(node);
            if (content) return content;
            node = node.$container;
        }
        return undefined;
    }

    /** Comment written directly above the node, without the comment markers. */
    private leadingComment(node: AstNode): string | undefined {
        const document = AstUtils.getDocument(node);
        const offset = node.$cstNode?.offset;
        if (!document || offset === undefined) return undefined;
        return leadingComment(document.textDocument.getText(), offset);
    }
}

function elementContent(node: AstNode): string | undefined {
    if (!isElementLike(node)) return undefined;
    const source = node as any;
    const name = text(source.name);
    const id = declaredIdentifier(source);
    const suffix = id && name && id !== name ? ` — ${name}` : '';
    const lines = [`**${describeType(node.$type)}** \`${id ?? name ?? '?'}\`${suffix}`];

    const description = text(source.description ?? source.descriptionProps?.[0]?.value);
    if (description) lines.push('', description);

    const details: string[] = [];
    const technology = text(source.technology ?? source.techProps?.[0]?.value);
    if (technology) details.push(`technology: \`${technology}\``);
    const tags = declaredTagsOf(node);
    if (tags.length > 0) details.push(`tags: ${tags.map(tag => `\`${tag}\``).join(', ')}`);
    const group = groupPathOf(node);
    if (group) details.push(`group: \`${group}\``);
    if (source.instances) details.push(`instances: ${source.instances}`);
    const url = text(source.urlProps?.[0]?.value);
    if (url) details.push(`url: ${url}`);
    const properties = propertyCount(source);
    if (properties > 0) details.push(`properties: ${properties}`);
    if (details.length > 0) lines.push('', details.map(detail => `- ${detail}`).join('\n'));
    return lines.join('\n');
}

function groupContent(node: AstNode): string | undefined {
    if (!isGroup(node)) return undefined;
    const parent = groupPathOf(node);
    const name = text(node.name);
    if (!name) return undefined;
    return `**group** \`${parent ? `${parent}/${name}` : name}\``;
}

function viewContent(node: AstNode): string | undefined {
    if (!node.$type.endsWith('View')) return undefined;
    const source = node as any;
    const key = text(source.key);
    const lines = [`**${describeType(node.$type)}** \`${key ?? ''}\``];
    const title = text(source.titleProps?.[0]?.value);
    if (title) lines.push('', title);
    const description = text(source.description ?? source.descriptionProps?.[0]?.value);
    if (description) lines.push('', description);
    return lines.join('\n');
}

function relationshipContent(node: AstNode): string | undefined {
    if (!isRelationship(node) && !isImplicitRelationship(node)) return undefined;
    const source = node as any;
    const from = source.sourceThis ? 'this' : text(source.source?.ref?.name) ?? text(source.source?.$refText) ?? '?';
    const to = source.targetThis ? 'this' : text(source.target?.ref?.name) ?? text(source.target?.$refText) ?? '?';
    const lines = [`**relationship** \`${from} → ${to}\``];
    const description = text(source.description);
    if (description) lines.push('', description);
    const details: string[] = [];
    const technology = text(source.technology);
    if (technology) details.push(`technology: \`${technology}\``);
    const tags = declaredTagsOf(node);
    if (tags.length > 0) details.push(`tags: ${tags.map(tag => `\`${tag}\``).join(', ')}`);
    if (details.length > 0) lines.push('', details.map(detail => `- ${detail}`).join('\n'));
    return lines.join('\n');
}

function constantContent(node: AstNode): string | undefined {
    if (!isConstant(node)) return undefined;
    const name = text(node.name);
    const value = text(node.value);
    return `**constant** \`${name ?? '?'}\`${value ? ` = \`${value}\`` : ''}`;
}

function includeContent(node: AstNode): string | undefined {
    if (!isInclude(node)) return undefined;
    return `**include** \`${text(node.file) ?? ''}\``;
}

function isElementLike(node: AstNode): boolean {
    return isPerson(node) || isSoftwareSystem(node) || isContainer(node) || isComponent(node)
        || isCustomElement(node) || isDeploymentNode(node) || isInfrastructureNode(node)
        || isSoftwareSystemInstance(node) || isContainerInstance(node)
        || isGenericInstance(node) || isArchetypeInstance(node);
}

function propertyCount(node: any): number {
    const blocks = Array.isArray(node.properties) ? node.properties : [];
    return blocks.reduce((total: number, block: any) => total + (block?.items?.length ?? 0), 0);
}

function text(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    const trimmed = C4Utils.stripQuotes(String(value)).trim();
    return trimmed || undefined;
}

/** Comment directly above `offset`, without the markers. */
function leadingComment(text: string, offset: number): string | undefined {
    let before = text.slice(0, offset).replace(/[ \t\r\n]+$/, '');
    if (before.endsWith('*/')) {
        const start = before.lastIndexOf('/*');
        if (start >= 0) {
            const body = before.slice(start + 2, before.length - 2)
                .split(/\r?\n/)
                .map(line => line.replace(/^\s*\*?\s?/, '').trimEnd())
                .join('\n')
                .trim();
            return body || undefined;
        }
    }

    const lines: string[] = [];
    while (before.length > 0) {
        const lineStart = before.lastIndexOf('\n') + 1;
        const line = before.slice(lineStart).trim();
        if (!line.startsWith('//')) break;
        lines.unshift(line.replace(/^\/\/\s?/, ''));
        before = before.slice(0, Math.max(0, lineStart - 1)).replace(/[ \t\r\n]+$/, '');
    }
    return lines.length > 0 ? lines.join('\n') : undefined;
}

function quote(comment: string): string {
    return comment.split(/\r?\n/).map(line => `> ${line}`.trimEnd()).join('\n');
}
