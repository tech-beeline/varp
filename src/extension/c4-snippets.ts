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

import { ExtensionContext, MarkdownString, TreeDataProvider, TreeItem, TreeItemCollapsibleState, Uri, window, workspace } from 'vscode';

class SnippetItem extends TreeItem {
	label: string  = '';
	langId: string  = '';
	snippetName: string = '';
	hover: string[] = [];
	childrens?: SnippetItem[];
}

export class C4Snippets implements TreeDataProvider<SnippetItem> {
	private readonly uri: Uri;
	constructor(context: ExtensionContext) {
		const view = window.createTreeView('s4-snippets', { treeDataProvider: this, showCollapseAll: true, canSelectMany: true });
		context.subscriptions.push(view);
		this.uri = Uri.file(context.asAbsolutePath('snippets.json'));
	}

	getTreeItem(element: SnippetItem): TreeItem {
		return element;
	}

	createSnippetItem(patterns: SnippetItem[]): SnippetItem[] {
		patterns.forEach(pattern => {
			const children = pattern.childrens ?? [];
			if (children.length === 0) {
				pattern.command = {
					command: "c4.insert.snippet",
					title: "Insert Snippet",
					arguments: [{ langId: pattern.langId, name: pattern.snippetName }]
				};
				let tooltip = new MarkdownString("", true);
				pattern.hover.forEach(h => tooltip.appendMarkdown(h));
				pattern.tooltip = tooltip;
			} else {
				pattern.collapsibleState = TreeItemCollapsibleState.Collapsed;
			}
			this.createSnippetItem(children);
		});
		return patterns;
	}

	async getChildren(element?: SnippetItem): Promise<SnippetItem[]> {
		if (element) {
			return element.childrens ?? [];
		}
		const data = await workspace.fs.readFile(this.uri);
		let pattern = JSON.parse(data.toString()) as SnippetItem
		return this.createSnippetItem(pattern.childrens ?? []);
	}
}