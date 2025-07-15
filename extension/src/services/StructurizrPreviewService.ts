import {
  TextDocument,
  ViewColumn,
  WebviewPanel,
  commands,
  window,
} from "vscode";
import { RefreshOptions } from "../types/RefreshOptions";
import { CommandResultCode } from "../types/CommandResultCode";

class StructurizrPreviewService {
  private renderService: string;
  private panel: WebviewPanel | undefined;
  private _currentDiagram: string;
  private _currentDocument: TextDocument;

  private VIEW_TYPE: string = 'Structurizr Preview';  

  constructor(renderService: string) {
    this.renderService = renderService;
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
    this.panel ??= this.createPanel();
    const content = await this.getViewContent(encodedContent);
    this.panel.webview.html = this.updateViewContent(content);
  }

  private createPanel(): WebviewPanel {
    const panel = window.createWebviewPanel(
      this.VIEW_TYPE,
      this.VIEW_TYPE,
      ViewColumn.Two,
      {
        enableScripts: true,
      }
    );
    panel.onDidDispose(() => {
      this.currentDiagram = "";
      this.panel = undefined;
    });
    return panel;
  }

    private async getViewContent(content: string) {

        return `
            <iframe id="structurizrPreview" name="structurizrPreview" width="100%" marginwidth="0" marginheight="0" frameborder="0" scrolling="no"></iframe>

            <form id="structurizrPreviewForm" method="post" action="${this.renderService}" target="structurizrPreview" style="display: none;">
                <input type="hidden" name="iframe" value="structurizrPreview" />
                <input type="hidden" name="preview" value="true" />
                <input type="hidden" name="source" value="${content}" />
                <input type="hidden" name="diagram" value="${this.currentDiagram}" />
            </form>
    
            <script>
                document.getElementById("structurizrPreviewForm").submit();
            </script>
            <script type="text/javascript" src="https://static.structurizr.com/js/structurizr-embed.js"></script>
            `;
    }

  private updateViewContent(body: string): string {
    return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${this.VIEW_TYPE}</title>
            <style>
                body.vscode-light {
                    background-color: white;
                }              
                body.vscode-dark {
                    background-color: white;
                }
            </style>
        </head>
        <body>
            ${body}
        </body>
        </html>
        `;
  }
}

export { StructurizrPreviewService };
