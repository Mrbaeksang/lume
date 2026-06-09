// Copyright 2026 The Lume Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';

/**
 * Workspace switcher: a sidebar list of your projects with a "+" to add one and a
 * click to open it (as a new window/tab). Git branch shown per project. The list is
 * global (shared across every Lume window), persisted in extension global state.
 */

const KEY = 'lume.projects';

interface Project {
	readonly path: string;
	readonly branch?: string;
}

async function gitBranch(folder: string): Promise<string | undefined> {
	try {
		const head = await vscode.workspace.fs.readFile(vscode.Uri.file(`${folder}/.git/HEAD`));
		const text = Buffer.from(head).toString('utf8').trim();
		const m = text.match(/^ref: refs\/heads\/(.+)$/);
		return m ? m[1] : text.slice(0, 7);
	} catch {
		return undefined;
	}
}

export class ProjectsProvider implements vscode.TreeDataProvider<Project> {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	constructor(private readonly ctx: vscode.ExtensionContext) {}

	private paths(): string[] {
		return this.ctx.globalState.get<string[]>(KEY, []);
	}

	private async save(paths: string[]): Promise<void> {
		await this.ctx.globalState.update(KEY, paths);
		this._onDidChangeTreeData.fire();
	}

	async add(): Promise<void> {
		const picked = await vscode.window.showOpenDialog({
			canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
			openLabel: 'Add to Lume Projects',
		});
		if (!picked || !picked.length) { return; }
		const p = picked[0].fsPath;
		const paths = this.paths();
		if (!paths.includes(p)) { paths.push(p); await this.save(paths); }
	}

	async remove(project: Project): Promise<void> {
		await this.save(this.paths().filter(p => p !== project.path));
	}

	async getChildren(): Promise<Project[]> {
		return Promise.all(this.paths().map(async path => ({ path, branch: await gitBranch(path) })));
	}

	getTreeItem(project: Project): vscode.TreeItem {
		const uri = vscode.Uri.file(project.path);
		const item = new vscode.TreeItem(uri, vscode.TreeItemCollapsibleState.None);
		item.label = project.path.split('/').pop() || project.path;
		item.description = project.branch ? `⎇ ${project.branch}` : project.path;
		item.tooltip = project.path;
		item.iconPath = new vscode.ThemeIcon('folder');
		item.contextValue = 'lumeProject';
		item.command = {
			command: 'vscode.openFolder',
			title: 'Open Project',
			arguments: [uri, { forceNewWindow: true }],
		};
		return item;
	}
}
