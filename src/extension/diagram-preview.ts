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
  window
} from "vscode";

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
  private pendingMessage: { uri?: string; json: any; viewKey: string; themes?: { url: string; content: string }[]; generation?: number; rebuild: boolean; textMeasurements?: Record<string, any> } | undefined;

  /**
   * Re-runs the auto-layout with the text widths the webview measured, and returns
   * the views to re-render. Set by the extension (it owns the language client);
   * absent when the preview is used without one.
   */
  public requestRelayout?: (widths: Record<string, number>, uri?: string, generation?: number) => Promise<any[] | undefined>;

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

  public async updateWebView(json : any, viewKey : string, docUri? : string, themes : { url: string; content: string }[] | undefined = undefined, generation?: number, textMeasurements?: Record<string, any>) {
        console.log(`[C4 Gen] View Key: ${viewKey}`);
        const themesProvided = themes !== undefined;
        if (themesProvided) {
          this.currentThemes = themes;
        }
        // Same document + same generation → the webview already built this exact
        // workspace JSON, so only a view switch is needed (no full rebuild).
        // Compared against the document bound by the previous call, before it is
        // replaced below. Newly provided themes always force a rebuild.
        const sameWorkspace = docUri !== undefined
            && docUri === this.currentDocUri
            && !themesProvided
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
        const message = { 'uri': docUri, 'json': json, 'viewKey': viewKey, 'themes': this.currentThemes, 'generation': generation, 'rebuild': !sameWorkspace, 'textMeasurements': measureText ? textMeasurements : undefined };
        if (this.panelReady) {
          this.panel.webview.postMessage(message);
        } else {
          // The webview is still loading - hold on to the latest payload and
          // deliver it as soon as the webview signals it is ready.
          this.pendingMessage = { uri: docUri, json, viewKey, themes: this.currentThemes, generation, rebuild: !sameWorkspace, textMeasurements: measureText ? textMeasurements : undefined };
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
        await this.updateWebView(json, viewKey, docUri, undefined, generation, textMeasurements);
        if (this.currentThemes !== undefined || this.themesFetched || !fetchThemes) {
          return;
        }
        this.themesFetched = true;
        const declared = json?.views?.configuration?.themes;
        const themes = await fetchThemes(declared);
        if (themes !== undefined) {
          await this.updateWebView(json, viewKey, docUri, themes, generation, textMeasurements);
        } else if (Array.isArray(declared) && declared.length > 0) {
          // The workspace declares themes but the server could not provide them
          // (unreachable URL, or a built-in theme the server does not resolve):
          // let the webview load them itself.
          this.requestThemeFallback();
        }
  }

  /** Asks the webview to load the workspace's themes itself and re-render. */
  public requestThemeFallback(): void {
        if (this.panel && this.panelReady) {
          this.panel.webview.postMessage({ command: 'load-themes' });
        }
  }

  /**
   * Opens the preview panel for a view without a JSON payload yet. The webview
   * shows the "Rendering" indicator until updateWebView() delivers the JSON
   * (via the custom/contentUpdated push notification or a retry fetch).
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

  /**
   * Pushes re-laid-out views (elements, relationship vertices and dimensions) into
   * the open webview, which re-renders them silently, keeping zoom and pan.
   */
  public applyViewCoordinates(views: any[] | undefined): void {
        if (!views || views.length === 0) return;
        // Keep the stored payload in sync: a later rebuild (e.g. when the themes
        // arrive) re-sends it, and a stale copy would undo the second layout pass.
        this.mergeViewCoordinates(views);
        if (this.panel && this.panelReady) {
          this.panel.webview.postMessage({ command: 'apply-coordinates', views });
        }
  }

  /** Replaces the elements/relationships/dimensions of the stored JSON's views. */
  private mergeViewCoordinates(views: any[]): void {
        const collections = ['systemLandscapeViews', 'systemContextViews', 'containerViews', 'componentViews', 'deploymentViews', 'dynamicViews', 'customViews', 'filteredViews', 'imageViews'];
        for (const collection of collections) {
          const list = this.currentJson?.views?.[collection];
          if (!Array.isArray(list)) continue;
          for (const updated of views) {
            const existing = list.find((view: any) => view && view.key === updated.key);
            if (!existing) continue;
            existing.elements = updated.elements;
            existing.relationships = updated.relationships;
            existing.dimensions = updated.dimensions;
          }
        }
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
    panel.webview.html = `
<!DOCTYPE html>
<html lang="en">
<head>
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

<script>
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
            } else if (message.command === 'load-themes') {
              // The extension could not fetch the declared themes: try to load them
              // here (structurizr.ui.loadThemes reads them from the workspace) and
              // re-render once they are applied.
              loadThemesInWebview();
            } else if (message.command === 'apply-coordinates') {
              // Second layout pass: the extension reserved space for the measured frame
              // texts, so the coordinates changed. Re-render silently.
              applyViewCoordinates(message.views);
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

        // Applies the re-laid-out views (elements, relationship vertices and dimensions)
        // and re-renders the current view without rebuilding the workspace.
        function applyViewCoordinates(views) {
            if (!views || !structurizr.workspace || !structurizr.diagram) return;
            views.forEach(function(updated) {
                var view = structurizr.workspace.findViewByKey(updated.key);
                if (!view) return;
                view.elements = updated.elements;
                view.relationships = updated.relationships;
                view.dimensions = updated.dimensions;
            });
            rebuildDiagram();
        }

        function buildDiagram(message, measure) {
            structurizr.diagram = new structurizr.ui.Diagram('diagram', false, function() {
                structurizr.diagram.onViewChanged(viewChanged);
                structurizr.diagram.changeView(message.viewKey);
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
            });
        }

        // Loads the workspace themes inside the webview and re-renders when they are
        // applied. A theme that never loads must not block the re-render forever, so
        // the callback also fires after a timeout.
        function loadThemesInWebview() {
            if (!structurizr.workspace || !structurizr.diagram) return;
            var configuration = structurizr.workspace.views ? structurizr.workspace.views.configuration : undefined;
            var declared = configuration ? configuration.themes : undefined;
            if (!declared || declared.length === 0) return;
            // Built-in theme names resolve to /static/themes/... which the panel does
            // not serve, so only http(s) themes are worth loading here.
            var loadable = declared.some(function(theme) { return String(theme).indexOf('http') === 0; });
            if (!loadable) return;
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
            $('#diagram').empty();
            structurizr.diagram = undefined;
            buildDiagram({
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

        function viewChanged() {
            const options = {
                metadata: true,
                crop: false,
                dimensions: false
            }
            const view = structurizr.diagram.getCurrentViewOrFilter
                ? structurizr.diagram.getCurrentViewOrFilter()
                : structurizr.diagram.getCurrentView();
            const viewKey = view ? view.key : undefined;
            // Compare the stable base prefix, not the full key: the CST-offset hash
            // suffix changes on every edit even for the same logical view.
            const sameView = baseViewKey(viewKey) === baseViewKey(displayedViewKey);
            displayedViewKey = viewKey;

            structurizr.diagram.exportCurrentDiagramToSVG(options, function(svgMarkup) {
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
          panel.webview.postMessage({ 'uri': pending.uri, 'json': pending.json, 'viewKey': pending.viewKey, 'themes': pending.themes, 'generation': pending.generation, 'rebuild': pending.rebuild, 'textMeasurements': pending.textMeasurements });
        }
      } else if (message && message.command === 'text-widths') {
        // The webview measured the frame texts it draws. Ask the language server to
        // re-run the auto-layout with those widths, then push the new coordinates
        // back for a silent re-render.
        if (this.requestRelayout) {
          const widths = message.widths ?? {};
          void this.requestRelayout(widths, message.uri, message.generation).then(views => this.applyViewCoordinates(views));
        }
      } else if (message && message.command === 'workspace-built') {
        // The webview finished (re)building a Workspace. Ignore a stale report for
        // a document the preview is no longer bound to. Subsequent updateWebView
        // calls for the SAME document + generation then only need a changeView
        // instead of a full rebuild.
        if (message.uri === undefined || message.uri === this.currentDocUri) {
          this.renderedGeneration = message.generation;
        }
      }
    });

    return panel;
  }
}
