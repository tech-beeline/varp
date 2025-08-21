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
import * as fs from 'fs';
import * as path from 'path';
import * as httpm from 'typed-rest-client/HttpClient';
import * as config from '../config';
import { workspace } from 'vscode';
import { generateHmac } from './hmac';
import { IRequestOptions } from 'typed-rest-client/Interfaces';

class Chapter extends vscode.TreeItem {
    title: string;
    docs: string;
    dsl: string;
    childrens: Chapter[];
}

export class ArchitectureCatalogueProvider implements vscode.TreeDataProvider<Chapter> {

  private INDEX_ID: string = '/index';
  private CONTENT_ID: string = '/content/';
  private PATH = '/architecture-center';  

  private currentPanel: vscode.WebviewPanel | undefined = undefined;
  private lastDocs: string | undefined = undefined;

  private initChapter: (chapters: Chapter[]) => Chapter[];

  private initRoot: () => Promise<Chapter[]>;

  constructor(context: vscode.ExtensionContext) {

    const view = vscode.window.createTreeView('ArchitectureCatalogueView', { treeDataProvider: this, showCollapseAll: true, canSelectMany: true });

    context.subscriptions.push(view);
    let options: IRequestOptions = <IRequestOptions>{};
    options.ignoreSslError = workspace.getConfiguration().get(config.NOTLS) as boolean;
    const beelineApiUrl = workspace.getConfiguration().get(config.BEELINE_API_URL) as string;
    let httpc = new httpm.HttpClient('vscode-c4-dsl-plugin', [], options);

    this.initChapter = (chapters: Chapter[]) : Chapter[] => {
      chapters.forEach(chapter => {

        chapter.label = chapter.title;

        if (chapter.dsl.length > 0) {
          const id = this.CONTENT_ID + chapter.dsl;
          const headers = generateHmac('GET', this.PATH + id);
          httpc.get(beelineApiUrl + this.PATH + id, headers).
            then((result) => { return result.readBody() }).
            then((body) => { context.workspaceState.update(id, body); }).
            catch((error) => { }).
            finally(() => { });
        }

        if (chapter.docs.length > 0) {
          chapter.collapsibleState = vscode.TreeItemCollapsibleState.None;
          chapter.command = {
            command: "c4.architectureCatalogue.showDescription",
            title: "Show pattern description",
            arguments: [chapter.title, chapter.docs]
          };

          const id = this.CONTENT_ID + chapter.docs;
          const headers = generateHmac('GET', this.PATH + id);
          httpc.get(beelineApiUrl + this.PATH + id, headers).
          then((result) => { return result.readBody() }).
          then((body) => { context.workspaceState.update(id, body); }).
          catch((error) => { }).
          finally(() => { });
        }

        if (chapter.childrens.length === 0) {
          let basename = path.basename(chapter.dsl);
          chapter.contextValue = (basename.length > 0) ? 'leaf' : 'chapter';
        } else {
          chapter.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
          chapter.contextValue = 'chapter';
        }

        this.initChapter(chapter.childrens);

      });

      return chapters;
    };

    this.initRoot = async () : Promise<Chapter[]> =>  {
        const headers = generateHmac('GET', this.PATH + this.INDEX_ID);
        return Promise.resolve(httpc.get(beelineApiUrl + this.PATH + this.INDEX_ID, headers).
        then((res) => { return res.readBody(); }).
        then((body) => { return JSON.parse(body) as Chapter; }).
        then((root) => {
          context.workspaceState.update(this.INDEX_ID, root); 
          return this.initChapter((Array.isArray(root)) ? root : [root]);
        }).
        catch((error) => {
          let root : Chapter | undefined = (context.workspaceState.get(this.INDEX_ID));
          return (root !== undefined) ? this.initChapter((Array.isArray(root)) ? root : [root]) : [];
        })).
        finally(() => { });
    };

    vscode.commands.registerCommand('c4.architectureCatalogue.add', async (element: Chapter) => {

      let createFile = (id: string, body: string) => {
        let basename = path.basename(id);
        if (basename.length > 0) {
          let paths = vscode.workspace.workspaceFolders;
          if (paths !== undefined && paths.length > 0) {
            let filepath = path.join(paths[0].uri.fsPath, basename);
            fs.writeFile(filepath, body, function (error) { });
            vscode.workspace.openTextDocument(filepath).then((doc) => { vscode.window.showTextDocument(doc); });
          }
        }
      };

      const id = this.CONTENT_ID + element.dsl;
      const headers = generateHmac('GET', this.PATH + id);
      httpc.get(beelineApiUrl + this.PATH + id, headers).then((result) => { return result.readBody(); }).then((body) => {
        createFile(id, body);
        context.workspaceState.update(id, body);
      }).catch((error) => {
        let body: string | undefined = context.workspaceState.get(id);
        if (body !== undefined) {
          createFile(id, body);
        }
      }).
      finally(() => { });
    });

    vscode.commands.registerCommand('c4.architectureCatalogue.showDescription', async (...args: string[]) => {

      const columnToShowIn = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;

      if (this.currentPanel !== undefined) {
        // If we already have a panel, show it in the target column
        this.currentPanel.reveal(columnToShowIn);
      } else {
        // Create and show panel
        this.currentPanel = vscode.window.createWebviewPanel(
          'architectureCatalogueDescription',
          args[0],
          columnToShowIn || vscode.ViewColumn.One,
          {}
        );
      }

      if (this.lastDocs !== args[1]) {
        this.lastDocs = args[1];
        const id = this.CONTENT_ID + args[1];
        const headers = generateHmac('GET', this.PATH + id);
        httpc.get(beelineApiUrl + this.PATH + id, headers).then((result) => { return result.readBody() }).then((body) => {
          context.workspaceState.update(id, body);
          if (this.currentPanel !== undefined) {
            this.currentPanel.webview.html = body;
          }
        }).catch((error) => {
          if (this.currentPanel !== undefined) {
            this.currentPanel.webview.html = context.workspaceState.get(id) ?? "";
          }
        });
        this.currentPanel.title = args[0];
      }

      this.currentPanel.onDidDispose(() => {
        this.currentPanel = undefined;
        this.lastDocs = undefined;
      }, null, context.subscriptions);

      // Handle messages from the webview
      this.currentPanel.webview.onDidReceiveMessage(
        message => {
          switch (message.command) {
            case 'alert':
              vscode.window.showErrorMessage(message.text);
              return;
          }
        },
        undefined,
        context.subscriptions
      );
    });

  }

  private _onDidChangeTreeData: vscode.EventEmitter<Chapter | undefined | null | void> = new vscode.EventEmitter<Chapter | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<Chapter | undefined | null | void> = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: Chapter): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: Chapter): Promise<Chapter[]> {
    return element ? Promise.resolve(element.childrens) : this.initRoot();
  }
}