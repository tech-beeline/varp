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
import { GrammarUtils, AstUtils } from 'langium';
import { type DocumentLinkProvider } from 'langium/lsp';
import { DocumentLink, type DocumentLinkParams } from 'vscode-languageserver';
import { isInclude, isWorkspace } from '../generated/ast';
import * as includeResolver from './c4-include-resolver';

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
     * clickable links. Resolves through the single shared include-resolution pipeline
     * (quotes, ${CONST}, http(s), relative paths) so links match what the document
     * builder actually loads and what the validator/generator resolve.
     */
    getDocumentLinks(document: LangiumDocument, params: DocumentLinkParams): MaybePromise<DocumentLink[]> {
        const links: DocumentLink[] = [];
        const root = document.parseResult.value;

        const resolveToUri = (rawPath: string, node: AstNode): string | undefined =>
            includeResolver.resolveTargetUri(rawPath, node, {
                constants: (path, n) => includeResolver.substituteConstants(this.services.shared, path, n),
            })?.toString();

        for (const node of AstUtils.streamAst(root)) {
            if (isInclude(node)) {
                const fileNode = GrammarUtils.findNodeForProperty(node.$cstNode, 'file');
                if (fileNode && node.file) {
                    const targetUri = resolveToUri(node.file, node);
                    if (targetUri) {
                        links.push(DocumentLink.create(fileNode.range, targetUri));
                    }
                }
            } else if (isWorkspace(node)) {
                const extendsNode = GrammarUtils.findNodeForProperty(node.$cstNode, 'extendsUri');
                if (extendsNode && node.extendsUri) {
                    const targetUri = resolveToUri(node.extendsUri, node);
                    if (targetUri) {
                        links.push(DocumentLink.create(extendsNode.range, targetUri));
                    }
                }
            }
        }

        return links;
    }
}
