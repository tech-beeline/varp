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
        const preview = diagramPreview;
        if (!preview || !preview.isOpen()) {
            return;
        }

        if (preview.getCurrentDocUri() === uri) {
            // Fast path: the notification belongs to the bound document.
            renderPreviewIfApplicable(uri, json, preview);
            return;
        }

        // The notification is for a different document (many dsl files, fragment
        // edits). It is only relevant to this preview if the notified URI is the
        // ROOT of the document the preview is bound to - then the payload is the
        // fresh JSON for this preview. Check that with ONE cheap getRootUri call
        // instead of fetching JSON on every unrelated generation event.
        if (!languageClient) {
            return;
        }
        try {
            const res: any = await languageClient.sendRequest('custom/getRootUri', { uri: preview.getCurrentDocUri() });
            if (res?.rootUri === uri) {
                renderPreviewIfApplicable(uri, json, preview);
            }
        } catch {
            // unrelated / transient failure - ignore the notification
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

/**
 * Renders freshly generated JSON into the preview, honoring the auto-refresh
 * mode: a pending preview always renders; otherwise onChange renders on every
 * update while onSave only renders when the document is clean (saved). Renders
 * are coalesced via scheduleRefresh so bursts produce one webview update.
 */
function renderPreviewIfApplicable(uri: string, json: any, preview: DiagramPreview): void {
    const mode = getAutoRefreshMode();
    const dirty = isDocumentDirty(uri);
    const pending = preview.isPendingJson();
    if (pending || mode === 'onChange' || !dirty) {
        scheduleRefresh(uri, json);
    }
}

// Coalesces auto-refresh renders to the latest JSON without adding latency: the
// flush is scheduled on the next microtask, so notifications delivered within the
// same tick (a burst of contentUpdated) only produce ONE postMessage + webview
// re-render with the freshest payload - intermediate versions are skipped.
let pendingRefresh: { uri: string; json: any } | undefined;
let refreshQueued = false;

function scheduleRefresh(uri: string, json: any): void {
    pendingRefresh = { uri, json };
    if (refreshQueued) {
        return;
    }
    refreshQueued = true;
    queueMicrotask(() => {
        refreshQueued = false;
        const pending = pendingRefresh;
        pendingRefresh = undefined;
        if (pending) {
            void refreshDiagram(pending.uri, pending.json);
        }
    });
}

/**
 * Finds the view in freshly generated JSON that corresponds to the currently
 * displayed view. View keys embed a CST-offset hash that changes when the source
 * is edited, so the exact key can go stale; matching is done on the stable base
 * prefix (`<TargetName>-<ViewType>`).
 */
function resolveFreshViewKey(json: any, currentKey: string | undefined): string | undefined {
    if (!currentKey) {
        return undefined;
    }
    const dash = currentKey.lastIndexOf('-');
    const prefix = dash > 0 ? currentKey.substring(0, dash) : currentKey;
    for (const bucket of Object.values((json?.views ?? {}) as Record<string, unknown>)) {
        if (!Array.isArray(bucket)) {
            continue;
        }
        for (const v of bucket as any[]) {
            if (!v || typeof v.key !== 'string') {
                continue;
            }
            if (prefix ? v.key.startsWith(prefix + '-') : v.key === currentKey) {
                return v.key;
            }
        }
    }
    return undefined;
}

/** Renders fresh JSON into the open preview bound to the given root document URI. */
async function refreshDiagram(uri: string, json: any): Promise<void> {
    const preview = diagramPreview;
    if (!preview || !preview.isOpen()) {
        return;
    }
    const currentKey = preview.getCurrentViewKey();
    if (!currentKey) {
        return;
    }
    // View keys change when the source shifts, so resolve the matching key in the
    // fresh JSON; updateWebView stores it for subsequent refreshes.
    const viewKey = resolveFreshViewKey(json, currentKey) ?? currentKey;
    // Themes are fetched once when the preview is opened and are already stored
    // on the preview (included in every postMessage), so re-rendering the same
    // diagram must not block on re-fetching theme files.
    await preview.updateWebView(json, viewKey, uri);
}


/**
 * Returns the raw JSON content of the workspace's theme files. The language
 * server already caches them (fetchCache), so this is a cheap cache-backed
 * round-trip; the webview then renders without re-downloading the themes.
 */
async function getThemesForPreview(themeUrls: string[] | undefined): Promise<{ url: string; content: string }[] | undefined> {
    const urls = (Array.isArray(themeUrls) ? themeUrls : []).filter(u => /^https?:\/\//i.test(u));
    if (urls.length === 0 || !languageClient) {
        return []; // no http(s) themes - nothing to inject
    }
    try {
        const res: any = await languageClient.sendRequest('custom/getThemes', { themes: urls });
        const fetched = (Array.isArray(res?.themes) ? res.themes : []) as { url: string; content: string }[];
        // Returning undefined means "could not get themes" - the caller then
        // leaves the preview's themes unset so the webview falls back to
        // loadThemes() instead of rendering without any theme.
        return fetched.length > 0 ? fetched : undefined;
    } catch (err) {
        console.warn('[C4 Preview] theme fetch failed:', err);
        return undefined;
    }
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
                    await refreshDiagram(uri, response.json);
                    return;
                }
            } catch (err) {
                console.error(`[C4 AutoRefresh] Error fetching content on save:`, err);
            }

            // JSON not generated yet - keep the panel open; the push notification
            // (custom/contentUpdated) delivers it once generation completes.
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
        commands.registerCommand(DIAGRAM_PREVIEW, async (viewKey: string, docUri?: string) => {
            // Open the panel immediately so the webview can show the "Rendering"
            // indicator while the JSON is still being generated.
            preview.openPreview(viewKey, docUri);

            // Fetch the latest generated JSON from the language server cache; if it
            // is not ready yet, the panel stays open and the push notification
            // (custom/contentUpdated) delivers the JSON once generation completes.
            let payload: any;
            if (languageClient) {
                try {
                    const res = await languageClient.sendRequest('custom/getContentForUri', { uri: docUri ?? '' });
                    payload = res?.json;
                } catch (err) {
                    console.warn('[C4 Preview] fresh JSON fetch failed:', err);
                }
            }

            if (payload) {
                try {
                    const themes = await getThemesForPreview(payload?.views?.configuration?.themes);
                    if (themes !== undefined) {
                        preview.setThemes(themes);
                    }
                    await preview.updateWebView(payload, viewKey, docUri);

                    // Open a side-panel with the raw JSON for debugging
                    // const content = JSON.stringify(payload, null, 2);
                    // const doc = await workspace.openTextDocument({ content, language: 'json' });
                    
                    // await window.showTextDocument(doc, {
                    //     viewColumn: ViewColumn.Beside,
                    //     preview: true
                    // });
                    
                } catch (err) {
                    console.error(`[C4 Preview] webview update FAILED for view ${viewKey}:`, err);
                }
                return;
            }

            // JSON is not ready yet - keep the panel open with the "Rendering"
            // indicator; the push notification (custom/contentUpdated) delivers
            // the JSON once generation completes.
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
            
            const buffer = new TextEncoder().encode(xml);
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

            const buffer = new TextEncoder().encode(svgResult);
            await workspace.fs.writeFile(uri, buffer);

            window.showInformationMessage('Exported diagram to SVG format.');
        })
    );
}
