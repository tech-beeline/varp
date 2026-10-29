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

import { ExtensionContext, TreeDataProvider, TreeItem, WebviewPanel, workspace, window, TreeItemCollapsibleState, commands, EventEmitter, Event, ViewColumn, Uri, ThemeIcon, env } from 'vscode';
import { generateHmac } from './hmac';
import { GET_PATTERN_DSL, REFRESH_PATTERNS, SHOW_PATTERN_DESCRIPTION } from './config';
import { URI } from 'vscode-uri';
import { marked } from 'marked';

class PatternItem extends TreeItem {
    name: string = '';
    groupId: string | undefined;
    patternId: string | undefined;
    children: PatternItem[] = [];
    dsl: string | undefined;
    groups: PatternItem[] | undefined;
    code: string = '';
}

export class PatternProvider implements TreeDataProvider<PatternItem> {
  private readonly GROUPS_PATH = '/techradar/api/v1/pattern/group/tree';
  private readonly PATTERNS_PATH = '/techradar/api/v1/patterns';
  private readonly MD_PATH = '/doc/api/v1/documents/1/';

  private currentPanel: WebviewPanel | undefined = undefined;
  private lastId: string | undefined = undefined;

  /**
   * Reads the current `archops.api.url` configuration on every call so a config
   * change takes effect on the next request without needing to reload the
   * extension. Trailing slashes are stripped to build clean request URLs.
   */
  private getApiUrl(): string | undefined {
    return workspace.getConfiguration().get<string>('archops.api.url')?.replace(/\/+$/, '');
  }

  /**
   * Builds the full request URL for an API path and validates it with
   * vscode-uri. URI.parse is lenient (it never throws and silently treats
   * bare strings as file paths), so validity is checked manually: the scheme
   * must be http(s) and the authority (host) must be non-empty. Returns the
   * URL string when valid, or undefined otherwise.
   */
  private buildRequestUrl(path: string): string | undefined {
    const apiUrl = this.getApiUrl();
    if (!apiUrl) return undefined;

    const url = `${apiUrl}${path}`;
    const uri = URI.parse(url);
    if ((uri.scheme !== 'http' && uri.scheme !== 'https') || uri.authority.length === 0) {
      return undefined;
    }
    return url;
  }

  constructor(context: ExtensionContext) {
    const view = window.createTreeView('patterns-catalogue', { treeDataProvider: this, showCollapseAll: true, canSelectMany: true });
    context.subscriptions.push(view);
    commands.registerCommand(REFRESH_PATTERNS, async () => this._onDidChangeTreeData.fire());

    commands.registerCommand(GET_PATTERN_DSL, async (element: PatternItem) => {
      if(element.dsl) {
        env.clipboard.writeText(element.dsl).then(() => {
          window.showInformationMessage(`${element.code} pattern C4 DSL copied to clipboard!`);
        }, (error) => {
          window.showErrorMessage(`Failed to copy pattern DSL: ${error.message}`);
        });
      }
    });

    commands.registerCommand(SHOW_PATTERN_DESCRIPTION, async (...args: string[]) => {
      
      if (!isNaN(Number(args[1])) && this.lastId !== args[1]) {

        this.lastId = args[1];
        const path = this.MD_PATH + args[1];
        const requestUrl = this.buildRequestUrl(path);
        if (!requestUrl) return;

        try {
          const headers = generateHmac('GET', path);
          const response = await fetch(requestUrl, { headers });
          const body = await response.text();

          const columnToShowIn = window.activeTextEditor ? window.activeTextEditor.viewColumn : undefined;
          if (this.currentPanel === undefined) {
            this.currentPanel = window.createWebviewPanel('pattern-description', args[0], columnToShowIn || ViewColumn.One, {});
          } else {
            this.currentPanel.reveal(columnToShowIn);
          }

          this.currentPanel.title = args[0];
          const renderer = new marked.Renderer();
          const htmlContent = marked.parse(body, { renderer }) as string;
          this.currentPanel.webview.html = `<!DOCTYPE html>
              <html lang="en">
              <head>
                  <meta charset="UTF-8">
                  <meta name="viewport" content="width=device-width, initial-scale=1.0">
                  <style>
                      body {
                          font-family: var(--vscode-font-family);
                          padding: 1rem;
                          line-height: 1.6;
                          color: var(--vscode-editor-foreground);
                          background-color: var(--vscode-editor-background);
                      }
                      pre {
                          background: var(--vscode-textCodeBlock-background);
                          padding: 1rem;
                          border-radius: 4px;
                          overflow-x: auto;
                      }
                      code {
                          font-family: var(--vscode-editor-font-family);
                      }
                      table {
                          border-collapse: collapse;
                      }
                      th, td {
                          border: 1px solid var(--vscode-panel-border);
                          padding: 0.5rem;
                      }
                  </style>
              </head>
              <body>
                  ${htmlContent}
              </body>
              </html>`;
        }
        catch (error) {
        }
      }

      this.currentPanel?.onDidDispose(() => {
        this.currentPanel = undefined;
        this.lastId = undefined;
      }, null, context.subscriptions);
    });

  }

  private readonly _onDidChangeTreeData: EventEmitter<PatternItem | undefined | null | void> = new EventEmitter<PatternItem | undefined | null | void>();
  readonly onDidChangeTreeData: Event<PatternItem | undefined | null | void> = this._onDidChangeTreeData.event;

  getTreeItem(element: PatternItem): TreeItem {
    return element;
  }

  async getChildren(element?: PatternItem): Promise<PatternItem[]> {
    if (element) {
      return element.children;
    }
    const requestUrlGroups = this.buildRequestUrl(this.GROUPS_PATH);
    const requestUrlPatterns = this.buildRequestUrl(this.PATTERNS_PATH);
    if (!requestUrlGroups || !requestUrlPatterns) return [];
    const headersGroups = generateHmac('GET', this.GROUPS_PATH);
    const headersPatterns = generateHmac('GET', this.PATTERNS_PATH);
    try {
      const responseGroups = await fetch(requestUrlGroups, { headers: headersGroups });
      const responsePatterns = await fetch(requestUrlPatterns, { headers: headersPatterns });
      const groups = await responseGroups.json() as PatternItem[];
      const patterns = await responsePatterns.json() as PatternItem[];

      const pinToGroups = (items: PatternItem[], id: string, pattern: PatternItem) => {
        items.forEach(g => {
          if (g.id === id && g.groups === undefined) {
            if (g.children === undefined) g.children = [pattern];
            else g.children.push(pattern);
          }
          if (g.children != undefined) {
            pinToGroups(g.children, id, pattern);
          }
        });
      };

      patterns.forEach(p => {
        p.iconPath = ThemeIcon.File;
        p.patternId = p.id;
        p.label = p.name;
        p.description = p.code;
        p.contextValue = 'leaf';
        p.collapsibleState = TreeItemCollapsibleState.None;
        p.command = {
          command: SHOW_PATTERN_DESCRIPTION,
          title: "Show pattern description",
          arguments: [p.name, p.patternId]
        };
        if (p.groups) {
          p.groups.forEach(pg => {
            if (pg.id != undefined) {
              pinToGroups(groups, pg.id, p);
            }
          });
        }
        p.id = undefined;
      });

      const prepareGroups = (items: PatternItem[]) => {
        items.forEach(g => {
          if (g.patternId === undefined) {
            g.label = g.name;
            g.iconPath = ThemeIcon.Folder;
            g.groupId = g.id;
            g.collapsibleState = TreeItemCollapsibleState.Collapsed;
            g.contextValue = 'chapter';
            if (g.children) {
              prepareGroups(g.children);
            }
            g.id = undefined;
          }
        });
      };

      prepareGroups(groups);

      return groups;
    } catch (error) {
      return [];
    }
  }
}