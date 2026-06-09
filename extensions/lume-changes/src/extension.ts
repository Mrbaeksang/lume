// Copyright 2026 The Lume Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileP = promisify(execFile);

/**
 * Lume MVP: detect External edits (changes that land on disk from outside Lume's
 * editor), show Baseline ↔ Now as a diff with +/- counts and gutter bars, and
 * keep/undo each per file. See docs/adr/0002, 0003.
 */

const BASELINE_SCHEME = 'lume-baseline';
const IGNORED_SEGMENTS = ['/node_modules/', '/.git/', '/out/', '/dist/', '/build/', '/.vscode-test/', '/.lume/'];
const MAX_BASELINE_BYTES = 1_000_000; // skip very large / binary files for now
const MAX_DIFF_CELLS = 4_000_000;     // cap line-diff work on huge files

type ChangeKind = 'modified' | 'added' | 'deleted';

interface Change {
	readonly uri: vscode.Uri;
	readonly kind: ChangeKind;
	readonly added: number;
	readonly removed: number;
}

interface PersistedEntry {
	readonly kind: ChangeKind;
	readonly baseline: string | null;
}

function isIgnored(uri: vscode.Uri): boolean {
	return IGNORED_SEGMENTS.some(seg => uri.path.includes(seg));
}

function splitLines(text: string): string[] {
	return text.length ? text.split('\n') : [];
}

/** Line-level diff: which lines in `after` are new, plus +/- counts (LCS based). */
function lineDiff(before: string, after: string): { addedLines: number[]; added: number; removed: number } {
	const a = splitLines(before);
	const b = splitLines(after);
	const n = a.length;
	const m = b.length;
	if (n * m > MAX_DIFF_CELLS) {
		return { addedLines: b.map((_, i) => i), added: m, removed: n };
	}
	const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}
	const addedLines: number[] = [];
	let i = 0;
	let j = 0;
	let removed = 0;
	while (i < n && j < m) {
		if (a[i] === b[j]) { i++; j++; }
		else if (dp[i + 1][j] >= dp[i][j + 1]) { removed++; i++; }
		else { addedLines.push(j); j++; }
	}
	while (j < m) { addedLines.push(j); j++; }
	removed += n - i;
	return { addedLines, added: addedLines.length, removed };
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
	private readonly lineMarks = new Map<string, number[]>();   // path -> changed line indices (for gutter)

	private readonly _onDidChange = new vscode.EventEmitter<void>();
	readonly onDidChange = this._onDidChange.event;
	private _version = 0;
	private saveTimer?: ReturnType<typeof setTimeout>;

	constructor(private readonly storageUri: vscode.Uri | undefined) {}

	get version(): number {
		return this._version;
	}

	list(): Change[] {
		return [...this.changes.values()].sort((a, b) => a.uri.path.localeCompare(b.uri.path));
	}

	addedLinesFor(fsPath: string): number[] {
		return this.lineMarks.get(fsPath) ?? [];
	}

	private notify(): void {
		this._version++;
		this._onDidChange.fire();
		this.scheduleSave();
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
			if (this.baseline.has(uri.fsPath)) { return; } // don't clobber a restored Baseline
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
		const known = this.baseline.get(key);
		if (known !== undefined && known === text) {
			this.clear(key);
			return;
		}

		const finalKind = this.changes.get(key)?.kind === 'added' ? 'added' : kind;
		const before = await this.baselineContent(uri);
		const { addedLines, added, removed } = lineDiff(before, text);
		this.lineMarks.set(key, addedLines);
		this.changes.set(key, { uri, kind: finalKind, added, removed });
		this.notify();
	}

	onDiskCreated(uri: vscode.Uri): void {
		void this.onDiskWrite(uri, 'added');
	}

	async onDiskDeleted(uri: vscode.Uri): Promise<void> {
		if (isIgnored(uri)) { return; }
		const key = uri.fsPath;
		if (!this.baseline.has(key)) {
			this.clear(key); // never knew it (e.g. undoing an 'added' file)
			return;
		}
		const removed = splitLines(this.baseline.get(key) ?? '').length;
		this.lineMarks.delete(key);
		this.changes.set(key, { uri, kind: 'deleted', added: 0, removed });
		this.notify();
	}

	/** Keep the External edit: the current content becomes the new Baseline. */
	async accept(change: Change): Promise<void> {
		const key = change.uri.fsPath;
		if (change.kind === 'deleted') {
			this.baseline.delete(key);
		} else {
			const text = await readText(change.uri);
			if (text !== undefined) { this.baseline.set(key, text); }
		}
		this.clear(key);
	}

	/** Discard the External edit: restore the file to its Baseline. */
	async undo(change: Change): Promise<void> {
		const key = change.uri.fsPath;
		if (change.kind === 'added') {
			try { await vscode.workspace.fs.delete(change.uri, { useTrash: false }); } catch { /* already gone */ }
		} else {
			const content = await this.baselineContent(change.uri);
			this.baseline.set(key, content);
			await vscode.workspace.fs.writeFile(change.uri, Buffer.from(content, 'utf8'));
		}
		this.clear(key);
	}

	async acceptAll(): Promise<void> {
		for (const change of this.list()) { await this.accept(change); }
	}

	async undoAll(): Promise<void> {
		for (const change of this.list()) { await this.undo(change); }
	}

	private clear(key: string): void {
		this.lineMarks.delete(key);
		if (this.changes.delete(key)) {
			this.notify();
		}
	}

	// --- persistence ---------------------------------------------------------

	private stateFile(): vscode.Uri | undefined {
		return this.storageUri ? vscode.Uri.joinPath(this.storageUri, 'state.json') : undefined;
	}

	private scheduleSave(): void {
		if (!this.storageUri) { return; }
		if (this.saveTimer) { clearTimeout(this.saveTimer); }
		this.saveTimer = setTimeout(() => void this.save(), 250);
	}

	private async save(): Promise<void> {
		const file = this.stateFile();
		if (!file) { return; }
		const entries: Record<string, PersistedEntry> = {};
		for (const [key, change] of this.changes) {
			entries[key] = { kind: change.kind, baseline: this.baseline.get(key) ?? null };
		}
		try {
			await vscode.workspace.fs.createDirectory(this.storageUri!);
			await vscode.workspace.fs.writeFile(file, Buffer.from(JSON.stringify({ entries }), 'utf8'));
		} catch { /* best effort */ }
	}

	async load(): Promise<void> {
		const file = this.stateFile();
		if (!file) { return; }
		try {
			const bytes = await vscode.workspace.fs.readFile(file);
			const data = JSON.parse(Buffer.from(bytes).toString('utf8')) as { entries?: Record<string, PersistedEntry> };
			for (const [key, entry] of Object.entries(data.entries ?? {})) {
				this.changes.set(key, { uri: vscode.Uri.file(key), kind: entry.kind, added: 0, removed: 0 });
				if (entry.baseline !== null) { this.baseline.set(key, entry.baseline); }
			}
		} catch { /* nothing persisted yet */ }
	}

	/** Recompute +/- counts and gutter marks for the current change set. */
	async recomputeCounts(): Promise<void> {
		for (const [key, change] of [...this.changes]) {
			if (change.kind === 'deleted') {
				this.changes.set(key, { ...change, removed: splitLines(this.baseline.get(key) ?? '').length });
				continue;
			}
			const text = await readText(change.uri);
			if (text === undefined) { continue; }
			const before = await this.baselineContent(change.uri);
			const { addedLines, added, removed } = lineDiff(before, text);
			this.lineMarks.set(key, addedLines);
			this.changes.set(key, { ...change, added, removed });
		}
		this._onDidChange.fire();
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

/** Draws a gutter bar on changed lines of the open file. */
class GutterDecorator {
	private readonly type: vscode.TextEditorDecorationType;

	constructor(extensionUri: vscode.Uri, private readonly tracker: ChangeTracker) {
		this.type = vscode.window.createTextEditorDecorationType({
			gutterIconPath: vscode.Uri.joinPath(extensionUri, 'resources', 'gutter-bar.svg'),
			gutterIconSize: 'contain',
			overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.modifiedForeground'),
			overviewRulerLane: vscode.OverviewRulerLane.Left,
		});
	}

	update(editor?: vscode.TextEditor): void {
		if (!editor) { return; }
		const lines = this.tracker.addedLinesFor(editor.document.uri.fsPath);
		const ranges = lines
			.filter(l => l < editor.document.lineCount)
			.map(l => new vscode.Range(l, 0, l, 0));
		editor.setDecorations(this.type, ranges);
	}

	updateAll(): void {
		for (const editor of vscode.window.visibleTextEditors) { this.update(editor); }
	}

	dispose(): void {
		this.type.dispose();
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
		item.description = change.kind === 'deleted' ? `-${change.removed}` : `+${change.added} -${change.removed}`;
		item.tooltip = `${change.kind} · +${change.added} -${change.removed}`;
		item.resourceUri = change.uri;
		item.contextValue = 'lumeChange';
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
	const tracker = new ChangeTracker(context.storageUri);
	const provider = new ChangesProvider(tracker);
	const decorator = new GutterDecorator(context.extensionUri, tracker);

	const watcher = vscode.workspace.createFileSystemWatcher('**/*');
	context.subscriptions.push(
		watcher,
		decorator,
		watcher.onDidChange(uri => void tracker.onDiskWrite(uri, 'modified')),
		watcher.onDidCreate(uri => tracker.onDiskCreated(uri)),
		watcher.onDidDelete(uri => void tracker.onDiskDeleted(uri)),
		vscode.workspace.onDidSaveTextDocument(doc => tracker.noteEditorSave(doc)),
		vscode.workspace.registerTextDocumentContentProvider(BASELINE_SCHEME, new BaselineProvider(tracker)),
		vscode.window.registerTreeDataProvider('lume.changes', provider),
		vscode.window.onDidChangeActiveTextEditor(editor => decorator.update(editor)),
		vscode.window.onDidChangeVisibleTextEditors(() => decorator.updateAll()),
		tracker.onDidChange(() => decorator.updateAll()),
		vscode.commands.registerCommand('lume.refresh', () => provider.refresh()),
		vscode.commands.registerCommand('lume.accept', (change: Change) => tracker.accept(change)),
		vscode.commands.registerCommand('lume.undo', (change: Change) => tracker.undo(change)),
		vscode.commands.registerCommand('lume.acceptAll', () => tracker.acceptAll()),
		vscode.commands.registerCommand('lume.undoAll', () => tracker.undoAll()),
	);

	void (async () => {
		await tracker.load();
		await tracker.seed();
		await tracker.recomputeCounts();
		decorator.updateAll();
	})();
}

export function deactivate(): void {}
