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
  OpenDialogOptions,
  ProgressLocation,
  SaveDialogOptions,
  TextDocument,
  Uri,
  ViewColumn,
  WebviewPanel,
  commands,
  window
} from "vscode";

import { CommandResultCode, RefreshOptions } from "../types";
import { readFile, writeFile } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getGraphviz } from "../utils/graphvizInstance";

class PreviewService {
  private panel: WebviewPanel | undefined;
  private _currentDiagram: string;
  private _currentDocument: TextDocument;
  private _currentDiagramAsDot: string;

  private readonly title: string = 'Structurizr Preview';
  private readonly id: string = 'structurizrPreview';

  private readonly jsjquery: Uri;
  private readonly jslodash: Uri;
  private readonly jsbackbone: Uri;
  private readonly jsjoint: Uri;
  private readonly jscanvg: Uri;
  private readonly jspanzoom: Uri;
  private readonly jsstructurizr: Uri;
  private readonly jsstructurizrutil: Uri;
  private readonly jsstructurizrui: Uri;
  private readonly jsstructurizrworkspace: Uri;
  private readonly jsstructurizrdiagram: Uri;
  private readonly cssjoint: Uri;
  private readonly cssstructurizrdiagram: Uri;
  private readonly localResourceRoots: Uri[];

  constructor(context: ExtensionContext) {
    this.jsjquery = Uri.joinPath(context.extensionUri, 'js', 'jquery.min.js');
    this.jslodash = Uri.joinPath(context.extensionUri, 'js', 'lodash.min.js');    
    this.jsbackbone = Uri.joinPath(context.extensionUri, 'js', 'backbone-min.js');
    this.jsjoint = Uri.joinPath(context.extensionUri, 'js', 'joint.min.js');
    this.jscanvg = Uri.joinPath(context.extensionUri, 'js', 'canvg-1.5.4.js');
    this.jspanzoom = Uri.joinPath(context.extensionUri, 'js', 'panzoom.min.js');
    this.jsstructurizr = Uri.joinPath(context.extensionUri, 'js', 'structurizr.js');    
    this.jsstructurizrutil = Uri.joinPath(context.extensionUri, 'js', 'structurizr-util.js');    
    this.jsstructurizrui = Uri.joinPath(context.extensionUri, 'js', 'structurizr-ui.js');        
    this.jsstructurizrworkspace = Uri.joinPath(context.extensionUri, 'js', 'structurizr-workspace.js');    
    this.jsstructurizrdiagram = Uri.joinPath(context.extensionUri, 'js', 'structurizr-diagram.js');    
    this.cssjoint = Uri.joinPath(context.extensionUri, 'css', 'joint.min.css');
    this.cssstructurizrdiagram = Uri.joinPath(context.extensionUri, 'css', 'structurizr-diagram.css');
        
    this.localResourceRoots = [Uri.joinPath(context.extensionUri, 'css'), Uri.joinPath(context.extensionUri, 'js')];
  }

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
        svg: undefined,
        mx: undefined
      };
      commands.executeCommand("c4-server.workspace-2-dot", refreshOptions).then(async (callback) => {
        const result = callback as CommandResultCode;
        this.currentDiagramAsDot = result.message;
        this.updateWebView();
      });
    }
  }

  getUserDocumentsPath() {
    const userHomeDir = homedir();
    const documentsPath = join(userHomeDir, 'Documents');
    return documentsPath;
  }

public async importLayoutMax(context: ExtensionContext) {
    const options: OpenDialogOptions = {
      defaultUri: Uri.file(join(this.getUserDocumentsPath(), this._currentDiagram)),
      filters: {
        'DrawIO Files': ['drawio'],
        'All Files': ['*']
      },
      title: 'Import layout from .drawio file'
    };
    const uri = await window.showOpenDialog(options);
    if (uri) {
      window.withProgress({
          location: ProgressLocation.Notification,
          title: "Importing layout from drawio file",
          cancellable: false
      }, (progress, token) => {
        return new Promise<void>(resolve => {
          progress.report({ message: "Read drawio file..." });
          readFile(uri[0].fsPath, (err, data) => {
            const refreshOptions: RefreshOptions = {
              viewKey: this._currentDiagram,
              document: this._currentDocument.uri.path,
              svg: undefined,
              mx: data.toString()
            };
            progress.report({ message: "Apply layout..." });
            commands.executeCommand("c4-server.get-json", refreshOptions).then(async (callback) => {
              const result = callback as CommandResultCode;
              if(result.message === undefined) {
                  resolve();
                  return;                  
              }
              progress.report({ message: "Refresh diagram..." });
              this.panel ??= this.createPanel();
              this.panel.webview.postMessage( { 'body' : result.message, 'view' : this._currentDiagram }).then(() => resolve());
            });
          });
        });
      });
    }
  }

  public async getMx(context: ExtensionContext) {
      const refreshOptions: RefreshOptions = {
        viewKey: this._currentDiagram,
        document: this._currentDocument.uri.path,
        svg: undefined,
        mx: undefined
      };
      commands.executeCommand("c4-server.view-2-mx", refreshOptions).then(async (callback) => {
        const result = callback as CommandResultCode;
        const options: SaveDialogOptions = {
          defaultUri: Uri.file(join(this.getUserDocumentsPath(), this._currentDiagram)),
          filters: {
            'Svg Files': ['drawio'],
            'All Files': ['*']
          },
          title: 'Export to .drawio file'
        };

        const uri = await window.showSaveDialog(options);

        if (uri) {
          writeFile(uri.fsPath, Buffer.from(result.message), (error) => {
            if (error !== null) {
              window.showErrorMessage(error.message);
            }
          });
        }

      });
  }

  public async getSvg(context: ExtensionContext) {
    this.panel?.webview.onDidReceiveMessage(
      async message => {
        const options: SaveDialogOptions = {
          defaultUri: Uri.file(join(this.getUserDocumentsPath(), this._currentDiagram)),
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
    const svg = (this._currentDiagramAsDot === undefined) ? undefined : (await getGraphviz()).dot(this._currentDiagramAsDot);
    const refreshOptions: RefreshOptions = {
      viewKey: this._currentDiagram,
      document: this._currentDocument.uri.path,
      svg: svg,
      mx: undefined
    };
    commands.executeCommand("c4-server.get-json", refreshOptions).then(async (callback) => {
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
              structurizr.ui.loadThemes('https://static.structurizr.com/themes/', function() {
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
