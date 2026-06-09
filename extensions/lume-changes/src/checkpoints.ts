// Copyright 2026 The Lume Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';

/**
 * Feature #5: checkpoints — a step-by-step time machine. A checkpoint snapshots the
 * workspace's text files so the user can roll back to it after an Agent run goes wrong,
 * without untangling individual edits. Snapshots live in the extension's storage.
 */

const IGNORE_GLOB = '**/{node_modules,.git,out,dist,build,.vscode-test,.lume}/**';
const MAX_SNAPSHOT_BYTES = 1_000_000;
const MAX_AUTO = 15; // keep at most this many automatic checkpoints

export interface CheckpointMeta {
	readonly id: string;
	readonly label: string;
	readonly time: number; // epoch ms
	readonly fileCount: number;
	readonly auto?: boolean;
}

async function snapshotWorkspace(): Promise<Record<string, string>> {
	const uris = await vscode.workspace.findFiles('**/*', IGNORE_GLOB, 5000);
	const out: Record<string, string> = {};
	await Promise.all(uris.map(async uri => {
		try {
			const bytes = await vscode.workspace.fs.readFile(uri);
			if (bytes.byteLength > MAX_SNAPSHOT_BYTES || bytes.includes(0)) { return; }
			out[uri.fsPath] = Buffer.from(bytes).toString('utf8');
		} catch { /* unreadable */ }
	}));
	return out;
}

export class CheckpointStore {
	private readonly _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChange = this._onDidChange.event;
	private metas: CheckpointMeta[] = [];

	constructor(private readonly storageUri: vscode.Uri | undefined) {}

	list(): CheckpointMeta[] {
		return [...this.metas].sort((a, b) => b.time - a.time);
	}

	private dir(): vscode.Uri | undefined {
		return this.storageUri ? vscode.Uri.joinPath(this.storageUri, 'checkpoints') : undefined;
	}

	private indexFile(): vscode.Uri | undefined {
		const dir = this.dir();
		return dir ? vscode.Uri.joinPath(dir, 'index.json') : undefined;
	}

	private snapFile(id: string): vscode.Uri {
		return vscode.Uri.joinPath(this.dir()!, `${id}.json`);
	}

	async load(): Promise<void> {
		const file = this.indexFile();
		if (!file) { return; }
		try {
			const bytes = await vscode.workspace.fs.readFile(file);
			this.metas = JSON.parse(Buffer.from(bytes).toString('utf8')) as CheckpointMeta[];
			this._onDidChange.fire();
		} catch { /* none yet */ }
	}

	private async saveIndex(): Promise<void> {
		const dir = this.dir();
		const file = this.indexFile();
		if (!dir || !file) { return; }
		try {
			await vscode.workspace.fs.createDirectory(dir);
			await vscode.workspace.fs.writeFile(file, Buffer.from(JSON.stringify(this.metas), 'utf8'));
		} catch { /* best effort */ }
	}

	async create(label: string, auto = false): Promise<void> {
		const dir = this.dir();
		if (!dir) { return; }
		const files = await snapshotWorkspace();
		const id = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
		try {
			await vscode.workspace.fs.createDirectory(dir);
			await vscode.workspace.fs.writeFile(this.snapFile(id), Buffer.from(JSON.stringify(files), 'utf8'));
		} catch { return; }
		this.metas.push({ id, label, time: Date.now(), fileCount: Object.keys(files).length, auto });
		if (auto) { await this.pruneAutos(); }
		await this.saveIndex();
		this._onDidChange.fire();
	}

	/** Snapshot before a burst of Agent edits; capped so they don't pile up. */
	async createAuto(): Promise<void> {
		const stamp = new Date().toLocaleTimeString();
		await this.create(`Auto · ${stamp}`, true);
	}

	private async pruneAutos(): Promise<void> {
		const autos = this.metas.filter(m => m.auto).sort((a, b) => b.time - a.time);
		for (const old of autos.slice(MAX_AUTO)) {
			this.metas = this.metas.filter(m => m.id !== old.id);
			try { await vscode.workspace.fs.delete(this.snapFile(old.id)); } catch { /* gone */ }
		}
	}

	/** Write every snapshotted file back to disk. */
	async restore(id: string): Promise<void> {
		if (!this.dir()) { return; }
		const bytes = await vscode.workspace.fs.readFile(this.snapFile(id));
		const files = JSON.parse(Buffer.from(bytes).toString('utf8')) as Record<string, string>;
		await Promise.all(Object.entries(files).map(([p, content]) =>
			vscode.workspace.fs.writeFile(vscode.Uri.file(p), Buffer.from(content, 'utf8')),
		));
	}

	async remove(id: string): Promise<void> {
		if (!this.dir()) { return; }
		this.metas = this.metas.filter(m => m.id !== id);
		try { await vscode.workspace.fs.delete(this.snapFile(id)); } catch { /* gone */ }
		await this.saveIndex();
		this._onDidChange.fire();
	}
}

export class CheckpointsProvider implements vscode.TreeDataProvider<CheckpointMeta> {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	constructor(private readonly store: CheckpointStore) {
		store.onDidChange(() => this._onDidChangeTreeData.fire());
	}

	getTreeItem(c: CheckpointMeta): vscode.TreeItem {
		const item = new vscode.TreeItem(c.label, vscode.TreeItemCollapsibleState.None);
		item.description = `${new Date(c.time).toLocaleString()} · ${c.fileCount} files`;
		item.iconPath = new vscode.ThemeIcon('history');
		item.contextValue = 'lumeCheckpoint';
		item.id = c.id;
		return item;
	}

	getChildren(): CheckpointMeta[] {
		return this.store.list();
	}
}
