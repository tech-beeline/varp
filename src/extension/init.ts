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

import { commands, ExtensionContext, workspace, window, Uri } from "vscode";
import { C4Snippets } from "./c4-snippets";
import { CapabilityProvider } from "./capabilities";
import { DIAGRAM_PREVIEW } from "./config";
import { DiagramPreview } from "./diagram-preview";
import { PatternProvider } from "./patterns";

/**
 * Minimal shape of the language client (node or browser) used by the extension.
 * Both vscode-languageclient/node and vscode-languageclient/browser implement it.
 */
export interface C4LanguageClient {
    onNotification(method: string, handler: (params: any) => void): void;
    sendRequest(method: string, params: any): Promise<any>;
}

// Holds the Language Client reference for backend communication
let languageClient: C4LanguageClient | undefined;

// Diagram preview panel instance, created in init() and used by the
// auto-refresh notification handler registered in setLanguageClient().
let diagramPreview: DiagramPreview | undefined;

// Latest generated JSON per root document URI (fed by custom/contentUpdated).
// Lets the onSave mode render the freshest data on the save event even if the
// server does not emit another notification for that save.
const latestJsonByUri = new Map<string, any>();

// Guards against registering the notification handler more than once.
let refreshNotificationRegistered = false;

/**
 * Sets the Language Client used for communicating with the language server backend.
 * Called after the language server starts successfully.
 */
export function setLanguageClient(client: C4LanguageClient): void {
    languageClient = client;
    registerAutoRefreshNotification(client);
}

/**
 * Registers the LSP notification listener that refreshes the open diagram preview
 * whenever the language server successfully generates fresh JSON (push model).
 * The client only updates once the JSON is actually ready, which avoids the race
 * of pulling on save before the server finishes generation.
 *
 * Refresh policy is controlled by the `varp.diagram.autoRefresh` setting:
 *  - "onChange" — update on every generated JSON (live while editing);
 *  - "onSave"   — update only once the document is clean (saved).
 */
function registerAutoRefreshNotification(client: C4LanguageClient): void {
    if (refreshNotificationRegistered) {
        return;
    }
    refreshNotificationRegistered = true;

    client.onNotification('custom/contentUpdated', async (params: { uri: string; json: any }) => {
        const uri = params?.uri;
        const json = params?.json;
        if (!uri || !json) {
            return;
        }
        // Remember the latest JSON so onSave mode can render it on the save event.
        latestJsonByUri.set(uri, json);

        const preview = diagramPreview;
        if (!preview || !preview.isOpen()) {
            return;
        }
        if (preview.getCurrentDocUri() !== uri) {
            // The fresh JSON belongs to a different workspace document.
            return;
        }

        const mode = getAutoRefreshMode();
        // onChange: render on every update; onSave: render only when the document
        // is clean (saved) — the save event handles the actual render.
        if (mode === 'onChange' || !isDocumentDirty(uri)) {
            await refreshDiagram(uri, json);
        }
    });
}

/** Returns the configured auto-refresh mode (defaults to onSave). */
function getAutoRefreshMode(): 'onChange' | 'onSave' {
    const value = workspace.getConfiguration('varp.diagram').get<string>('autoRefresh', 'onSave');
    return value === 'onChange' ? 'onChange' : 'onSave';
}

/** Whether the given document has unsaved changes (is dirty). */
function isDocumentDirty(uri: string): boolean {
    const doc = workspace.textDocuments.find(d => d.uri.toString() === uri);
    return doc ? doc.isDirty : false;
}

/** Renders fresh JSON into the open preview bound to the given root document URI. */
async function refreshDiagram(uri: string, json: any): Promise<void> {
    const preview = diagramPreview;
    if (!preview || !preview.isOpen()) {
        return;
    }
    const viewKey = preview.getCurrentViewKey();
    if (!viewKey) {
        return;
    }
    await preview.updateWebView(json, viewKey, uri);
}

/**
 * Initializes all VS Code extension components: views, commands, and event handlers.
 * 
 * Sets up:
 * - Tree views (snippets, capabilities, patterns)
 * - Diagram preview webview panel
 * - Auto-refresh via custom/contentUpdated push notifications (onChange/onSave, see c4.autoRefresh)
 * - DIAGRAM_PREVIEW command (opens diagram in webview)
 * - Export commands (DrawIO, SVG)
 */
export function init(context: ExtensionContext): void {

    new C4Snippets(context);    
    new CapabilityProvider(context);
    new PatternProvider(context);

    diagramPreview = new DiagramPreview(context);
    // Local, non-undefined alias used by the command handlers below.
    const preview = diagramPreview;

    /**
     * Auto-refresh (onSave mode): when a .c4/.dsl file is saved, render the latest
     * generated JSON for the document the open preview is bound to. Live updates
     * (onChange mode) arrive via the custom/contentUpdated notification and do not
     * need the save event.
     */
    context.subscriptions.push(
        workspace.onDidSaveTextDocument(async (document) => {
            if (document.languageId !== 'c4') {
                return;
            }
            if (getAutoRefreshMode() !== 'onSave') {
                return;
            }
            const currentDocUri = preview.getCurrentDocUri();
            if (!currentDocUri || document.uri.toString() !== currentDocUri) {
                return;
            }

            const uri = document.uri.toString();
            const json = latestJsonByUri.get(uri);
            if (json) {
                await refreshDiagram(uri, json);
                return;
            }
            // Fallback: pull fresh JSON from the language server (best effort) if no
            // push notification has been received yet for this document.
            try {
                const response: any = await languageClient?.sendRequest('custom/getContentForUri', { uri });
                if (response?.json) {
                    latestJsonByUri.set(uri, response.json);
                    await refreshDiagram(uri, response.json);
                }
            } catch (err) {
                console.error(`[C4 AutoRefresh] Error fetching content on save:`, err);
            }
        })
    );

    // Apply the auto-refresh setting live without restarting VS Code.
    context.subscriptions.push(
        workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('varp.diagram.autoRefresh')) {
                console.log(`[C4 AutoRefresh] Refresh mode: ${getAutoRefreshMode()}`);
            }
        })
    );

    /**
     * DIAGRAM_PREVIEW command handler.
     * Opens the Structurizr diagram preview for a specific view.
     * Triggered by the CodeLens "Show As Structurizr Diagram" button in the editor.
     */
    context.subscriptions.push(
        commands.registerCommand(DIAGRAM_PREVIEW, async (json: any, viewKey: string, docUri?: string) => {
            // Guard clause: skip if no JSON data provided
            if (!json) {
                return;
            }
            if (docUri) {
                latestJsonByUri.set(docUri, json);
            }

            // Update the diagram preview webview
            await preview.updateWebView(json, viewKey, docUri);
        })
    );

    // ===== Command: Export to DrawIO =====
    context.subscriptions.push(
        commands.registerCommand('varp.export-drawio', async () => {
            const currentJson = preview.getCurrentJson();
            const currentViewKey = preview.getCurrentViewKey();

            if (!currentJson) {
                window.showErrorMessage('No diagram data available. Please open a diagram preview first.');
                return;
            }

            // Ensure webview is open
            if (!preview.isOpen()) {
                preview.updateWebView(currentJson, currentViewKey || '');
            }

            // Wait for the webview to export to DrawIO format via postMessage
            const drawioResult = await new Promise<any>((resolve) => {
                const panel = (preview as any).panel;
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
            const currentJson = preview.getCurrentJson();
            const currentViewKey = preview.getCurrentViewKey();

            if (!currentJson) {
                window.showErrorMessage('No diagram data available. Please open a diagram preview first.');
                return;
            }

            if (!preview.isOpen()) {
                preview.updateWebView(currentJson, currentViewKey || '');
            }

            // Wait for the webview to render and export SVG via postMessage
            const svgResult = await new Promise<string | null>((resolve) => {
                const panel = (preview as any).panel;
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
