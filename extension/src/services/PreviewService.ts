/*
    Copyright 2025 VimpelCom PJSC

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
  SaveDialogOptions,
  TextDocument,
  Uri,
  ViewColumn,
  WebviewPanel,
  commands,
  window,
} from "vscode";

import { CommandResultCode, RefreshOptions } from "../types";
import { Graphviz } from "@hpcc-js/wasm-graphviz";
import { writeFile } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

class PreviewService {
  private panel: WebviewPanel | undefined;
  private _currentDiagram: string;
  private _currentDocument: TextDocument;
  private _currentDiagramAsDot: string;

  private title: string = 'Structurizr Preview';
  private id: string = 'structurizrPreview';
  private graphviz: Graphviz;

  private jsjquery: Uri;
  private jslodash: Uri;
  private jsbackbone: Uri;
  private jsjoint: Uri;
  private jscanvg: Uri;
  private jspanzoom: Uri;
  private jsstructurizr: Uri;
  private jsstructurizrutil: Uri;
  private jsstructurizrui: Uri;
  private jsstructurizrworkspace: Uri;
  private jsstructurizrdiagram: Uri;
  private cssjoint: Uri;
  private cssstructurizrdiagram: Uri;
  private localResourceRoots: Uri[];

  constructor(context: ExtensionContext) {
    this.LoadAsync();
    this.jsjquery = Uri.joinPath(context.extensionUri, 'js', 'jquery-3.6.3.min.js');
    this.jslodash = Uri.joinPath(context.extensionUri, 'js', 'lodash-4.17.21.js');    
    this.jsbackbone = Uri.joinPath(context.extensionUri, 'js', 'backbone-1.4.1.js');    
    this.jsjoint = Uri.joinPath(context.extensionUri, 'js', 'joint-3.6.5.js');
    this.jscanvg = Uri.joinPath(context.extensionUri, 'js', 'canvg-1.5.4.js');
    this.jspanzoom = Uri.joinPath(context.extensionUri, 'js', 'panzoom.min.js');
    this.jsstructurizr = Uri.joinPath(context.extensionUri, 'js', 'structurizr.js');    
    this.jsstructurizrutil = Uri.joinPath(context.extensionUri, 'js', 'structurizr-util.js');    
    this.jsstructurizrui = Uri.joinPath(context.extensionUri, 'js', 'structurizr-ui.js');        
    this.jsstructurizrworkspace = Uri.joinPath(context.extensionUri, 'js', 'structurizr-workspace.js');    
    this.jsstructurizrdiagram = Uri.joinPath(context.extensionUri, 'js', 'structurizr-diagram.js');    
    this.cssjoint = Uri.joinPath(context.extensionUri, 'css', 'joint-3.6.5.css');
    this.cssstructurizrdiagram = Uri.joinPath(context.extensionUri, 'css', 'structurizr-diagram.css');
        
    this.localResourceRoots = [Uri.joinPath(context.extensionUri, 'css'), Uri.joinPath(context.extensionUri, 'js')];
  }

  private LoadAsync = async () => {
      this.graphviz = await Graphviz.load();
  };

  public set currentDiagramAsDot(dot: string) {
    this._currentDiagramAsDot = dot;
  }

  public set currentDiagram(diagram: string) {
    this._currentDiagram = diagram;
  }

  public set currentDocument(document: TextDocument) {
    this._currentDocument = document;
  }

  public triggerRefresh(savedDoc: TextDocument) {
    if (this._currentDiagram && this._currentDocument === savedDoc) {
      const refreshOptions: RefreshOptions = {
        viewKey: this._currentDiagram,
        document: savedDoc.uri.path,
        svg: undefined
      };
      commands.executeCommand("c4-server.workspace-2-dot", refreshOptions).then(async (callback) => {
        const result = callback as CommandResultCode;
        this.currentDiagramAsDot = result.message;
        this.updateWebView();
      });
    }
  }
  
  public async getSvg(context: ExtensionContext) {
    this.panel?.webview.onDidReceiveMessage(
      async message => {
        const getUserDocumentsPath = (): string => {
          const userHomeDir = homedir();
          const documentsPath = join(userHomeDir, 'Documents');
          return documentsPath;
        };

        const options: SaveDialogOptions = {
          defaultUri: Uri.file(join(getUserDocumentsPath(), this._currentDiagram)),
          filters: {
            'Svg Files': ['svg'],
            'All Files': ['*']
          },
          title: 'Export to .svg file'
        };

        const uri = await window.showSaveDialog(options);

        if (uri) {
          writeFile(uri.fsPath, Buffer.from(message.svg), (error) => {
            if (error !== null) {
              window.showErrorMessage(error.message);
            }
          });
        }
      },
      undefined,
      context.subscriptions
    );
    this.panel?.webview.postMessage({ svg: 'svg' });
  }

  public async updateWebView() {
    const refreshOptions: RefreshOptions = {
      viewKey: this._currentDiagram,
      document: this._currentDocument.uri.path,
      svg: this.graphviz.dot(this._currentDiagramAsDot)
    };
    commands.executeCommand("c4-server.svg-layout", refreshOptions).then(async (callback) => {
      const result = callback as CommandResultCode;
      if(result.message !== undefined) {
        this.panel ??= this.createPanel();
        this.panel.webview.postMessage( { 'body' : result.message, 'view' : this._currentDiagram });
      }
    });
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
    <script src="${panel.webview.asWebviewUri(this.jsjquery)}"></script>

    <script src="${panel.webview.asWebviewUri(this.jslodash)}"></script>
    <script src="${panel.webview.asWebviewUri(this.jsbackbone)}"></script>
    <script type="text/javascript" src="${panel.webview.asWebviewUri(this.jsjoint)}"></script>
    <script type="text/javascript" src="${panel.webview.asWebviewUri(this.jscanvg)}"></script>
    <script type="text/javascript" src="${panel.webview.asWebviewUri(this.jspanzoom)}"></script>

    <script type="text/javascript" src="${panel.webview.asWebviewUri(this.jsstructurizr)}"></script>
    <script type="text/javascript" src="${panel.webview.asWebviewUri(this.jsstructurizrutil)}"></script>
    <script type="text/javascript" src="${panel.webview.asWebviewUri(this.jsstructurizrui)}"></script>
    <script type="text/javascript" src="${panel.webview.asWebviewUri(this.jsstructurizrworkspace)}"></script>
    <script type="text/javascript" src="${panel.webview.asWebviewUri(this.jsstructurizrdiagram)}"></script>

    <link href="${panel.webview.asWebviewUri(this.cssjoint)}" rel="stylesheet" media="screen" />
    <link href="${panel.webview.asWebviewUri(this.cssstructurizrdiagram)}" rel="stylesheet" media="screen" />
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
            if(message.body !== undefined) {
              structurizr.workspace = new structurizr.Workspace(JSON.parse(message.body));
              structurizr.ui.loadThemes('', function() {
                diagram = new structurizr.ui.Diagram('diagram', false, function() {
                    diagram.onViewChanged(viewChanged);
                    diagram.changeView(message.view);
                });
              });
            } else if(message.svg !== undefined) {
              const svgMarkup = diagram.exportCurrentDiagramToSVG(true, true);
              vscode.postMessage({ svg: svgMarkup })
            } else {
              diagram.changeView(message.view);
            }
        });

        function viewChanged() {
            const svgMarkup = diagram.exportCurrentDiagramToSVG(true, true);
            $('#svg').html(svgMarkup);
            panzoom.reset({ animate: false });
        }

        const elem = document.getElementById('svg');
        const panzoom = Panzoom(elem, { maxScale: 16 });
        elem.parentElement.addEventListener('wheel', panzoom.zoomWithWheel)
</script>`;

    panel.onDidDispose(() => {
      this._currentDiagram = "";
      this.panel = undefined;
    });
    return panel;
  }
}

export { PreviewService };
