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

import { COPY_CAPABILITY_CODE } from './config';
import { generateHmac } from './hmac';
import { EventEmitter, ExtensionContext, MarkdownString, ThemeIcon, TreeDataProvider, TreeItem, TreeItemCollapsibleState, window, workspace, Event, commands, env } from 'vscode';
import { URI } from 'vscode-uri';

class CapabilityItem extends TreeItem {
	name: string = '';
	bcid: string | undefined;
	hasChildren: boolean | undefined;
	istc: boolean = false;
	code: string = '';
	businessCapabilities: CapabilityItem[] = [];
}

class CapabilityChild {
	techCapabilities: CapabilityItem[] = [];
	businessCapabilities: CapabilityItem[] = [];
}

export class CapabilityProvider implements TreeDataProvider<CapabilityItem> {
	private readonly PARAMS = '?findBy=CORE';
	private readonly ROOT_ID: string = '/business-capability';
	private readonly PATH = '/capability/api/v1';

	private readonly createCapabilityItem: (items: CapabilityItem[], istc: boolean) => CapabilityItem[];
	private readonly createCapabilityChild: (items: CapabilityItem) => Promise<CapabilityItem[]>;
	private readonly createCapabilityRoot: () => Promise<CapabilityItem[]>;

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
		const view = window.createTreeView('capabilities-catalogue', { treeDataProvider: this, showCollapseAll: true, canSelectMany: true });
		context.subscriptions.push(view);
		this.createCapabilityChild = async (chapter: CapabilityItem): Promise<CapabilityItem[]> => {
			const children: string = `/${chapter.bcid}/children`;
			const path = this.PATH + this.ROOT_ID + children;
			const headers = generateHmac('GET', path);
			try {
				const requestUrl = this.buildRequestUrl(path);
				if (!requestUrl) return [];
				const response = await fetch(requestUrl, { headers });
				if (!response.ok) {
					return [];
				}
				const data = await response.json() as CapabilityChild;
				if (data.businessCapabilities.length > 0) {
					return this.createCapabilityItem(data.businessCapabilities, false);
				} else if (data.techCapabilities.length > 0) {
					return this.createCapabilityItem(data.techCapabilities, true);
				}
			} catch(error) {
			}
			return [];
		}

		this.createCapabilityItem = (items: CapabilityItem[], istc: boolean): CapabilityItem[] => {
			items.forEach(item => {
				if (item.hasChildren) {
					item.collapsibleState = TreeItemCollapsibleState.Collapsed;
				}
				if (typeof item.description === 'string') {
					item.tooltip = new MarkdownString(item.description);
				}
				item.iconPath = (istc) ? ThemeIcon.File : ThemeIcon.Folder;
				item.label = item.name;
				item.description = item.code;
				item.bcid = item.id;
				item.istc = istc;
				item.id = undefined;
			});
			return items;
		};

		this.createCapabilityRoot = async (): Promise<CapabilityItem[]> => {
			const headers = generateHmac('GET', this.PATH + this.ROOT_ID);
			try {
				const requestUrl = this.buildRequestUrl(this.PATH + this.ROOT_ID + this.PARAMS);
				if (!requestUrl) return [];
				const response = await fetch(requestUrl, { headers });
				if (!response.ok) {
					return [];
				}
				const data = await response.json() as CapabilityItem[];
				const root = Array.isArray(data) ? data : [data];
				return this.createCapabilityItem(root, false);
			} catch (error) {
			}
			return [];
		};

		commands.registerCommand(COPY_CAPABILITY_CODE, async (element: CapabilityItem) => {
			env.clipboard.writeText(element.code).then(() => {
				window.showInformationMessage(`Capability code ${element.code} copied to clipboard!`);
			}, (error) => {
				window.showErrorMessage(`Failed to copy capability code: ${error.message}`);
			});			
		});
	}

	private readonly _onDidChangeTreeData: EventEmitter<CapabilityItem | undefined | null | void> = new EventEmitter<CapabilityItem | undefined | null | void>();
	readonly onDidChangeTreeData: Event<CapabilityItem | undefined | null | void> = this._onDidChangeTreeData.event;

	getTreeItem(element: CapabilityItem): TreeItem {
		return element;
	}

	async getChildren(element?: CapabilityItem): Promise<CapabilityItem[]> {
		if (element) {
			return this.createCapabilityChild(element);
		}
		const root = await this.createCapabilityRoot();
		if (root.length === 1) {
			const child = root.at(0);
			if (child !== undefined) {
				return this.createCapabilityChild(child);
			}
		}
		return root;
	}
}