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
  ExtensionContext,
  Uri,
  ViewColumn,
  WebviewPanel,
  window,
  workspace
} from "vscode";
import { applyWorkspaceFileMetadata } from "./workspace-metadata";

/** Random nonce for the webview's inline script, per the VS Code webview CSP guidance. */
function getNonce(): string {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export class DiagramPreview {
  private panel: WebviewPanel | undefined;
  private currentViewKey: string | undefined;
  private currentJson: any | undefined;
  private currentDocUri: string | undefined;

  // Generation of the workspace JSON the webview has ALREADY built for the
  // current currentDocUri. When updateWebView is called again for the same URI
  // with the SAME generation, the DSL did not change, so only a changeView is
  // needed (a different diagram of the same workspace), not a full rebuild.
  // generation is the build counter reported by the language server
  // (C4GeneratorHandler) - it's the only thing we need to track here because
  // currentDocUri already identifies the document.
  private renderedGeneration: number | undefined;

  // Theme contents fetched for the open preview. Kept so a rebuild (a new
  // generation) re-applies them instead of leaving structurizr.ui.themes empty.
  private currentThemes: { url: string; content: string }[] | undefined;

  // Whether the themes of the current open preview were already requested, so a
  // refresh does not fetch them again.
  private themesFetched = false;

  // Webview readiness handshake: the webview signals it has finished loading
  // (all scripts parsed) before we send the JSON payload. Without this, the
  // first postMessage to a freshly created webview can be dropped, leaving the
  // preview empty until the next auto-refresh arrives.
  private panelReady = false;
  private pendingMessage: { uri?: string; json: any; viewKey: string; themes?: { url: string; content: string }[]; generation?: number; rebuild: boolean; textMeasurements?: Record<string, any>; loadThemes?: boolean } | undefined;

  // Themed delivery held back until the webview has built the theme-less workspace
  // (its 'workspace-built' report). Delivering it earlier replaces the buffered
  // theme-less payload before it is ever painted.
  private pendingThemedDelivery: { json: any; viewKey: string; docUri?: string; generation?: number; textMeasurements?: Record<string, any>; themes?: { url: string; content: string }[]; loadThemes?: boolean } | undefined;

  /**
   * Re-runs the auto-layout with the text widths the webview measured, and returns
   * the views to re-render. Set by the extension (it owns the language client);
   * absent when the preview is used without one.
   */
  public requestRelayout?: (widths: Record<string, number>, uri?: string, generation?: number) => Promise<void>;

  // True while the preview is open but its first JSON payload has not been
  // delivered yet - the webview shows the "Rendering" indicator until then.
  // Set by openPreview(), cleared when updateWebView() delivers the JSON.
  private pendingJson = false;

  private readonly title: string = 'Diagram Preview';
  private readonly id: string = 'structurizrPreview';

  private readonly jsjquery: Uri;
  private readonly jsjointcore: Uri;
  private readonly jsjointdirectedgraps: Uri;
  private readonly jsdagre: Uri;
  private readonly jsgraphlib: Uri;
  private readonly jspanzoom: Uri;
  private readonly jsstructurizr: Uri;
  private readonly jsstructurizrutil: Uri;
  private readonly jsstructurizrui: Uri;
  private readonly jsstructurizrworkspace: Uri;
  private readonly jsstructurizrdiagram: Uri;
  private readonly jsstructurizrdrawio: Uri;
  private readonly cssstructurizrstatic: Uri;
  private readonly cssstructurizr: Uri;  
  private readonly localResourceRoots: Uri[];

  constructor(context: ExtensionContext) {
    this.jsjquery = Uri.joinPath(context.extensionUri, 'js', 'jquery-3.7.1.min.js');
    this.jsjointcore = Uri.joinPath(context.extensionUri, 'js', 'jointjs-Core-4.1.3.js');
    this.jsjointdirectedgraps = Uri.joinPath(context.extensionUri, 'js', 'jointjs-DirectedGraph-4.1.3.min.js');
    this.jsdagre = Uri.joinPath(context.extensionUri, 'js', 'dagre-1.1.8.js');
    this.jsgraphlib = Uri.joinPath(context.extensionUri, 'js', 'graphlib-2.2.4.min.js');
    this.jspanzoom = Uri.joinPath(context.extensionUri, 'js', 'panzoom.min.js');
    this.jsstructurizr = Uri.joinPath(context.extensionUri, 'js', 'structurizr.js');    
    this.jsstructurizrutil = Uri.joinPath(context.extensionUri, 'js', 'structurizr-util.js');    
    this.jsstructurizrui = Uri.joinPath(context.extensionUri, 'js', 'structurizr-ui.js');        
    this.jsstructurizrworkspace = Uri.joinPath(context.extensionUri, 'js', 'structurizr-workspace.js');    
    this.jsstructurizrdiagram = Uri.joinPath(context.extensionUri, 'js', 'structurizr-diagram.js');
    this.jsstructurizrdrawio = Uri.joinPath(context.extensionUri, 'js', 'structurizr-drawio.js');

    this.cssstructurizrstatic = Uri.joinPath(context.extensionUri, 'css', 'structurizr-static.css');
    this.cssstructurizr = Uri.joinPath(context.extensionUri, 'css', 'structurizr.css');
        
    this.localResourceRoots = [Uri.joinPath(context.extensionUri, 'css'), Uri.joinPath(context.extensionUri, 'js')];
  }

  public async updateWebView(json : any, viewKey : string, docUri? : string, themes : { url: string; content: string }[] | undefined = undefined, generation?: number, textMeasurements?: Record<string, any>, loadThemes?: boolean) {
        console.log(`[C4 Gen] View Key: ${viewKey}`);
        const themesProvided = themes !== undefined;
        if (themesProvided) {
          this.currentThemes = themes;
          // The themes are applied by this very delivery; a deferred one is stale.
          this.pendingThemedDelivery = undefined;
        } else if (this.pendingThemedDelivery) {
          // Keep the deferred themed delivery on the latest payload: a drawio import
          // (or any newer generation) may have changed the layout meanwhile, and the
          // themed pass must rebuild that, not the snapshot taken in deliver().
          this.pendingThemedDelivery = { ...this.pendingThemedDelivery, json, viewKey, docUri, generation, textMeasurements };
        }
        // Same document + same generation → the webview already built this exact
        // workspace JSON, so only a view switch is needed (no full rebuild).
        // Compared against the document bound by the previous call, before it is
        // replaced below. Newly provided themes, and the theme fallback, force a rebuild.
        const sameWorkspace = docUri !== undefined
            && docUri === this.currentDocUri
            && !themesProvided
            && loadThemes !== true
            && this.renderedGeneration !== undefined
            && generation !== undefined
            && generation === this.renderedGeneration;
        this.currentViewKey = viewKey;
        this.currentJson = json;
        if (docUri) {
          this.currentDocUri = docUri;
        }
        this.panel ??= this.createPanel();
        this.pendingJson = false;
        // Remember what we asked the webview to (re)build; on a full rebuild the
        // webview stores it back via the 'workspace-built' message (see below).
        // Text measurement candidates are only meaningful for a (re)built workspace:
        // the webview measures them once it has the workspace styles, then reports
        // the widths back for the second layout pass.
        const measureText = textMeasurements !== undefined && Object.keys(textMeasurements).length > 0 && !sameWorkspace;
        const message = { 'uri': docUri, 'json': json, 'viewKey': viewKey, 'themes': this.currentThemes, 'generation': generation, 'rebuild': !sameWorkspace, 'textMeasurements': measureText ? textMeasurements : undefined, 'loadThemes': loadThemes === true || undefined };
        if (this.panelReady) {
          this.panel.webview.postMessage(message);
        } else {
          // The webview is still loading - hold on to the latest payload and
          // deliver it as soon as the webview signals it is ready.
          this.pendingMessage = { uri: docUri, json, viewKey, themes: this.currentThemes, generation, rebuild: !sameWorkspace, textMeasurements: measureText ? textMeasurements : undefined, loadThemes: loadThemes === true || undefined };
        }
  }

  /**
   * Delivers a workspace JSON to the webview and, when the preview has no themes
   * yet, applies the workspace's themes in a second delivery.
   *
   * The first delivery deliberately renders WITHOUT styles: a themed render loads
   * the theme's icon images, and the panel displays the exported SVG, so the export
   * has to inline every icon - which delays the first paint by seconds on large
   * diagrams. The diagram therefore appears immediately unstyled and is re-rendered
   * once the themes arrive.
   */
  public async deliver(
        json: any,
        viewKey: string,
        docUri: string | undefined,
        generation: number | undefined,
        textMeasurements: Record<string, any> | undefined,
        fetchThemes?: (urls: string[] | undefined) => Promise<{ url: string; content: string }[] | undefined>
  ): Promise<void> {
        await this.applyFileMetadata(json, docUri);
        await this.updateWebView(json, viewKey, docUri, undefined, generation, textMeasurements);
        if (this.currentThemes !== undefined || this.themesFetched || !fetchThemes) {
          return;
        }
        this.themesFetched = true;
        const declared = json?.views?.configuration?.themes;
        const themes = await fetchThemes(declared);
        // The themed re-render must not replace the buffered theme-less payload before
        // it is painted: the webview may still be loading (the theme fetch is
        // cache-backed and returns in milliseconds). It is therefore held back until
        // the webview reports it built the theme-less workspace (see the
        // 'workspace-built' handler below).
        if (themes !== undefined) {
          this.pendingThemedDelivery = { json, viewKey, docUri, generation, textMeasurements, themes };
        } else if (Array.isArray(declared) && declared.length > 0) {
          // The workspace declares themes but the server could not provide them
          // (unreachable URL, or a built-in theme the server does not resolve):
          // let the webview load them itself, once it has rendered the workspace.
          this.pendingThemedDelivery = { json, viewKey, docUri, generation, textMeasurements, loadThemes: true };
        }
        // If the theme-less workspace was already built (the theme fetch resolved
        // after it), no further 'workspace-built' report is coming for this
        // generation - send the deferred delivery now.
        if (this.pendingThemedDelivery && this.renderedGeneration === generation) {
          await this.flushPendingThemedDelivery();
        }
  }

  /**
   * Sends the deferred themed delivery, once the webview has built the theme-less
   * workspace. Either injects the theme contents fetched by the server, or, when the
   * server could not provide them, re-sends the JSON with the declared themes so the
   * webview loads them itself.
   */
  private async flushPendingThemedDelivery(): Promise<void> {
        const pending = this.pendingThemedDelivery;
        if (!pending) {
          return;
        }
        this.pendingThemedDelivery = undefined;
        await this.updateWebView(pending.json, pending.viewKey, pending.docUri, pending.themes, pending.generation, pending.textMeasurements, pending.loadThemes);
  }

  /**
   * Adds the workspace file's timestamp to the JSON before it reaches the webview,
   * so the diagram metadata block can show when the workspace last changed. The
   * file system API is used instead of the language server's provider because the
   * latter has no file access in the web build.
   */
  private async applyFileMetadata(json: any, docUri: string | undefined): Promise<void> {
        if (!json || !docUri) {
          return;
        }
        try {
          const stat = await workspace.fs.stat(Uri.parse(docUri));
          applyWorkspaceFileMetadata(json, stat.mtime);
        } catch {
          // Untitled documents and schemes without a timestamp: keep the date unset.
          applyWorkspaceFileMetadata(json, undefined);
        }
  }

  /**
   * Opens the preview panel for a view without a JSON payload yet. The webview
   * shows the "Rendering" indicator until updateWebView() delivers the JSON
   * (via the c4/contentUpdated push notification or a retry fetch).
   */
  public openPreview(viewKey: string, docUri?: string): void {
        this.currentViewKey = viewKey;
        this.currentJson = undefined;
        // A new document (or a freshly created panel) starts without themes: the
        // first render must not wait for the theme's icon images, which make the SVG
        // export that the panel shows much slower. The themes are fetched and
        // delivered in a second pass (see deliver()).
        if (!this.panel || docUri === undefined || docUri !== this.currentDocUri) {
          this.currentThemes = undefined;
          this.themesFetched = false;
          this.pendingThemedDelivery = undefined;
        }
        if (docUri) {
          this.currentDocUri = docUri;
        }
        this.pendingJson = true;
        if (!this.panel) {
          // A freshly created webview has built no workspace yet, so nothing is
          // reusable for it.
          this.renderedGeneration = undefined;
        }
        this.panel ??= this.createPanel();
  }

  /** Whether the preview is open and waiting for its first JSON payload. */
  public isPendingJson(): boolean {
        return this.pendingJson;
  }

  /** Generation of the workspace JSON the webview has already built. */
  public getRenderedGeneration(): number | undefined {
        return this.renderedGeneration;
  }

  public getCurrentViewKey(): string | undefined {
        return this.currentViewKey;
  }

  public getCurrentDocUri(): string | undefined {
        return this.currentDocUri;
  }

  public getCurrentJson(): any | undefined {
        return this.currentJson;
  }

  public isOpen(): boolean {
        return this.panel !== undefined;
  }

  private createPanel(): WebviewPanel {
    const panel = window.createWebviewPanel(
      this.id,
      this.title,
      ViewColumn.Two,
      {
        retainContextWhenHidden: true,
        enableScripts: true,
        localResourceRoots: this.localResourceRoots
      }
    );

    // Layout runs in the TypeScript generator: it bakes element positions and
    // vertices into the view JSON and clears view.automaticLayout, so the webview
    // renders those coordinates as-is. The vendored dagre layout is kept only as
    // a fallback for views without pre-computed positions.
    //
    // The CSP allows the local scripts/styles (webview.cspSource), the inline
    // styles the renderer writes and the SVG it injects ('unsafe-inline'), the
    // theme icon images over https and as data:/blob: URIs (img-src), and the
    // webview's own theme download for the fallback (connect-src https:). The
    // inline script is authorized by a per-load nonce instead of 'unsafe-inline'.
    const nonce = getNonce();
    panel.webview.html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${panel.webview.cspSource} https: data: blob:; style-src ${panel.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' ${panel.webview.cspSource}; font-src ${panel.webview.cspSource} data:; connect-src ${panel.webview.cspSource} https: data:">
    <meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
    <script type="text/javascript" src="${panel.webview.asWebviewUri(this.jsjquery)}"></script>
    <script type="text/javascript" src="${panel.webview.asWebviewUri(this.jsjointcore)}"></script>
    <script type="text/javascript" src="${panel.webview.asWebviewUri(this.jsdagre)}"></script>
    <script type="text/javascript" src="${panel.webview.asWebviewUri(this.jsgraphlib)}"></script>
    <script type="text/javascript" src="${panel.webview.asWebviewUri(this.jsjointdirectedgraps)}"></script>

    <script type="text/javascript" src="${panel.webview.asWebviewUri(this.jspanzoom)}"></script>
    <script type="text/javascript" src="${panel.webview.asWebviewUri(this.jsstructurizr)}"></script>
    <script type="text/javascript" src="${panel.webview.asWebviewUri(this.jsstructurizrutil)}"></script>
    <script type="text/javascript" src="${panel.webview.asWebviewUri(this.jsstructurizrui)}"></script>
    <script type="text/javascript" src="${panel.webview.asWebviewUri(this.jsstructurizrworkspace)}"></script>
    <script type="text/javascript" src="${panel.webview.asWebviewUri(this.jsstructurizrdiagram)}"></script>
    <script type="text/javascript" src="${panel.webview.asWebviewUri(this.jsstructurizrdrawio)}"></script>

    <link href="${panel.webview.asWebviewUri(this.cssstructurizrstatic)}" rel="stylesheet" media="screen" />
    <link href="${panel.webview.asWebviewUri(this.cssstructurizr)}" rel="stylesheet" media="screen" />

    <title>${this.title}</title>
    <style>
        /* Shown while the diagram JSON is still loading / being rendered. */
        #rendering {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: var(--vscode-font-family, -apple-system, sans-serif);
            font-size: 18px;
            color: var(--vscode-foreground, #cccccc);
            background: var(--vscode-editor-background, #1e1e1e);
            z-index: 1000;
        }
        #rendering .rendering-letter {
            display: inline-block;
            animation: rendering-pulse 1.6s ease-in-out infinite;
        }
        /* Staggered delays make the highlight shimmer across the word. */
        #rendering .rendering-letter:nth-child(1) { animation-delay: 0s; }
        #rendering .rendering-letter:nth-child(2) { animation-delay: 0.08s; }
        #rendering .rendering-letter:nth-child(3) { animation-delay: 0.16s; }
        #rendering .rendering-letter:nth-child(4) { animation-delay: 0.24s; }
        #rendering .rendering-letter:nth-child(5) { animation-delay: 0.32s; }
        #rendering .rendering-letter:nth-child(6) { animation-delay: 0.4s; }
        #rendering .rendering-letter:nth-child(7) { animation-delay: 0.48s; }
        #rendering .rendering-letter:nth-child(8) { animation-delay: 0.56s; }
        #rendering .rendering-letter:nth-child(9) { animation-delay: 0.64s; }
        @keyframes rendering-pulse {
            0%, 100% { opacity: 0.35; }
            50% { opacity: 1; }
        }
    </style>
</head>
<body>
    <div id="rendering"><span class="rendering-letter">R</span><span class="rendering-letter">e</span><span class="rendering-letter">n</span><span class="rendering-letter">d</span><span class="rendering-letter">e</span><span class="rendering-letter">r</span><span class="rendering-letter">i</span><span class="rendering-letter">n</span><span class="rendering-letter">g</span></div>
    <div id="svg"></div>
    <div id="diagram" style="visibility: hidden;"></div>
</body>
</html>

<script nonce="${nonce}">
        var diagram;
        // Text measurement candidates of the last delivered workspace, so a re-render
        // triggered by the theme fallback can measure again with the themed styles.
        var lastTextMeasurements;
        var lastUri;
        var lastGeneration;
        // Key of the view currently displayed; used to keep the user's zoom/pan
        // when the same view is re-rendered (e.g., auto-refresh) and reset the
        // viewport only when switching to a different view.
        var displayedViewKey;
        // View keys embed a CST-offset hash that changes whenever the source is
        // edited (the view's offset shifts), so the same logical view can be
        // re-delivered under a different full key. The stable base prefix
        // (<TargetName>-<ViewType>) is what identifies a view across re-renders.
        function baseViewKey(key) {
            if (!key) return key;
            var dash = key.lastIndexOf('-');
            return dash > 0 ? key.substring(0, dash) : key;
        }
        const vscode = acquireVsCodeApi();
        window.addEventListener('message', event => {
            const message = event.data;
            if(message.json !== undefined) {
              // Same (uri, generation) as the already-built workspace → the DSL
              // did not change; just switch the displayed view (no rebuild).
              if (message.rebuild === false && structurizr.diagram) {
                structurizr.diagram.changeView(message.viewKey);
                return;
              }

              startBuild(message, undefined);
            } else if (message.command === 'export-drawio') {
              // Export current (displayed) view to DrawIO format
              var currentViewKey = structurizr.diagram.getCurrentViewOrFilter ?
                structurizr.diagram.getCurrentViewOrFilter().key : structurizr.diagram.getCurrentView().key;
              structurizr.drawio.exportCurrent(structurizr.workspace, currentViewKey, function(result, error) {
                if (error) {
                  console.error('DrawIO export error:', error);
                  vscode.postMessage({ command: 'drawio-result', error: error });
                } else {
                  vscode.postMessage({ command: 'drawio-result', results: [result] });
                }
              });
            } else if (message.command === 'export-svg') {
              // Export current diagram to SVG
              structurizr.diagram.exportCurrentDiagramToSVG({ metadata: true, crop: true }, function(svgMarkup) {
                vscode.postMessage({ command: 'svg-result', svg: svgMarkup });
              });
            } else if (message.viewKey !== undefined) {
              structurizr.diagram.changeView(message.viewKey);
            }
        });

        // Measures the texts the renderer sizes frames from (name and metadata) with
        // the same font it draws them with, and reports the widths back so the
        // extension can re-run the auto-layout with that space reserved. Frames whose
        // text is wider than their content would otherwise overlap their neighbours.
        function measureFrameTexts(message) {
            if (!message.textMeasurements || !structurizr.workspace) return;
            var context = document.createElement('canvas').getContext('2d');
            var widths = {};
            Object.keys(message.textMeasurements).forEach(function(viewKey) {
                var view = message.textMeasurements[viewKey];
                (view.candidates || []).forEach(function(candidate) {
                    var text;
                    var fontSize;
                    var bold = false;
                    var longestWordOnly = false;
                    var requiredBoxExtra = 0;
                    var frameExtra = 0;
                    if (candidate.kind === 'group-name') {
                        var groupStyle = structurizr.ui.findElementStyle({ type: 'Group', tags: 'Group, Group:' + text });
                        text = candidate.groupName;
                        fontSize = groupStyle.fontSize * 1.4;
                        bold = true;
                        frameExtra = 30 + (groupStyle.icon !== undefined ? 70 : 0);
                    } else {
                        var element = structurizr.workspace.findElementById(candidate.elementId);
                        if (!element) return;
                        var elementStyle = structurizr.ui.findElementStyle(element);
                        if (candidate.kind === 'element-name' || candidate.kind === 'leaf-name') {
                            text = structurizr.util.removeNewlineCharacters(element.name);
                            fontSize = elementStyle.fontSize * 1.4;
                            bold = true;
                        } else if (candidate.kind === 'leaf-description') {
                            text = element.description;
                            fontSize = elementStyle.fontSize;
                        } else {
                            text = structurizr.ui.getMetadataForElement(element, candidate.withTechnology === true);
                            fontSize = elementStyle.fontSize * 0.7;
                        }
                        // A box wraps its text to the box width, so only its longest
                        // unbreakable word can overflow the box.
                        longestWordOnly = candidate.kind === 'leaf-name' || candidate.kind === 'leaf-metadata' || candidate.kind === 'leaf-description';
                        // The renderer wraps a box's text to the box width minus its
                        // padding, and reserves room for a left icon.
                        requiredBoxExtra = 60 + (elementStyle.iconPosition === 'Left' && elementStyle.icon !== undefined ? 75 : 0);
                        // A frame is sized as max(content + 2 * clusterPadding, minimumWidth + 2 * margin)
                        // with minimumWidth = icon + 10 + text and margin = 15 - so the frame
                        // needs the text plus 30px, plus 70px when it shows an icon.
                        frameExtra = 30 + (elementStyle.icon !== undefined ? 70 : 0);
                    }
                    if (!text || !isFinite(fontSize) || fontSize <= 0) return;
                    context.font = (bold ? 'bold ' : '') + fontSize + 'px ' + structurizr.ui.DEFAULT_FONT_NAME;
                    if (longestWordOnly) {
                        var longest = 0;
                        String(text).split(/\s+/).forEach(function(word) {
                            longest = Math.max(longest, context.measureText(word).width);
                        });
                        // Report the box width the renderer needs, not the text width.
                        widths[candidate.key] = longest + requiredBoxExtra;
                    } else {
                        // Frames: report the frame width the renderer will enforce.
                        widths[candidate.key] = context.measureText(text).width + frameExtra;
                    }
                });

            });
            vscode.postMessage({ command: 'text-widths', uri: message.uri, generation: message.generation, widths: widths });
        }

        // Serializes Diagram construction. The renderer keeps a single global
        // structurizr.diagram and a single '#diagram' container (fixed ids), so two
        // Diagram constructors must never overlap: the construction callback fires
        // asynchronously, and a payload delivered meanwhile would reassign the global
        // and wipe the container under the pending callback. A payload that arrives
        // while a build is in progress is queued - the latest wins - and started once
        // the current construction completes.
        var buildInProgress = false;
        var queuedBuild;

        function startBuild(message, measure) {
            if (buildInProgress) {
                queuedBuild = { message: message, measure: measure };
                return;
            }
            buildInProgress = true;
            if (message.json !== undefined) {
                applyWorkspace(message);
            } else {
                // A rebuild of the already-built workspace (theme pass): reset the
                // container and construct a fresh Diagram from the mutated workspace.
                $('#diagram').empty();
                structurizr.diagram = undefined;
                buildDiagram(message, measure);
            }
        }

        function applyWorkspace(message) {
            structurizr.workspace = undefined;
            structurizr.diagram = undefined;
            structurizr.ui.themes = [];
            structurizr.ui.ignoredImages = [];

            // Completely wipe the DOM container of any previous paper/canvas
            // (structurizr.ui.Diagram appends '#diagram-viewport'/'#diagram-canvas'
            // with fixed ids, so a stale one must not remain).
            $('#diagram').empty();

            lastTextMeasurements = message.textMeasurements;
            lastUri = message.uri;
            lastGeneration = message.generation;
            structurizr.workspace = new structurizr.Workspace(message.json);
            if (message.themes !== undefined) {
                applyThemes(message.themes, function() {
                    buildDiagram(message);
                });
            } else {
                buildDiagram(message);
            }
        }

        function finishBuild() {
            buildInProgress = false;
            if (queuedBuild) {
                var queued = queuedBuild;
                queuedBuild = undefined;
                startBuild(queued.message, queued.measure);
            }
        }

        function buildDiagram(message, measure) {
            // Bind the callback to THIS instance, not the global: a superseded build
            // must never act on a later Diagram.
            var diagram = new structurizr.ui.Diagram('diagram', false, function() {
                diagram.onViewChanged(function() {
                    viewChanged(diagram);
                });
                diagram.changeView(message.viewKey);
                // After the Diagram (workspace) is fully constructed, tell the
                // extension which (uri, generation) it built - so a later
                // updateWebView for the SAME pair can skip the rebuild.
                rememberBuiltWorkspace(message);
                // Styles are registered by now, so the frame texts can be measured.
                // The rebuild after the measurement pass must not measure again -
                // the widths are already reserved and it would loop.
                if (measure !== false) {
                    measureFrameTexts(message);
                }
                // The server could not provide the declared themes: load them here,
                // once the diagram is rendered, and create the diagram again in the
                // load callback (see loadThemesInWebview).
                if (message.loadThemes === true) {
                    loadThemesInWebview();
                }
                finishBuild();
            });
            structurizr.diagram = diagram;
        }

        // Loads the workspace themes inside the webview and re-renders when they are
        // applied. A theme that never loads must not block the re-render forever, so
        // the callback also fires after a timeout.
        function loadThemesInWebview() {
            if (!structurizr.workspace) return;
            var configuration = structurizr.workspace.views ? structurizr.workspace.views.configuration : undefined;
            var declared = configuration ? configuration.themes : undefined;
            if (!declared || declared.length === 0) return;
            // Built-in theme names resolve to /static/themes/... which the panel does
            // not serve, so only http(s) themes are worth loading here.
            var loadable = declared.some(function(theme) { return String(theme).indexOf('http') === 0; });
            if (!loadable) return;
            // Discard the current diagram BEFORE loading the themes: loadThemes mutates
            // structurizr.ui.themes, and a diagram rendering while they are being
            // applied finds theme icons with no preloaded metadata. The diagram is
            // created again in the callback, once the themes are in place, so its
            // constructor's preloadImages picks the icons up - the same order the
            // vendor's static viewer uses (it creates its diagram inside this callback).
            structurizr.diagram = undefined;
            var finished = false;
            var finish = function() {
                if (finished) return;
                finished = true;
                rebuildDiagram(true);
            };
            try {
                structurizr.ui.loadThemes(finish);
            } catch (e) {
                console.warn('[C4 Themes] webview theme fallback failed:', e);
                return;
            }
            setTimeout(finish, 10000);
        }

        // Recreates the Diagram from the (mutated) workspace. A refresh() re-renders in
        // place, but only a full rebuild makes the renderer pick up the new element
        // sizes and positions reliably; the viewport reset is harmless because this
        // runs right after the first render.
        function rebuildDiagram(measure) {
            var viewKey = displayedViewKey;
            if (!viewKey && structurizr.diagram) {
                // Fallback for a rebuild that arrives before the first view-changed event.
                var current = structurizr.diagram.getCurrentViewOrFilter
                    ? structurizr.diagram.getCurrentViewOrFilter()
                    : structurizr.diagram.getCurrentView();
                viewKey = current ? current.key : undefined;
            }
            if (!viewKey) return;
            startBuild({
                viewKey: viewKey,
                textMeasurements: measure ? lastTextMeasurements : undefined,
                uri: lastUri,
                generation: lastGeneration
            }, measure === true);
        }

        // Tells the extension which (uri, generation) the webview has finished
        // building a Workspace for - so a later updateWebView for the SAME pair
        // can skip the rebuild and just changeView. Called after each full build.
        function rememberBuiltWorkspace(message) {
            if (message && message.generation !== undefined) {
                vscode.postMessage({
                    command: 'workspace-built',
                    uri: message.uri,
                    generation: message.generation
                });
            }
        }

        // Populates structurizr.ui.themes from theme contents provided by the
        // extension (already cached by the language server), replicating
        // loadTheme's icon base-url resolution and style sorting - no network I/O.
        function applyThemes(themes, callback) {
            var loaded = [];
            if (themes.length === 0) {
                structurizr.ui.themes = [];
                callback();
                return;
            }
            var pending = themes.length;
            function pushTheme(theme) {
                if (theme.elements === undefined) theme.elements = [];
                if (theme.relationships === undefined) theme.relationships = [];
                loaded.push({
                    elements: theme.elements.sort(structurizr.util.sortStyles),
                    relationships: theme.relationships.sort(structurizr.util.sortStyles),
                    logo: theme.logo
                });
                if (--pending <= 0) {
                    structurizr.ui.themes = loaded;
                    callback();
                }
            }
            themes.forEach(function(item) {
                try {
                    var theme = JSON.parse(item.content);
                    var baseUrl = item.url.substring(0, item.url.lastIndexOf('/') + 1);
                    for (var i = 0; i < (theme.elements || []).length; i++) {
                        var style = theme.elements[i];
                        if (style.icon && style.icon.indexOf('http') === -1 && style.icon.indexOf('data:image') === -1) {
                            style.icon = baseUrl + style.icon;
                        }
                    }
                    pushTheme(theme);
                } catch (e) {
                    pushTheme({ elements: [], relationships: [] });
                }
            });
        }

        function viewChanged(diagram) {
            const options = {
                metadata: true,
                crop: false,
                dimensions: false
            }
            const view = diagram.getCurrentViewOrFilter
                ? diagram.getCurrentViewOrFilter()
                : diagram.getCurrentView();
            const viewKey = view ? view.key : undefined;
            // Compare the stable base prefix, not the full key: the CST-offset hash
            // suffix changes on every edit even for the same logical view.
            const sameView = baseViewKey(viewKey) === baseViewKey(displayedViewKey);
            displayedViewKey = viewKey;

            diagram.exportCurrentDiagramToSVG(options, function(svgMarkup) {
              // IMPORTANT: do NOT empty('#diagram') here. #diagram is the live
              // Joint-viewport of the current Diagram - wiping it (asynchronously,
              // after SVG export) can delete the freshly appended canvas of the
              // NEXT Diagram built by the json message handler, leaving it with a
              // detached/zero-size canvas and collapsing all bboxes to (0,0).
              $('#svg').html(svgMarkup);
              $('#rendering').hide();
              // Keep the user's zoom/pan when re-rendering the same view; only
              // reset the viewport when switching to a different view.
              if (!sameView) {
                panzoom.reset({ animate: false });
              }
            });
        }

        const elem = document.getElementById('svg');
        const panzoom = Panzoom(elem, { maxScale: 16 });
        elem.parentElement.addEventListener('wheel', panzoom.zoomWithWheel)

        // Notify the extension that the webview has finished loading (all
        // scripts are parsed) so it can deliver the diagram JSON payload.
        // Without this handshake the first postMessage to a freshly created
        // webview can be dropped, leaving the preview empty.
        vscode.postMessage({ command: 'ready' });
</script>`;

    panel.onDidDispose(() => {
      this.panel = undefined;
      this.panelReady = false;
      this.pendingMessage = undefined;
      this.pendingThemedDelivery = undefined;
      this.pendingJson = false;
    });

    // Ready handshake: deliver any buffered JSON payload once the webview
    // signals it has finished loading.
    panel.webview.onDidReceiveMessage((message) => {
      if (message && message.command === 'ready') {
        this.panelReady = true;
        if (this.pendingMessage) {
          const pending = this.pendingMessage;
          this.pendingMessage = undefined;
          panel.webview.postMessage({ 'uri': pending.uri, 'json': pending.json, 'viewKey': pending.viewKey, 'themes': pending.themes, 'generation': pending.generation, 'rebuild': pending.rebuild, 'textMeasurements': pending.textMeasurements, 'loadThemes': pending.loadThemes });
        }
      } else if (message && message.command === 'text-widths') {
        // The webview measured the frame texts it draws. The language server re-runs
        // the auto-layout with those widths, saves the result in the cached JSON and
        // the preview is rebuilt from that cache.
        if (this.requestRelayout) {
          const widths = message.widths ?? {};
          void this.requestRelayout(widths, message.uri, message.generation);
        }
      } else if (message && message.command === 'workspace-built') {
        // The webview finished (re)building a Workspace. Ignore a stale report for
        // a document the preview is no longer bound to. Subsequent updateWebView
        // calls for the SAME document + generation then only need a changeView
        // instead of a full rebuild.
        if (message.uri === undefined || message.uri === this.currentDocUri) {
          this.renderedGeneration = message.generation;
          // The theme-less workspace is built and rendered - apply the themes now.
          // Only the report of the pending delivery's own (document, generation)
          // proves that build is on screen, so a stale report cannot flush the
          // themed delivery before the theme-less one is painted.
          const pending = this.pendingThemedDelivery;
          if (pending
              && (pending.docUri === undefined || pending.docUri === message.uri)
              && (pending.generation === undefined || pending.generation === message.generation)) {
            void this.flushPendingThemedDelivery();
          }
        }
      }
    });

    return panel;
  }
}
