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
  TextDocument,
  Uri,
  ViewColumn,
  WebviewPanel,
  commands,
  window,
//  workspace,
} from "vscode";
//import * as config from '../config';
//import { Buffer } from "buffer";
import { CommandResultCode, RefreshOptions } from "../types";

//import * as httpm from 'typed-rest-client/HttpClient';
//import { IHeaders, IRequestOptions } from 'typed-rest-client/Interfaces';

import { Graphviz } from "@hpcc-js/wasm-graphviz";

class PreviewService {
  private panel: WebviewPanel | undefined;
  private _currentDiagram: string;
  private _currentDocument: TextDocument;
  private _currentDiagramAsDot: string;
//  private extensionUri: Uri;
//  private lastHashCode: number = 0;
//  private GRAPHVIZ_ID: string = '/graphviz';
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
      message => {

      },
      undefined,
      context.subscriptions
    );    
    this.panel?.webview.postMessage( { svg: 'svg' });
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

//     const hashCode = (s: string) => s.split('').reduce((a, b) => { a = ((a << 5) - a) + b.charCodeAt(0); return a & a }, 0);
//     const currentHashCode = hashCode(encodedContent);
//     if(this.lastHashCode === currentHashCode && this.panel) {
// //      this.panel.webview.postMessage( { 'body' : undefined, 'view' : this.currentDiagram });
//     } else {
//       this.lastHashCode = currentHashCode;
//       const content = Buffer.from(encodedContent, 'base64').toString('utf8');
//       let headers: IHeaders = <IHeaders>{};
//       headers['Content-Type'] = 'application/json';
//       const autolayoutUrl = workspace.getConfiguration().get(config.DIAGRAM_STRUCTURIZR_AUTOLAYOUT_URL) as string;
//       const options: IRequestOptions = <IRequestOptions>{};
//       options.ignoreSslError = workspace.getConfiguration().get(config.NOTLS) as boolean;
//       const httpc = new httpm.HttpClient('vscode-c4-dsl-plugin', [], options);
//       httpc.post(autolayoutUrl + this.GRAPHVIZ_ID, content, headers).then((result) => { return result.readBody() }).then((body) => {
//         //this.panel ??= this.createPanel();
//         //this.panel.webview.postMessage( { 'body' : body, 'view' : this.currentDiagram });
//       }).catch((error) => { 
//         //this.panel ??= this.createPanel();
//         //this.panel.webview.postMessage( { 'body' : content, 'view' : this.currentDiagram });
//       }).finally(() => {});
//     }
  }

  private createPanel(): WebviewPanel {
    const panel = window.createWebviewPanel(
      this.id,
      this.title,
      ViewColumn.Two,
      {
        retainContextWhenHidden: true,
        enableScripts: true,
        //localResourceRoots: [Uri.joinPath(this.extensionUri, 'css'), Uri.joinPath(this.extensionUri, 'js')]
        localResourceRoots: this.localResourceRoots
      }
    );

//    const jsjquery = Uri.joinPath(this.extensionUri, 'js', 'jquery-3.6.3.min.js');
//    const jsjquerysrc = panel.webview.asWebviewUri(jsjquery);
//    const jslodash = Uri.joinPath(this.extensionUri, 'js', 'lodash-4.17.21.js');    
//    const jslodashsrc = panel.webview.asWebviewUri(jslodash);    
//    const jsbackbone = Uri.joinPath(this.extensionUri, 'js', 'backbone-1.4.1.js');    
//    const jsbackbonesrc = panel.webview.asWebviewUri(jsbackbone);
//    const jsjoint = Uri.joinPath(this.extensionUri, 'js', 'joint-3.6.5.js');
//    const jsjointsrc = panel.webview.asWebviewUri(jsjoint);
//    const jscanvg = Uri.joinPath(this.extensionUri, 'js', 'canvg-1.5.4.js');
//    const jscanvgsrc = panel.webview.asWebviewUri(jscanvg);
//    const jspanzoom = Uri.joinPath(this.extensionUri, 'js', 'panzoom.min.js');
//    const jspanzoomsrc = panel.webview.asWebviewUri(jspanzoom);
//    const jsstructurizr = Uri.joinPath(this.extensionUri, 'js', 'structurizr.js');    
//    const jsstructurizrsrc = panel.webview.asWebviewUri(jsstructurizr);                                       
//    const jsstructurizrutil = Uri.joinPath(this.extensionUri, 'js', 'structurizr-util.js');    
//    const jsstructurizrutilsrc = panel.webview.asWebviewUri(jsstructurizrutil);                                           
//    const jsstructurizrui = Uri.joinPath(this.extensionUri, 'js', 'structurizr-ui.js');        
//    const jsstructurizruisrc = panel.webview.asWebviewUri(jsstructurizrui);
//    const jsstructurizrworkspace = Uri.joinPath(this.extensionUri, 'js', 'structurizr-workspace.js');    
//    const jsstructurizrworkspacesrc = panel.webview.asWebviewUri(jsstructurizrworkspace);    
//    const jsstructurizrdiagram = Uri.joinPath(this.extensionUri, 'js', 'structurizr-diagram.js');    
//    const jsstructurizrdiagramsrc = panel.webview.asWebviewUri(jsstructurizrdiagram);    
//    const cssjoint = Uri.joinPath(this.extensionUri, 'css', 'joint-3.6.5.css');
//    const cssjointsrc = panel.webview.asWebviewUri(cssjoint);        
//    const cssstructurizrdiagram = Uri.joinPath(this.extensionUri, 'css', 'structurizr-diagram.css');    
//    const cssstructurizrdiagramsrc = panel.webview.asWebviewUri(cssstructurizrdiagram);    

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
