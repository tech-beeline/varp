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

class Item extends vscode.TreeItem {
	name: string;
	bcid: string | undefined;
	hasChildren: boolean | undefined;
	istc: boolean;
	code: string;
	businessCapabilities: Item[];
}

class Child {
	techCapabilities: Item[];
	businessCapabilities: Item[];
}

export class BusinessCapabilityProvider implements vscode.TreeDataProvider<Item> {
	private readonly PARAMS = '?findBy=CORE';
	private readonly ROOT_ID: string = '/business-capability';
	private readonly PATH = '/capability/api/v1';

	private readonly initItem: (items: Item[], istc: boolean) => Item[];
	private readonly initChild: (items: Item) => Promise<Item[]>;
	private readonly initRoot: () => Promise<Item[]>;

	constructor(context: vscode.ExtensionContext) {

		const view = vscode.window.createTreeView('bcCatalogueView', { treeDataProvider: this, showCollapseAll: true, canSelectMany: true });

		context.subscriptions.push(view);
		const options: IRequestOptions = <IRequestOptions>{};
		options.ignoreSslError = !(vscode.workspace.getConfiguration().get(config.BEELINE_CERT_VERIFICATION) as boolean);
		const archopsApiUrl = C4Utils.removeTrailingSlash(vscode.workspace.getConfiguration().get(config.BEELINE_API_URL) as string);
		const httpc = new httpm.HttpClient('vscode-c4-dsl-plugin', [], options);

		this.initChild = async (chapter: Item): Promise<Item[]> => {
			const children: string = `/${chapter.bcid}/children`;
			const path = this.PATH + this.ROOT_ID + children;
			const headers = generateHmac('GET', path);

			const [items, istc] = await httpc.get(archopsApiUrl + path, headers).
				then((res) => res.readBody()).
				then((body) => JSON.parse(body) as Child).
				then((child) : [Item[], boolean] => child.businessCapabilities.length === 0 ? [child.techCapabilities, true] : [child.businessCapabilities, false]);
				
			return this.initItem(items, istc);
		}

		this.initItem = (items: Item[], istc: boolean): Item[] => {
			items.forEach(item => {
				if (item.hasChildren) {
					item.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
				}
				if (typeof item.description === 'string') {
					item.tooltip = new vscode.MarkdownString(item.description);
				}
				item.iconPath = (istc) ? vscode.ThemeIcon.File : vscode.ThemeIcon.Folder;
				item.label = item.name;
				item.description = item.code;
				item.bcid = item.id;
				item.istc = istc;
				item.id = undefined;
			});
			return items;
		};

		this.initRoot = async (): Promise<Item[]> => {
			const headers = generateHmac('GET', this.PATH + this.ROOT_ID);
			return httpc.get(archopsApiUrl + this.PATH + this.ROOT_ID + this.PARAMS, headers).
				then((res) => res.readBody()).
				then((body) => JSON.parse(body) as Item[]).
				then((root) => root ?? []).
				then((root) => Array.isArray(root) ? root : [root]).
				then((root) => this.initItem(root, false)).
				catch((error) => []);
		};

		vscode.commands.registerCommand('c4.capabilitiesCatalogue.copy', async (element: Item) => {
			vscode.env.clipboard.writeText(element.code).then(() => {
				vscode.window.showInformationMessage(`Capability code ${element.code} copied to clipboard!`);
			}, (error) => {
				vscode.window.showErrorMessage(`Failed to copy capability code: ${error.message}`);
			});			
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
		if (element) {
			return this.initChild(element);
		}
		const root = await this.initRoot();
		if (root.length === 1) {
			const child = root.at(0);
			if (child !== undefined) {
				return this.initChild(child);
			}
		}
		return root;
	}
}