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
        const dirty = isDocumentDirty(uri);
        const pending = preview.isPendingJson();
        // A pending preview (opened before its JSON was ready) must receive the
        // JSON regardless of mode. Otherwise: onChange renders on every update,
        // onSave only when the document is clean (saved).
        if (pending || mode === 'onChange' || !dirty) {
            await refreshDiagram(uri, json);
        }
    });
}

/** Returns the configured auto-refresh mode (defaults to onChange). */
function getAutoRefreshMode(): 'onChange' | 'onSave' {
    const value = workspace.getConfiguration('varp.diagram').get<string>('autoRefresh', 'onChange');
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
 * Polls the language server for the JSON of a preview that was opened before the
 * JSON was ready and delivers it to the panel once available. The push
 * notification (custom/contentUpdated) also delivers it; this is a fallback for
 * notifications that fired before the panel opened or were otherwise missed.
 */
async function deliverPreviewJsonWhenReady(uri: string | undefined, viewKey: string): Promise<void> {
    if (!uri || !languageClient) {
        return;
    }
    const preview = diagramPreview;
    for (let attempt = 0; attempt < 20; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        if (!preview || !preview.isOpen() || !preview.isPendingJson()) {
            return; // already delivered or the panel was closed
        }
        try {
            const res: any = await languageClient.sendRequest('custom/getContentForUri', { uri });
            if (res?.json) {
                latestJsonByUri.set(uri, res.json);
                await preview.updateWebView(res.json, viewKey, uri);
                return;
            }
        } catch {
            // transient failure - keep polling until the timeout below
        }
    }
    console.warn(`[C4 Preview] timed out waiting for JSON of view ${viewKey}`);
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
            const currentDocUri = preview.getCurrentDocUri();
            if (!currentDocUri || document.uri.toString() !== currentDocUri) {
                // The preview is bound to a different document; fragment edits are
                // handled by the custom/contentUpdated push instead.
                return;
            }
            const uri = document.uri.toString();

            // Always pull the freshest JSON from the language server on save so
            // the preview reflects the saved content even if no push has arrived.
            try {
                const response: any = await languageClient?.sendRequest('custom/getContentForUri', { uri });
                if (response?.json) {
                    latestJsonByUri.set(uri, response.json);
                    await refreshDiagram(uri, response.json);
                    return;
                }
            } catch (err) {
                console.error(`[C4 AutoRefresh] Error fetching content on save:`, err);
            }

            // JSON not generated yet - render it as soon as it becomes available.
            const viewKey = preview.getCurrentViewKey();
            if (viewKey) {
                void deliverPreviewJsonWhenReady(uri, viewKey);
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
            // Open the panel immediately so the webview can show the "Rendering"
            // indicator while the JSON is still being generated.
            preview.openPreview(viewKey, docUri);

            // Fetch the freshest JSON from the language server instead of trusting
            // the payload baked into the CodeLens command - it can be stale or
            // missing (async race between lens provision and generation).
            let payload = json;
            if (languageClient) {
                try {
                    const res = await languageClient.sendRequest('custom/getContentForUri', { uri: docUri ?? '' });
                    if (res?.json) {
                        payload = res.json;
                    }
                } catch (err) {
                    console.warn('[C4 Preview] fresh JSON fetch failed:', err);
                }
            }

            if (payload) {
                if (docUri) {
                    latestJsonByUri.set(docUri, payload);
                }
                try {
                    await preview.updateWebView(payload, viewKey, docUri);
                } catch (err) {
                    console.error(`[C4 Preview] webview update FAILED for view ${viewKey}:`, err);
                }
                return;
            }

            // JSON is not ready yet - keep the panel open with the "Rendering"
            // indicator and deliver it once generation completes.
            void deliverPreviewJsonWhenReady(docUri, viewKey);

            // // Open a side-panel with the raw JSON for debugging
            // const content = JSON.stringify(json, null, 2);
            // const doc = await workspace.openTextDocument({ content, language: 'json' });
            //
            // await window.showTextDocument(doc, {
            //     viewColumn: ViewColumn.Beside,
            //     preview: true
            // });
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
