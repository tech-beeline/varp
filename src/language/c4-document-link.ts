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

import type { AstNode, LangiumCoreServices, LangiumDocument, MaybePromise } from 'langium';
import { GrammarUtils, UriUtils, AstUtils } from 'langium';
import { type DocumentLinkProvider } from 'langium/lsp';
import { DocumentLink, type DocumentLinkParams } from 'vscode-languageserver';
import { isConstant, isInclude, isWorkspace } from '../generated/ast';

/**
 * Provides clickable document links for !include directives and extendsUri properties.
 * Allows users to Ctrl+click on include paths or extends URIs to navigate to the target file.
 * Supports ${CONST} placeholder resolution from local and workspace constants.
 */
export class C4DocumentLinkProvider implements DocumentLinkProvider {
    private readonly services: LangiumCoreServices;

    constructor(services: LangiumCoreServices) {
        this.services = services;
    }

    /**
     * Finds all !include file paths and extendsUri values in the document and creates
     * clickable links. Resolves relative paths to absolute URIs and substitutes
     * ${CONST} placeholders with values from local and workspace constants.
     */
    getDocumentLinks(document: LangiumDocument, params: DocumentLinkParams): MaybePromise<DocumentLink[]> {
        const links: DocumentLink[] = [];
        const root = document.parseResult.value;
        const localConstants = collectConstants(root);

        const resolvePlaceholders = (input: string): string =>
            substituteConstants(input, localConstants, (name) => this.lookupInWorkspace(name, document.uri.toString()));

        for (const node of AstUtils.streamAst(root)) {
            if (isInclude(node)) {
                const fileNode = GrammarUtils.findNodeForProperty(node.$cstNode, 'file');
                if (fileNode && node.file) {
                    try {
                        let targetUriStr = resolvePlaceholders(node.file.replace(/['"]/g, ''));
                        if (!targetUriStr.startsWith('http://') && !targetUriStr.startsWith('https://')) {
                            targetUriStr = UriUtils.resolvePath(UriUtils.dirname(document.uri), targetUriStr).toString();
                        }
                        links.push(DocumentLink.create(
                            fileNode.range,
                            targetUriStr
                        ));
                    } catch (e) {
                        // Ignore invalid URIs
                    }
                }
            } else if (isWorkspace(node)) {
                const extendsNode = GrammarUtils.findNodeForProperty(node.$cstNode, 'extendsUri');
                if (extendsNode && node.extendsUri) {
                    try {
                        let targetUriStr = resolvePlaceholders(node.extendsUri.replace(/['"]/g, ''));
                        if (!targetUriStr.startsWith('http://') && !targetUriStr.startsWith('https://')) {
                            targetUriStr = UriUtils.resolvePath(UriUtils.dirname(document.uri), targetUriStr).toString();
                        }
                        links.push(DocumentLink.create(
                            extendsNode.range,
                            targetUriStr
                        ));
                    } catch (e) {
                        // Ignore invalid URIs
                    }
                }
            }
        }

        return links;
    }

    /**
     * Looks up a constant by name in all workspace documents except the current one.
     * Used as a fallback when a ${CONST} placeholder is not found locally.
     */
    private lookupInWorkspace(name: string, skipDocUri: string): string | undefined {
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

/**
 * Collects all !constant/!const declarations from the given AST root into a map.
 */
function collectConstants(root: AstNode): Map<string, string> {
    const constants = new Map<string, string>();
    AstUtils.streamAllContents(root).filter(isConstant).forEach((c) => {
        const name = (c.name ?? '').toString().replace(/['"]/g, '');
        const rawValue = (c.value ?? '').toString();
        const value = typeof rawValue === 'string' ? rawValue.replace(/^['"]|['"]$/g, '') : rawValue;
        if (name) constants.set(name, value);
    });
    return constants;
}

/**
 * Substitutes ${NAME} placeholders in the input string.
 * Checks local constants first, then falls back to the provided lookup function.
 * Unknown placeholders are left as-is.
 */
function substituteConstants(input: string, localConstants: Map<string, string>, fallback: (name: string) => string | undefined): string {
    if (!input.includes('${')) return input;
    return input.replace(/\$\{([^}]+)\}/g, (match, key) => {
        const trimmed = key.trim();
        if (localConstants.has(trimmed)) return localConstants.get(trimmed)!;
        const fromWorkspace = fallback(trimmed);
        return fromWorkspace ?? match;
    });
}
