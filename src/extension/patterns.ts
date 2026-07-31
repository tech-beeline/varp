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

import { ExtensionContext, TreeDataProvider, TreeItem, WebviewPanel, workspace, window, TreeItemCollapsibleState, commands, EventEmitter, Event, ViewColumn, Uri } from 'vscode';
import { generateHmac } from './hmac';
import { GET_PATTERN_DSL, REFRESH_PATTERNS, SHOW_PATTERN_DESCRIPTION } from './config';
import { Utils } from 'vscode-uri';

class PatternItem extends TreeItem {
    title: string = '';
    docs: string = '';
    dsl: string = '';
    childrens: PatternItem[] = [];
}

export class PatternProvider implements TreeDataProvider<PatternItem> {

  private readonly INDEX_ID: string = '/index';
  private readonly CONTENT_ID: string = '/content/';
  private readonly PATH = '/architecture-center';

  private currentPanel: WebviewPanel | undefined = undefined;
  private lastDocs: string | undefined = undefined;

  private readonly initItem: (items: PatternItem[]) => Promise<PatternItem[]>;

  constructor(context: ExtensionContext) {
    const view = window.createTreeView('patterns-catalogue', { treeDataProvider: this, showCollapseAll: true, canSelectMany: true });
    context.subscriptions.push(view);
    const archopsApiUrl = workspace.getConfiguration().get<string>('archops.api.url')?.replace(/\/+$/, '');

    this.initItem = async (items: PatternItem[]) : Promise<PatternItem[]> => {
      items.forEach(async item => {
        item.label = item.title;
        if (item.docs.length > 0) {
          item.collapsibleState = TreeItemCollapsibleState.None;
          item.command = {
            command: SHOW_PATTERN_DESCRIPTION,
            title: "Show pattern description",
            arguments: [item.title, item.docs]
          };
        }

        if (item.childrens.length === 0) {
          const fileUri = Uri.parse(item.dsl);
          const basenamePath = Utils.basename(fileUri);
          item.contextValue = (basenamePath.length > 0) ? 'leaf' : 'chapter';
        } else {
          item.collapsibleState = TreeItemCollapsibleState.Collapsed;
          item.contextValue = 'chapter';
        }

        this.initItem(item.childrens);
      });

      return items;
    };

    commands.registerCommand(REFRESH_PATTERNS, async () => this._onDidChangeTreeData.fire());

    commands.registerCommand(GET_PATTERN_DSL, async (element: PatternItem) => {
      const id = this.CONTENT_ID + element.dsl;
      const headers = generateHmac('GET', this.PATH + id);
      const response = await fetch(archopsApiUrl + this.PATH + id, { headers });
      if(response.body) {
          const content = await response.text();
          const document = await workspace.openTextDocument({ content, language: 'c4' });
          await window.showTextDocument(document);
      }
    });

    commands.registerCommand(SHOW_PATTERN_DESCRIPTION, async (...args: string[]) => {
      const columnToShowIn = window.activeTextEditor ? window.activeTextEditor.viewColumn : undefined;
      if (this.currentPanel === undefined) {
        this.currentPanel = window.createWebviewPanel('pattern-description', args[0], columnToShowIn || ViewColumn.One, {});
      } else {
        this.currentPanel.reveal(columnToShowIn);
      }
      if (this.lastDocs !== args[1]) {
        this.lastDocs = args[1];
        const id = this.CONTENT_ID + args[1];
        const headers = generateHmac('GET', this.PATH + id);
        const response = await fetch(archopsApiUrl + this.PATH + id, { headers });
        const body = await response.text();

        this.currentPanel.title = args[0];
        this.currentPanel.webview.html = body;
      }

      this.currentPanel.onDidDispose(() => {
        this.currentPanel = undefined;
        this.lastDocs = undefined;
      }, null, context.subscriptions);
    });

  }

  private readonly _onDidChangeTreeData: EventEmitter<PatternItem | undefined | null | void> = new EventEmitter<PatternItem | undefined | null | void>();
  readonly onDidChangeTreeData: Event<PatternItem | undefined | null | void> = this._onDidChangeTreeData.event;

  getTreeItem(element: PatternItem): TreeItem {
    return element;
  }

  async getChildren(element?: PatternItem): Promise<PatternItem[]> {
    if(element) {
      return element.childrens;
    }
    const archopsApiUrl = workspace.getConfiguration().get<string>('archops.api.url')?.replace(/\/+$/, '');
    const headers = generateHmac('GET', this.PATH + this.INDEX_ID);
    const response = await fetch(archopsApiUrl + this.PATH + this.INDEX_ID, { headers });
    const root = await response.json() as PatternItem;
    return this.initItem(root.childrens);
  }
}