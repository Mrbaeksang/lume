// Copyright 2026 The Lume Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';

/**
 * Feature #8 (first slice): impact view. For the symbols an Agent changed, show how
 * many places reference them — "AI changed validateToken, used in 7 places" — so the
 * blast radius is visible *without AI*, using VS Code's own reference provider.
 */

export interface ImpactSource {
	modifiedFiles(): vscode.Uri[];
	changedLines(fsPath: string): number[];
	readonly onDidChange: vscode.Event<void>;
}

interface ImpactItem {
	readonly name: string;
	readonly uri: vscode.Uri;
	readonly position: vscode.Position;
	readonly refs: number;
}

const INTERESTING = new Set<vscode.SymbolKind>([
	vscode.SymbolKind.Function, vscode.SymbolKind.Method, vscode.SymbolKind.Class,
	vscode.SymbolKind.Constructor, vscode.SymbolKind.Interface, vscode.SymbolKind.Enum,
	vscode.SymbolKind.Constant, vscode.SymbolKind.Variable, vscode.SymbolKind.Field,
	vscode.SymbolKind.Property, vscode.SymbolKind.Struct,
]);

function flatten(symbols: vscode.DocumentSymbol[]): vscode.DocumentSymbol[] {
	const out: vscode.DocumentSymbol[] = [];
	const walk = (s: vscode.DocumentSymbol) => { out.push(s); (s.children ?? []).forEach(walk); };
	symbols.forEach(walk);
	return out;
}

function overlaps(range: vscode.Range, lines: Set<number>): boolean {
	for (let l = range.start.line; l <= range.end.line; l++) {
		if (lines.has(l)) { return true; }
	}
	return false;
}

async function documentSymbols(uri: vscode.Uri): Promise<vscode.DocumentSymbol[]> {
	try {
		const res = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', uri);
		return Array.isArray(res) ? res : [];
	} catch {
		return [];
	}
}

async function references(uri: vscode.Uri, pos: vscode.Position): Promise<vscode.Location[]> {
	try {
		const res = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', uri, pos);
		return Array.isArray(res) ? res : [];
	} catch {
		return [];
	}
}

export class ImpactProvider implements vscode.TreeDataProvider<ImpactItem> {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
	private items: ImpactItem[] = [];
	private timer?: ReturnType<typeof setTimeout>;

	constructor(private readonly source: ImpactSource) {
		source.onDidChange(() => this.schedule());
	}

	refresh(): void {
		void this.recompute();
	}

	private schedule(): void {
		if (this.timer) { clearTimeout(this.timer); }
		this.timer = setTimeout(() => void this.recompute(), 600);
	}

	private async recompute(): Promise<void> {
		const items: ImpactItem[] = [];
		for (const uri of this.source.modifiedFiles()) {
			const lines = new Set(this.source.changedLines(uri.fsPath));
			if (!lines.size) { continue; }
			const syms = flatten(await documentSymbols(uri)).filter(s => INTERESTING.has(s.kind) && overlaps(s.range, lines));
			for (const s of syms) {
				const pos = s.selectionRange.start;
				const refs = await references(uri, pos);
				const external = refs.filter(r => !(r.uri.fsPath === uri.fsPath && r.range.start.line === pos.line)).length;
				items.push({ name: s.name, uri, position: pos, refs: external });
			}
		}
		items.sort((a, b) => b.refs - a.refs);
		this.items = items;
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(it: ImpactItem): vscode.TreeItem {
		const item = new vscode.TreeItem(it.name, vscode.TreeItemCollapsibleState.None);
		item.description = `${it.refs} refs · ${vscode.workspace.asRelativePath(it.uri)}`;
		item.tooltip = `${it.name} is referenced in ${it.refs} place(s) outside its definition`;
		item.iconPath = new vscode.ThemeIcon('references');
		item.command = {
			command: 'vscode.open',
			title: 'Open',
			arguments: [it.uri, { selection: new vscode.Range(it.position, it.position) }],
		};
		return item;
	}

	getChildren(): ImpactItem[] {
		return this.items;
	}
}
