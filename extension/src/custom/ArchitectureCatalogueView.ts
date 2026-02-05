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

import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as httpm from 'typed-rest-client/HttpClient';
import * as config from '../config';
import { workspace } from 'vscode';
import { generateHmac } from './hmac';
import { IRequestOptions } from 'typed-rest-client/Interfaces';
import { C4Utils } from '../utils/c4-utils';

class Item extends vscode.TreeItem {
    title: string;
    docs: string;
    dsl: string;
    childrens: Item[];
}

export class ArchitectureCatalogueProvider implements vscode.TreeDataProvider<Item> {

  private readonly INDEX_ID: string = '/index';
  private readonly CONTENT_ID: string = '/content/';
  private readonly PATH = '/architecture-center';

  private currentPanel: vscode.WebviewPanel | undefined = undefined;
  private lastDocs: string | undefined = undefined;

  private readonly initItem: (items: Item[]) => Item[];
  private readonly initRoot: () => Promise<Item[]>;

  constructor(context: vscode.ExtensionContext) {

    const view = vscode.window.createTreeView('architectureCatalogueView', { treeDataProvider: this, showCollapseAll: true, canSelectMany: true });

    context.subscriptions.push(view);
    const options: IRequestOptions = <IRequestOptions>{};
    options.ignoreSslError = !(workspace.getConfiguration().get(config.BEELINE_CERT_VERIFICATION) as boolean);
    const archopsApiUrl = C4Utils.removeTrailingSlash(workspace.getConfiguration().get(config.BEELINE_API_URL) as string);
    const httpc = new httpm.HttpClient('vscode-c4-dsl-plugin', [], options);

    this.initItem = (items: Item[]) : Item[] => {
      items.forEach(item => {

        item.label = item.title;

        if (item.dsl.length > 0) {
          const id = this.CONTENT_ID + item.dsl;
          const headers = generateHmac('GET', this.PATH + id);
          httpc.get(archopsApiUrl + this.PATH + id, headers).
            then((result) => result.readBody()).
            then((body) => context.workspaceState.update(id, body));
        }

        if (item.docs.length > 0) {
          item.collapsibleState = vscode.TreeItemCollapsibleState.None;
          item.command = {
            command: "c4.architectureCatalogue.showDescription",
            title: "Show pattern description",
            arguments: [item.title, item.docs]
          };

          const id = this.CONTENT_ID + item.docs;
          const headers = generateHmac('GET', this.PATH + id);
          httpc.get(archopsApiUrl + this.PATH + id, headers).
          then((result) => result.readBody()).
          then((body) => context.workspaceState.update(id, body));
        }

        if (item.childrens.length === 0) {
          const basename = path.basename(item.dsl);
          item.contextValue = (basename.length > 0) ? 'leaf' : 'chapter';
        } else {
          item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
          item.contextValue = 'chapter';
        }

        this.initItem(item.childrens);
      });

      return items;
    };

    this.initRoot = async () : Promise<Item[]> =>  {
      const headers = generateHmac('GET', this.PATH + this.INDEX_ID);
      let root = await httpc.get(archopsApiUrl + this.PATH + this.INDEX_ID, headers).
      then((res) => res.readBody()).
      then((body) => JSON.parse(body) as Item).
      catch(() => undefined);

      if(root === undefined) {
        root = context.workspaceState.get(this.INDEX_ID) as Item;
      } else {
        context.workspaceState.update(this.INDEX_ID, root);
      }

      return this.initItem([root]);
    };

    vscode.commands.registerCommand('c4.architectureCatalogue.refresh', async (...args: string[]) => {
      this.refresh();
    });

    vscode.commands.registerCommand('c4.architectureCatalogue.add', async (element: Item) => {

      const createFile = (id: string, body: string) => {
        const basename = path.basename(id);
        if (basename.length > 0) {
          const paths = vscode.workspace.workspaceFolders;
          if (paths !== undefined && paths.length > 0) {
            const filepath = path.join(paths[0].uri.fsPath, basename);
            fs.writeFile(filepath, body,  (error) => {
              if (error) {
                vscode.window.showErrorMessage(error.message);
              } else {
                vscode.workspace.openTextDocument(filepath).then((doc) => { vscode.window.showTextDocument(doc); });
                vscode.commands.executeCommand('c4-server.send-pattern-telemetry', { patternId: id, action: 'pattern' });
              }
            });
          }
        }
      };

      const id = this.CONTENT_ID + element.dsl;
      const headers = generateHmac('GET', this.PATH + id);
      let body = await httpc.get(archopsApiUrl + this.PATH + id, headers).
      then((result) => result.readBody()).
      catch(() => undefined);
      if(body === undefined) {
        body = context.workspaceState.get(id);  
      } else {
        context.workspaceState.update(id, body);
      }
      if (body !== undefined) {
        createFile(id, body);
      }
    });

    vscode.commands.registerCommand('c4.architectureCatalogue.showDescription', async (...args: string[]) => {

      const columnToShowIn = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

      if (this.currentPanel === undefined) {
        this.currentPanel = vscode.window.createWebviewPanel(
          'architectureCatalogueDescription',
          args[0],
          columnToShowIn || vscode.ViewColumn.One,
          {}
        );
      } else {
        this.currentPanel.reveal(columnToShowIn);
      }

      if (this.lastDocs !== args[1]) {
        this.lastDocs = args[1];
        const id = this.CONTENT_ID + args[1];
        const headers = generateHmac('GET', this.PATH + id);
        let body = await httpc.get(archopsApiUrl + this.PATH + id, headers).
        then((result) => result.readBody()).
        catch(() => undefined);

        if(body === undefined) {
          body = this.currentPanel.webview.html = context.workspaceState.get(id) ?? "";
        } else {
          context.workspaceState.update(id, body);          
        }

        this.currentPanel.title = args[0];
        this.currentPanel.webview.html = body;
        vscode.commands.executeCommand('c4-server.send-pattern-telemetry', { patternId: id, action: 'pattern_view' });        
      }

      this.currentPanel.onDidDispose(() => {
        this.currentPanel = undefined;
        this.lastDocs = undefined;
      }, null, context.subscriptions);
    });

  }

  private readonly _onDidChangeTreeData: vscode.EventEmitter<Item | undefined | null | void> = new vscode.EventEmitter<Item | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<Item | undefined | null | void> = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: Item): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: Item): Promise<Item[]> {
    return element ? Promise.resolve(element.childrens) : this.initRoot();
  }
}