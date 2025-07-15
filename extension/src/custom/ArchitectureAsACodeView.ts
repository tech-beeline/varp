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
		const view = vscode.window.createTreeView('ArchitectureAsACodeView', { treeDataProvider: this, showCollapseAll: true, canSelectMany: true });
		context.subscriptions.push(view);
		this.uri = Uri.file(context.asAbsolutePath('patterns.json'));
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