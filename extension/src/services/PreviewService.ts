import {
  ExtensionContext,
  TextDocument,
  Uri,
  ViewColumn,
  WebviewPanel,
  commands,
  window,
  workspace,
} from "vscode";
import * as config from '../config';
import { Buffer } from "buffer";
import { CommandResultCode, RefreshOptions } from "../types";

import * as httpm from 'typed-rest-client/HttpClient';
import { IHeaders, IRequestOptions } from 'typed-rest-client/Interfaces';

class PreviewService {
  private panel: WebviewPanel | undefined;
  private _currentDiagram: string;
  private _currentDocument: TextDocument;
  private extensionUri: Uri;
  private lastHashCode: number = 0;

  private GRAPHVIZ_ID: string = '/graphviz';
  private VIEW_TYPE: string = 'Structurizr Preview';

  constructor(context: ExtensionContext) {
    this.extensionUri = context.extensionUri;
  }

  public get currentDiagram() {
    return this._currentDiagram;
  }

  public set currentDiagram(diagram: string) {
    this._currentDiagram = diagram;
  }

  public get currentDocument() {
    return this._currentDocument;
  }

  public set currentDocument(document: TextDocument) {
    this._currentDocument = document;
  }

  public triggerRefresh(savedDoc: TextDocument) {
    if (this.currentDiagram && this.currentDocument === savedDoc) {
      const refreshOptions: RefreshOptions = {
        viewKey: this.currentDiagram,
        document: savedDoc.uri.path
      };
      commands.executeCommand("c4.refresh", refreshOptions).then((callback) => {
        const result = callback as CommandResultCode;
        this.updateWebView(result.message);
      });
    }
  }

  public async updateWebView(encodedContent: string) {
    const hashCode = (s: string) => s.split('').reduce((a, b) => { a = ((a << 5) - a) + b.charCodeAt(0); return a & a }, 0);
    const currentHashCode = hashCode(encodedContent);
    if(this.lastHashCode === currentHashCode && this.panel) {
      this.panel.webview.postMessage( { 'body' : undefined, 'view' : this.currentDiagram });
    } else {
      this.lastHashCode = currentHashCode;
      const content = Buffer.from(encodedContent, 'base64').toString('utf8');
      let headers: IHeaders = <IHeaders>{};
      headers['Content-Type'] = 'application/json';
      const autolayoutUrl = workspace.getConfiguration().get(config.DIAGRAM_STRUCTURIZR_AUTOLAYOUT_URL) as string;
      const options: IRequestOptions = <IRequestOptions>{};
      options.ignoreSslError = workspace.getConfiguration().get(config.NOTLS) as boolean;
      const httpc = new httpm.HttpClient('vscode-c4-dsl-plugin', [], options);
      httpc.post(autolayoutUrl + this.GRAPHVIZ_ID, content, headers).then((result) => { return result.readBody() }).then((body) => {
        this.panel ??= this.createPanel();
        this.panel.webview.postMessage( { 'body' : body, 'view' : this.currentDiagram });
      }).catch((error) => { 
        this.panel ??= this.createPanel();
        this.panel.webview.postMessage( { 'body' : content, 'view' : this.currentDiagram });
      }).finally(() => {});
    }
  }

  private createPanel(): WebviewPanel {
    const panel = window.createWebviewPanel(
      this.VIEW_TYPE,
      this.VIEW_TYPE,
      ViewColumn.Two,
      {
        retainContextWhenHidden: true,
        enableScripts: true,
        localResourceRoots: [Uri.joinPath(this.extensionUri, 'css'), Uri.joinPath(this.extensionUri, 'js')]
      }
    );

    const jsjquery = Uri.joinPath(this.extensionUri, 'js', 'jquery-3.6.3.min.js');
    const jsjquerysrc = panel.webview.asWebviewUri(jsjquery);
    const jslodash = Uri.joinPath(this.extensionUri, 'js', 'lodash-4.17.21.js');    
    const jslodashsrc = panel.webview.asWebviewUri(jslodash);    
    const jsbackbone = Uri.joinPath(this.extensionUri, 'js', 'backbone-1.4.1.js');    
    const jsbackbonesrc = panel.webview.asWebviewUri(jsbackbone);
    const jsjoint = Uri.joinPath(this.extensionUri, 'js', 'joint-3.6.5.js');
    const jsjointsrc = panel.webview.asWebviewUri(jsjoint);
    const jscanvg = Uri.joinPath(this.extensionUri, 'js', 'canvg-1.5.4.js');
    const jscanvgsrc = panel.webview.asWebviewUri(jscanvg);
    const jspanzoom = Uri.joinPath(this.extensionUri, 'js', 'panzoom.min.js');
    const jspanzoomsrc = panel.webview.asWebviewUri(jspanzoom);
    const jsstructurizr = Uri.joinPath(this.extensionUri, 'js', 'structurizr.js');    
    const jsstructurizrsrc = panel.webview.asWebviewUri(jsstructurizr);                                       
    const jsstructurizrutil = Uri.joinPath(this.extensionUri, 'js', 'structurizr-util.js');    
    const jsstructurizrutilsrc = panel.webview.asWebviewUri(jsstructurizrutil);                                           
    const jsstructurizrui = Uri.joinPath(this.extensionUri, 'js', 'structurizr-ui.js');        
    const jsstructurizruisrc = panel.webview.asWebviewUri(jsstructurizrui);
    const jsstructurizrworkspace = Uri.joinPath(this.extensionUri, 'js', 'structurizr-workspace.js');    
    const jsstructurizrworkspacesrc = panel.webview.asWebviewUri(jsstructurizrworkspace);    
    const jsstructurizrdiagram = Uri.joinPath(this.extensionUri, 'js', 'structurizr-diagram.js');    
    const jsstructurizrdiagramsrc = panel.webview.asWebviewUri(jsstructurizrdiagram);    
    const cssjoint = Uri.joinPath(this.extensionUri, 'css', 'joint-3.6.5.css');
    const cssjointsrc = panel.webview.asWebviewUri(cssjoint);        
    const cssstructurizrdiagram = Uri.joinPath(this.extensionUri, 'css', 'structurizr-diagram.css');    
    const cssstructurizrdiagramsrc = panel.webview.asWebviewUri(cssstructurizrdiagram);    

    panel.webview.html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta name="viewport" content="width=device-width,initial-scale=1,shrink-to-fit=no">
    <script src="${jsjquerysrc}"></script>

    <script src="${jslodashsrc}"></script>
    <script src="${jsbackbonesrc}"></script>
    <script type="text/javascript" src="${jsjointsrc}"></script>
    <script type="text/javascript" src="${jscanvgsrc}"></script>
    <script type="text/javascript" src="${jspanzoomsrc}"></script>

    <script type="text/javascript" src="${jsstructurizrsrc}"></script>
    <script type="text/javascript" src="${jsstructurizrutilsrc}"></script>
    <script type="text/javascript" src="${jsstructurizruisrc}"></script>
    <script type="text/javascript" src="${jsstructurizrworkspacesrc}"></script>
    <script type="text/javascript" src="${jsstructurizrdiagramsrc}"></script>

    <link href="${cssjointsrc}" rel="stylesheet" media="screen" />
    <link href="${cssstructurizrdiagramsrc}" rel="stylesheet" media="screen" />
    <title>${this.VIEW_TYPE}</title>
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
      this.currentDiagram = "";
      this.panel = undefined;
    });
    return panel;
  }
}

export { PreviewService };
