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
import { Uri } from 'vscode';
import * as fs from 'fs';

class Pattern extends vscode.TreeItem {
    label: string;
	langId: string;
	snippetName: string;
	hover: string[];
    childrens: Pattern[];
}

export class PatternProvider implements vscode.TreeDataProvider<Pattern> {
	private uri : Uri;
	constructor(context: vscode.ExtensionContext) {
		const view = vscode.window.createTreeView('architectureAsACodeView', { treeDataProvider: this, showCollapseAll: true, canSelectMany: true });
		context.subscriptions.push(view);
		this.uri = Uri.file(context.asAbsolutePath('snippets.json'));
	}

	getTreeItem(element: Pattern): vscode.TreeItem {
		return element;
	  }

	  initChapter(patterns: Pattern[]) : Pattern[] {
		patterns.forEach(pattern => {
			if (pattern.childrens.length === 0) {
				pattern.command = {
					command: "c4.insert.snippet",
					title: "Insert Snippet",
					arguments:[{ langId: pattern.langId, name: pattern.snippetName }]
				};
				let tooltip = new vscode.MarkdownString("", true);
				pattern.hover.forEach(h => tooltip.appendMarkdown(h));
				pattern.tooltip = tooltip;
			} else {
				pattern.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
			}
			this.initChapter(pattern.childrens);
		  });
		  return patterns; 
	  }

	  async getChildren(element?: Pattern): Promise<Pattern[]> {
		if(element) {
			return Promise.resolve(element.childrens);
		}
		let data = fs.readFileSync(this.uri.fsPath);
		let pattern = JSON.parse(data.toString()) as Pattern
		return this.initChapter(pattern.childrens);
	  }	
}