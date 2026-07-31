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

import { commands, ExtensionContext, ViewColumn, workspace, window, Uri } from "vscode";
import { LanguageClient } from "vscode-languageclient/node";
import { C4Snippets } from "./c4-snippets";
import { CapabilityProvider } from "./capabilities";
import { DIAGRAM_PREVIEW } from "./config";
import { DiagramPreview } from "./diagram-preview";
import { PatternProvider } from "./patterns";

// Holds the Language Client reference for backend communication
let languageClient: LanguageClient | undefined;

/**
 * Sets the Language Client used for communicating with the language server backend.
 * Called after the language server starts successfully.
 */
export function setLanguageClient(client: LanguageClient): void {
    languageClient = client;
}

/**
 * Initializes all VS Code extension components: views, commands, and event handlers.
 * 
 * Sets up:
 * - Tree views (snippets, capabilities, patterns)
 * - Diagram preview webview panel
 * - Auto-refresh on DSL file save (re-fetches JSON from language server)
 * - DIAGRAM_PREVIEW command (opens diagram in webview)
 * - Export commands (DrawIO, SVG)
 */
export function init(context: ExtensionContext): void {

    new C4Snippets(context);    
    new CapabilityProvider(context);
    new PatternProvider(context);

    const diagramPreview = new DiagramPreview(context);

    /**
     * Auto-refresh handler: when a .c4/.dsl file is saved, automatically
     * updates the open diagram preview with the latest generated JSON data.
     * 
     * Flow:
     * 1. Check if the saved file is a C4 DSL file
     * 2. Check if a diagram preview is currently open
     * 3. Request fresh JSON/dot data from the language server via custom LSP request
     * 4. Send the new data to the webview for re-rendering
     */
    context.subscriptions.push(
        workspace.onDidSaveTextDocument(async (document) => {
            // Only process C4/DSL files
            if (document.languageId !== 'c4') {
                return;
            }

            // Skip refresh if no diagram is open
            if (!diagramPreview.isOpen()) {
                console.log(`[C4 AutoRefresh] Diagram is not open, skipping refresh`);
                return;
            }

            // Get the current view key for the open diagram
            const currentViewKey = diagramPreview.getCurrentViewKey();
            if (!currentViewKey || !languageClient) {
                console.log(`[C4 AutoRefresh] Missing viewKey or languageClient`);
                return;
            }

            try {
                console.log(`[C4 AutoRefresh] File saved, fetching fresh content for view: ${currentViewKey}`);
                
                // Request the latest JSON/dot data from the language server
                // The C4GeneratorHandler has already updated the cache on save
                const response: any = await languageClient.sendRequest('custom/getContentForUri', {
                    uri: document.uri.toString()
                });

                if (response && response.json) {
                    console.log(`[C4 AutoRefresh] Received fresh data, processing styles and SVG`);
                    // Send the new data to the webview for re-rendering
                    await diagramPreview.updateWebView(response.json, currentViewKey);
                    console.log(`[C4 AutoRefresh] Diagram updated successfully for view: ${currentViewKey}`);
                } else {
                    console.warn(`[C4 AutoRefresh] No content received from backend`);
                }
            } catch (err) {
                console.error(`[C4 AutoRefresh] Error updating diagram:`, err);
            }
        })
    );

    /**
     * DIAGRAM_PREVIEW command handler.
     * Opens the Structurizr diagram preview for a specific view.
     * Triggered by the CodeLens "Show As Structurizr Diagram" button in the editor.
     */
    context.subscriptions.push(
        commands.registerCommand(DIAGRAM_PREVIEW, async (json: any, viewKey: string) => {
            // Guard clause: skip if no JSON data provided
            if (!json) {
                return;
            }

            // Update the diagram preview webview
            diagramPreview.updateWebView(json, viewKey);

            // Open a side-panel with the raw JSON for debugging
            const content = JSON.stringify(json, null, 2);
            const doc = await workspace.openTextDocument({ content, language: 'json' });
            
            await window.showTextDocument(doc, {
                viewColumn: ViewColumn.Beside,
                preview: true
            });
        })
    );

    // ===== Command: Export to DrawIO =====
    context.subscriptions.push(
        commands.registerCommand('varp.export-drawio', async () => {
            const currentJson = diagramPreview.getCurrentJson();
            const currentViewKey = diagramPreview.getCurrentViewKey();

            if (!currentJson) {
                window.showErrorMessage('No diagram data available. Please open a diagram preview first.');
                return;
            }

            // Ensure webview is open
            if (!diagramPreview.isOpen()) {
                diagramPreview.updateWebView(currentJson, currentViewKey || '');
            }

            // Wait for the webview to export to DrawIO format via postMessage
            const drawioResult = await new Promise<any>((resolve) => {
                const panel = (diagramPreview as any).panel;
                if (!panel) {
                    resolve(null);
                    return;
                }

                const disposable = panel.webview.onDidReceiveMessage((message: any) => {
                    if (message.command === 'drawio-result') {
                        disposable.dispose();
                        resolve(message.results);
                    }
                });

                // Request DrawIO export from the webview
                panel.webview.postMessage({ command: 'export-drawio' });
            });

            if (!drawioResult || drawioResult.length === 0) {
                window.showErrorMessage('Failed to export diagrams to DrawIO format.');
                return;
            }

            // Save as .drawio file
            const uri = await window.showSaveDialog({
                filters: { 'DrawIO Diagrams': ['drawio'] },
                defaultUri: workspace.workspaceFolders?.[0]?.uri 
                    ? Uri.joinPath(workspace.workspaceFolders[0].uri, 'export.drawio')
                    : undefined
            });

            if (!uri) return; // user cancelled

            const xml = drawioResult[0]?.xml;
            if (!xml) {
                window.showErrorMessage('Failed to generate DrawIO XML.');
                return;
            }
            
            const buffer = Buffer.from(xml, 'utf-8');
            await workspace.fs.writeFile(uri, buffer);
            
            window.showInformationMessage(`Exported diagram to DrawIO format.`);
        })
    );

    // ===== Command: Export to SVG =====
    context.subscriptions.push(
        commands.registerCommand('varp.export-svg', async () => {
            const currentJson = diagramPreview.getCurrentJson();
            const currentViewKey = diagramPreview.getCurrentViewKey();

            if (!currentJson) {
                window.showErrorMessage('No diagram data available. Please open a diagram preview first.');
                return;
            }

            if (!diagramPreview.isOpen()) {
                diagramPreview.updateWebView(currentJson, currentViewKey || '');
            }

            // Wait for the webview to render and export SVG via postMessage
            const svgResult = await new Promise<string | null>((resolve) => {
                const panel = (diagramPreview as any).panel;
                if (!panel) { resolve(null); return; }

                const disposable = panel.webview.onDidReceiveMessage((message: any) => {
                    if (message.command === 'svg-result') {
                        disposable.dispose();
                        resolve(message.svg);
                    }
                });

                // Request SVG export from the webview
                panel.webview.postMessage({ command: 'export-svg' });
            });

            if (!svgResult) {
                window.showErrorMessage('Failed to export diagram to SVG.');
                return;
            }

            const uri = await window.showSaveDialog({
                filters: { 'SVG Images': ['svg'] },
                defaultUri: workspace.workspaceFolders?.[0]?.uri 
                    ? Uri.joinPath(workspace.workspaceFolders[0].uri, 'export.svg')
                    : undefined
            });

            if (!uri) return;

            const buffer = Buffer.from(svgResult, 'utf-8');
            await workspace.fs.writeFile(uri, buffer);

            window.showInformationMessage('Exported diagram to SVG format.');
        })
    );
}
