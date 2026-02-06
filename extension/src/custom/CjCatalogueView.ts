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

class Cj extends vscode.TreeItem {
    name: string;
	bpmn: boolean;
    childrens: Cj[];
}

export class CjProvider implements vscode.TreeDataProvider<Cj> {
	private readonly PARAMS = '?sample=ALL';
	private readonly CJ_ID = '/cj';
	private readonly PATH = '/cx/api/cx/v1/product';

	constructor(context: vscode.ExtensionContext) {
		const view = vscode.window.createTreeView('cjCatalogueView', { treeDataProvider: this, showCollapseAll: true, canSelectMany: true });
		context.subscriptions.push(view);
	}

	getTreeItem(element: Cj): vscode.TreeItem {
		return element;
	}

	initChapter(cjs: Cj[]): Cj[] {
		cjs.forEach(cj => {
			cj.label = cj.name;
			if (cj.childrens.length === 0) { /* empty */ } else {
				cj.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
			}
			this.initChapter(cj.childrens);
		});
		return cjs;
	}

	async getChildren(element?: Cj): Promise<Cj[]> {
		if (element) {
			return element.childrens;
		}

		const headers = generateHmac('GET', this.PATH + this.CJ_ID);
		const options: IRequestOptions = <IRequestOptions>{};
		options.ignoreSslError = !(vscode.workspace.getConfiguration().get(config.BEELINE_CERT_VERIFICATION) as boolean);
		const beelineApiUrl = C4Utils.removeTrailingSlash(vscode.workspace.getConfiguration().get(config.BEELINE_API_URL) as string);
		const httpc = new httpm.HttpClient('vscode-c4-dsl-plugin', [], options);

		let path = beelineApiUrl + this.PATH + this.CJ_ID + this.PARAMS;
		return httpc.get(path, headers).
			then((result) => { return result.readBody() }).
			then((body) => {
				return this.initChapter(JSON.parse(body.toString()) as Cj[]);
			}).
			catch((error) => { 
				return []
			 }).
			finally(() => { });
	}
}