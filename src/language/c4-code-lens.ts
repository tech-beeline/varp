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

import { type  LangiumDocument, type  MaybePromise  } from 'langium';
import { AstUtils , CstUtils } from 'langium';
import { type CodeLensProvider } from 'langium/lsp';
import { CodeLens, Command, type CodeLensParams, Range as LspRange } from 'vscode-languageserver';
import { isRenderedView } from '../generated/ast';
import { C4Services } from './c4-module';
import { DIAGRAM_PREVIEW } from '../shared/commands';

/**
 * Provides CodeLens buttons above each diagram view in the editor.
 * Shows a clickable "Show As Structurizr Diagram" link that opens
 * a preview of the rendered diagram for that specific view.
 */
export class C4CodeLensProvider implements CodeLensProvider {
    private readonly services: C4Services;

    constructor(services: C4Services) {
        this.services = services;
    }
        
    /**
     * Creates CodeLens entries for all rendered views in the document.
     * Each lens is positioned at the first non-whitespace token of the view block
     * and triggers the DIAGRAM_PREVIEW command with the cached JSON and view key.
     */
    provideCodeLens(document: LangiumDocument, params: CodeLensParams): MaybePromise<CodeLens[] | undefined> {
        const lenses: CodeLens[] = [];
        const root = document.parseResult.value;

        // Resolve the root workspace document URI so the open preview can fetch the
        // latest generated JSON from the server cache and match auto-refresh
        // notifications (custom/contentUpdated) against it.
        const rootUri = this.services.generation.C4GeneratorHandler.getRootUri(document.uri.toString());

        // The generated JSON (when already cached) is the source of truth for whether
        // a view actually has content - a view with no elements renders an empty
        // diagram, so no lens is offered for it.
        const cachedJson = this.services.generation.C4GeneratorHandler.getCachedContentForUri(document.uri.toString());

        for (const node of AstUtils.streamAst(root)) {
            if (isRenderedView(node)) {
                const cstNode = node.$cstNode;
                if (cstNode) {

                    // Find the first leaf node at the start of the view block
                    let currentLeaf = CstUtils.findLeafNodeAtOffset(cstNode, cstNode.offset);
                    
                    // Skip whitespace-only tokens (spaces, tabs, newlines)
                    while (currentLeaf) {
                        if (/[^\s]/.test(currentLeaf.text)) {
                            break;
                        }
                        const next = CstUtils.getNextNode(currentLeaf);
                        // Ensure we don't go outside the current view block
                        if (!next || next.offset >= cstNode.offset + cstNode.length) {
                            break;
                        }
                        currentLeaf = CstUtils.findLeafNodeAtOffset(cstNode, next.offset);
                    }

                    // Position the lens at the first meaningful token, or at the block start
                    const startPoint = currentLeaf ? currentLeaf.range.start : cstNode.range.start;                    

                    const lensRange: LspRange = {
                        start: startPoint,
                        end: startPoint
                    };

                    const lens = CodeLens.create(lensRange);

                    // Extract the view key for the preview command
                    const viewKey = this.services.workspace.ViewKeyProvider.getKey(node);

                    // Skip the lens when the generated diagram is known to have no elements.
                    const generatedView = findViewByKey(cachedJson, viewKey);
                    if (generatedView && Array.isArray(generatedView.elements) && generatedView.elements.length === 0) {
                        continue;
                    }

                    lens.command = Command.create(
                        '$(link-external) Show As Structurizr Diagram',
                        DIAGRAM_PREVIEW,
                        viewKey,
                        rootUri
                    );
                    
                    lenses.push(lens);
                }
            }
        }
        
        return lenses;
    }
}

/** View categories in the generated Structurizr JSON, in lookup order. */
const VIEW_GROUPS = [
    'systemLandscapeViews',
    'systemContextViews',
    'containerViews',
    'componentViews',
    'dynamicViews',
    'deploymentViews',
    'filteredViews',
    'customViews',
];

/** Finds a rendered view by its key in the generated JSON, or undefined when absent. */
function findViewByKey(json: any, viewKey: string): any | undefined {
    const views = json?.views;
    if (!views) return undefined;
    for (const group of VIEW_GROUPS) {
        const list = views[group];
        if (Array.isArray(list)) {
            const found = list.find((v: any) => v?.key === viewKey);
            if (found) return found;
        }
    }
    return undefined;
}
