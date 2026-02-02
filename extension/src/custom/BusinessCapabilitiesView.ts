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
import * as httpm from 'typed-rest-client/HttpClient';
import * as config from '../config';
import { IRequestOptions } from 'typed-rest-client/Interfaces';
import { C4Utils } from '../utils';
import { generateHmac } from './hmac';

class Chapter extends vscode.TreeItem {
	name: string;
	title: string;
	docs: string;
	dsl: string;
	childrens: Chapter[];
}

export class BusinessCapabilityProvider implements vscode.TreeDataProvider<Chapter> {
	private readonly PARAMS = '?findBy=CORE';
	private INDEX_ID: string = '/business-capability';
	private PATH = '/capability/api/v1';

	private initChapter: (chapters: Chapter[]) => Chapter[];

	private initChild: (chapters: Chapter) => Chapter[];

	private initRoot: () => Promise<Chapter[]>;

	constructor(context: vscode.ExtensionContext) {

		const view = vscode.window.createTreeView('bcCatalogueView', { treeDataProvider: this, showCollapseAll: true, canSelectMany: true });

		context.subscriptions.push(view);
		const options: IRequestOptions = <IRequestOptions>{};
		options.ignoreSslError = !(vscode.workspace.getConfiguration().get(config.BEELINE_CERT_VERIFICATION) as boolean);
		const beelineApiUrl = C4Utils.removeTrailingSlash(vscode.workspace.getConfiguration().get(config.BEELINE_API_URL) as string);
		const httpc = new httpm.HttpClient('vscode-c4-dsl-plugin', [], options);

		this.initChild = (chapter: Chapter): Chapter[] => {
			return [];
		}

		this.initChapter = (chapters: Chapter[]): Chapter[] => {
			chapters.forEach(chapter => {

				chapter.label = chapter.name;

				if (chapter.childrens !== undefined && chapter.childrens.length === 0) {
				} else {
					chapter.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
				}

				if (chapter.childrens !== undefined) {
					this.initChapter(chapter.childrens);
				}

				chapter.id = undefined;

			});

			return chapters;
		};

		this.initRoot = async (): Promise<Chapter[]> => {
			const headers = generateHmac('GET', this.PATH + this.INDEX_ID);
			return httpc.get(beelineApiUrl + this.PATH + this.INDEX_ID + this.PARAMS, headers).
				then((res) => res.readBody()).
				then((body) => {
					const root = JSON.parse(body) as Chapter[];
					return root;
				}).then((root) => {
					if (root === undefined) {
						return [];
					}
					return this.initChapter((Array.isArray(root)) ? root : [root]);
				});
		};

		vscode.commands.registerCommand('c4.architectureCatalogue.refresh', async (...args: string[]) => {
			this.refresh();
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
		return element ? this.initChild(element) : this.initRoot();
	}
}