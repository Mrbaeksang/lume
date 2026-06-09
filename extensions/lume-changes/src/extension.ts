// Copyright 2026 The Lume Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';

/**
 * Slice 1: detect External edits (changes that land on disk from outside Lume's
 * editor) and list them in the "AI Changes" view.
 *
 * Rule (see docs/adr/0002):
 *  - A file the user *saves* from the editor advances its Baseline — never flagged.
 *  - Any other on-disk change is an External edit (an Agent wrote it) — flagged.
 * Baseline is kept in memory for now; persistence lands in slice 3.
 */

type ChangeKind = 'modified' | 'added' | 'deleted';

interface Change {
	readonly uri: vscode.Uri;
	readonly kind: ChangeKind;
}

const IGNORED_SEGMENTS = ['/node_modules/', '/.git/', '/out/', '/dist/', '/build/', '/.vscode-test/', '/.lume/'];
const MAX_BASELINE_BYTES = 1_000_000; // skip very large / binary files for now

function isIgnored(uri: vscode.Uri): boolean {
	const p = uri.path;
	return IGNORED_SEGMENTS.some(seg => p.includes(seg));
}

async function readText(uri: vscode.Uri): Promise<string | undefined> {
	try {
		const bytes = await vscode.workspace.fs.readFile(uri);
		if (bytes.byteLength > MAX_BASELINE_BYTES || bytes.includes(0)) {
			return undefined; // too big or binary
		}
		return Buffer.from(bytes).toString('utf8');
	} catch {
		return undefined;
	}
}

class ChangeTracker {
	/** path -> last accepted (Baseline) content. Absent = never seen. */
	private readonly baseline = new Map<string, string>();
	/** path -> current pending External edit. */
	private readonly changes = new Map<string, Change>();
	/** path -> content the editor just saved (to recognise our own write echo). */
	private readonly editorSaves = new Map<string, string>();

	private readonly _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChange = this._onDidChange.event;

	list(): Change[] {
		return [...this.changes.values()].sort((a, b) => a.uri.path.localeCompare(b.uri.path));
	}

	/** Snapshot existing files so we have a "before" to diff External edits against. */
	async seed(): Promise<void> {
		const uris = await vscode.workspace.findFiles(
			'**/*',
			'**/{node_modules,.git,out,dist,build,.vscode-test,.lume}/**',
			5000,
		);
		await Promise.all(uris.map(async uri => {
			const text = await readText(uri);
			if (text !== undefined) {
				this.baseline.set(uri.fsPath, text);
			}
		}));
	}

	noteEditorSave(doc: vscode.TextDocument): void {
		this.editorSaves.set(doc.uri.fsPath, doc.getText());
	}

	// `kind` comes from the watcher event (create vs change), not from whether we
	// happen to hold a Baseline — a modified file may simply not have been seeded yet.
	async onDiskWrite(uri: vscode.Uri, kind: 'added' | 'modified'): Promise<void> {
		if (isIgnored(uri)) { return; }
		const key = uri.fsPath;
		const text = await readText(uri);
		if (text === undefined) { return; }

		// Our own editor save landing on disk → advance Baseline, don't flag.
		if (this.editorSaves.get(key) === text) {
			this.editorSaves.delete(key);
			this.baseline.set(key, text);
			this.clear(key);
			return;
		}

		// Reverted back to a known Baseline → no pending change.
		const before = this.baseline.get(key);
		if (before !== undefined && before === text) {
			this.clear(key);
			return;
		}

		// Keep an existing 'added' from being downgraded by a follow-up write.
		const finalKind = this.changes.get(key)?.kind === 'added' ? 'added' : kind;
		this.changes.set(key, { uri, kind: finalKind });
		this._onDidChange.fire();
	}

	onDiskCreated(uri: vscode.Uri): void {
		void this.onDiskWrite(uri, 'added');
	}

	onDiskDeleted(uri: vscode.Uri): void {
		if (isIgnored(uri)) { return; }
		const key = uri.fsPath;
		if (!this.baseline.has(key)) { return; } // we never knew it; ignore
		this.changes.set(key, { uri, kind: 'deleted' });
		this._onDidChange.fire();
	}

	private clear(key: string): void {
		if (this.changes.delete(key)) {
			this._onDidChange.fire();
		}
	}
}

class ChangesProvider implements vscode.TreeDataProvider<Change> {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	constructor(private readonly tracker: ChangeTracker) {
		tracker.onDidChange(() => this._onDidChangeTreeData.fire());
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(change: Change): vscode.TreeItem {
		const item = new vscode.TreeItem(change.uri, vscode.TreeItemCollapsibleState.None);
		item.description = change.kind;
		item.resourceUri = change.uri;
		item.iconPath = new vscode.ThemeIcon(
			change.kind === 'added' ? 'diff-added' : change.kind === 'deleted' ? 'diff-removed' : 'diff-modified',
		);
		return item;
	}

	getChildren(): Change[] {
		return this.tracker.list();
	}
}

export function activate(context: vscode.ExtensionContext): void {
	const tracker = new ChangeTracker();
	const provider = new ChangesProvider(tracker);

	const watcher = vscode.workspace.createFileSystemWatcher('**/*');
	context.subscriptions.push(
		watcher,
		watcher.onDidChange(uri => void tracker.onDiskWrite(uri, 'modified')),
		watcher.onDidCreate(uri => tracker.onDiskCreated(uri)),
		watcher.onDidDelete(uri => tracker.onDiskDeleted(uri)),
		vscode.workspace.onDidSaveTextDocument(doc => tracker.noteEditorSave(doc)),
		vscode.window.registerTreeDataProvider('lume.changes', provider),
		vscode.commands.registerCommand('lume.refresh', () => provider.refresh()),
	);

	void tracker.seed();
}

export function deactivate(): void {}
