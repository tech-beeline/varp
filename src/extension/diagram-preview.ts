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

  public async updateWebView(json : any, viewKey : string) {
        console.log(`[C4 Gen] View Key: ${viewKey}`);
        this.currentViewKey = viewKey;
        this.currentJson = json;
        this.panel ??= this.createPanel();
        this.panel.webview.postMessage( { 'json' : json, 'viewKey' : viewKey });
  }

  public getCurrentViewKey(): string | undefined {
        return this.currentViewKey;
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
    </style>
</head>
<body>
    <div id="svg"></div>
    <div id="diagram" style="visibility: hidden;"></div>    
</body>
</html>

<script>
        var diagram;
        const vscode = acquireVsCodeApi();
        window.addEventListener('message', event => {
            const message = event.data;
            if(message.json !== undefined) {
              structurizr.workspace = new structurizr.Workspace(message.json);
              structurizr.ui.loadThemes(function() {
                structurizr.diagram = new structurizr.ui.Diagram('diagram', false, function() {
                    structurizr.diagram.onViewChanged(viewChanged);
                    structurizr.diagram.changeView(message.viewKey);
                });
              });
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

        function viewChanged() {
            const options = {
                metadata: true,
                crop: false,
                dimensions: false
            }
            structurizr.diagram.exportCurrentDiagramToSVG(options, function(svgMarkup) {
              $('#diagram').empty();
              $('#svg').html(svgMarkup);
              panzoom.reset({ animate: false });
            });
        }

        const elem = document.getElementById('svg');
        const panzoom = Panzoom(elem, { maxScale: 16 });
        elem.parentElement.addEventListener('wheel', panzoom.zoomWithWheel)
</script>`;

    panel.onDidDispose(() => {
      this.panel = undefined;
    });
    return panel;
  }
}
