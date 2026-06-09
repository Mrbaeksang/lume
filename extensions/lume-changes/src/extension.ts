// Copyright 2026 The Lume Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileP = promisify(execFile);

/**
 * Slices 1–2: detect External edits (changes that land on disk from outside
 * Lume's editor) and let the user click one to see Baseline ↔ Now as a diff.
 *
 * Rule (see docs/adr/0002):
 *  - A file the user *saves* from the editor advances its Baseline — never flagged.
 *  - Any other on-disk change is an External edit (an Agent wrote it) — flagged.
 * Baseline = the file as we last knew it; for files we never snapshot­ted (e.g. a
 * huge repo past the seed cap) we fall back to git HEAD, else an empty document.
 */

const BASELINE_SCHEME = 'lume-baseline';
const IGNORED_SEGMENTS = ['/node_modules/', '/.git/', '/out/', '/dist/', '/build/', '/.vscode-test/', '/.lume/'];
const MAX_BASELINE_BYTES = 1_000_000; // skip very large / binary files for now

type ChangeKind = 'modified' | 'added' | 'deleted';

interface Change {
	readonly uri: vscode.Uri;
	readonly kind: ChangeKind;
}

function isIgnored(uri: vscode.Uri): boolean {
	return IGNORED_SEGMENTS.some(seg => uri.path.includes(seg));
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

/** Read a file's content at git HEAD, or undefined if untracked / not a repo. */
async function gitHead(fileUri: vscode.Uri): Promise<string | undefined> {
	const folder = vscode.workspace.getWorkspaceFolder(fileUri);
	if (!folder) { return undefined; }
	const rel = path.relative(folder.uri.fsPath, fileUri.fsPath);
	try {
		const { stdout } = await execFileP('git', ['show', `HEAD:${rel}`], {
			cwd: folder.uri.fsPath,
			maxBuffer: MAX_BASELINE_BYTES,
		});
		return stdout;
	} catch {
		return undefined;
	}
}

class ChangeTracker {
	private readonly baseline = new Map<string, string>();      // path -> Baseline content
	private readonly changes = new Map<string, Change>();       // path -> pending External edit
	private readonly editorSaves = new Map<string, string>();   // path -> content the editor just saved
	private readonly gitCache = new Map<string, string>();      // path -> git HEAD content (fallback)

	private readonly _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChange = this._onDidChange.event;
	private _version = 0;

	/** Bumps whenever the change set or a Baseline moves — used to bust diff caches. */
	get version(): number {
		return this._version;
	}

	list(): Change[] {
		return [...this.changes.values()].sort((a, b) => a.uri.path.localeCompare(b.uri.path));
	}

	private notify(): void {
		this._version++;
		this._onDidChange.fire();
	}

	/** The "before" content to diff an External edit against. */
	async baselineContent(fileUri: vscode.Uri): Promise<string> {
		const key = fileUri.fsPath;
		const known = this.baseline.get(key);
		if (known !== undefined) { return known; }
		if (this.gitCache.has(key)) { return this.gitCache.get(key)!; }
		const head = (await gitHead(fileUri)) ?? '';
		this.gitCache.set(key, head);
		return head;
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
		this.notify();
	}

	onDiskCreated(uri: vscode.Uri): void {
		void this.onDiskWrite(uri, 'added');
	}

	onDiskDeleted(uri: vscode.Uri): void {
		if (isIgnored(uri)) { return; }
		const key = uri.fsPath;
		this.changes.set(key, { uri, kind: 'deleted' });
		this.notify();
	}

	private clear(key: string): void {
		if (this.changes.delete(key)) {
			this.notify();
		}
	}
}

/** Serves Baseline (the "before") content for the diff's left-hand side. */
class BaselineProvider implements vscode.TextDocumentContentProvider {
	constructor(private readonly tracker: ChangeTracker) {}

	async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
		if (uri.query.startsWith('empty')) { return ''; }
		const fileUri = uri.with({ scheme: 'file', query: '' });
		return this.tracker.baselineContent(fileUri);
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

		const name = path.basename(change.uri.fsPath);
		const left = change.uri.with({ scheme: BASELINE_SCHEME, query: `v${this.tracker.version}` });
		const right = change.kind === 'deleted'
			? change.uri.with({ scheme: BASELINE_SCHEME, query: 'empty' })
			: change.uri;
		const title = change.kind === 'deleted' ? `${name} (deleted)` : `${name} (Baseline ↔ Now)`;
		item.command = { command: 'vscode.diff', title: 'Open Change', arguments: [left, right, title] };
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
		vscode.workspace.registerTextDocumentContentProvider(BASELINE_SCHEME, new BaselineProvider(tracker)),
		vscode.window.registerTreeDataProvider('lume.changes', provider),
		vscode.commands.registerCommand('lume.refresh', () => provider.refresh()),
	);

	void tracker.seed();
}

export function deactivate(): void {}
