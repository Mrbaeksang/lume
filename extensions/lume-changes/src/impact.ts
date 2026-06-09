// Copyright 2026 The Lume Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';

/**
 * Feature #8: impact / code map. For the symbols an Agent changed, show how many
 * places reference them ("used in 7 places") and let the user expand a symbol to see
 * exactly *who calls it* — the blast radius, explorable, all *without AI* (VS Code's
 * own reference + call-hierarchy providers).
 */

export interface ImpactSource {
	modifiedFiles(): vscode.Uri[];
	changedLines(fsPath: string): number[];
	readonly onDidChange: vscode.Event<void>;
}

interface SymbolNode {
	readonly kind: 'symbol';
	readonly name: string;
	readonly uri: vscode.Uri;
	readonly position: vscode.Position;
	readonly refs: number;
}

interface CallerNode {
	readonly kind: 'caller';
	readonly name: string;
	readonly uri: vscode.Uri;
	readonly range: vscode.Range;
}

type ImpactNode = SymbolNode | CallerNode;

// Only callable/structural symbols carry meaningful blast radius; interface fields,
// properties and local variables are noise.
const RELEVANT = new Set<vscode.SymbolKind>([
	vscode.SymbolKind.Function, vscode.SymbolKind.Method,
	vscode.SymbolKind.Class, vscode.SymbolKind.Constructor,
]);
// Don't descend into these — their children are local variables, not API.
const OPAQUE = new Set<vscode.SymbolKind>([
	vscode.SymbolKind.Function, vscode.SymbolKind.Method, vscode.SymbolKind.Constructor,
]);

function relevantSymbols(symbols: vscode.DocumentSymbol[], out: vscode.DocumentSymbol[] = []): vscode.DocumentSymbol[] {
	for (const s of symbols) {
		if (RELEVANT.has(s.kind)) { out.push(s); }
		if (!OPAQUE.has(s.kind)) { relevantSymbols(s.children ?? [], out); }
	}
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

async function incomingCallers(uri: vscode.Uri, pos: vscode.Position): Promise<CallerNode[]> {
	try {
		const prepared = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>('vscode.prepareCallHierarchy', uri, pos);
		if (!prepared || !prepared.length) { return []; }
		const calls = await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>('vscode.provideIncomingCalls', prepared[0]);
		return (calls ?? []).map(c => ({ kind: 'caller', name: c.from.name, uri: c.from.uri, range: c.from.selectionRange }));
	} catch {
		return [];
	}
}

export interface GraphNode {
	readonly id: string;
	readonly label: string;
	readonly kind: 'changed' | 'caller';
	readonly file: string;
	readonly line: number;
}

export interface GraphEdge {
	readonly from: string;
	readonly to: string;
}

export interface ImpactGraph {
	readonly nodes: GraphNode[];
	readonly edges: GraphEdge[];
}

/** Build a node-link graph: changed symbols and the places that call them. */
export async function buildImpactGraph(source: ImpactSource): Promise<ImpactGraph> {
	const nodes = new Map<string, GraphNode>();
	const edges: GraphEdge[] = [];
	const add = (n: GraphNode) => { if (!nodes.has(n.id)) { nodes.set(n.id, n); } };

	for (const uri of source.modifiedFiles()) {
		const lines = new Set(source.changedLines(uri.fsPath));
		if (!lines.size) { continue; }
		const syms = relevantSymbols(await documentSymbols(uri)).filter(s => overlaps(s.range, lines));
		for (const s of syms) {
			const pos = s.selectionRange.start;
			const symId = `${uri.fsPath}:${pos.line}:${s.name}`;
			add({ id: symId, label: s.name, kind: 'changed', file: uri.fsPath, line: pos.line });
			for (const c of await incomingCallers(uri, pos)) {
				const callerId = `${c.uri.fsPath}:${c.range.start.line}:${c.name}`;
				add({ id: callerId, label: c.name, kind: 'caller', file: c.uri.fsPath, line: c.range.start.line });
				edges.push({ from: callerId, to: symId });
			}
		}
	}
	return { nodes: [...nodes.values()], edges };
}

export class ImpactProvider implements vscode.TreeDataProvider<ImpactNode> {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
	private items: SymbolNode[] = [];
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
		const items: SymbolNode[] = [];
		for (const uri of this.source.modifiedFiles()) {
			const lines = new Set(this.source.changedLines(uri.fsPath));
			if (!lines.size) { continue; }
			const syms = relevantSymbols(await documentSymbols(uri)).filter(s => overlaps(s.range, lines));
			for (const s of syms) {
				const pos = s.selectionRange.start;
				const refs = await references(uri, pos);
				const external = refs.filter(r => !(r.uri.fsPath === uri.fsPath && r.range.start.line === pos.line)).length;
				items.push({ kind: 'symbol', name: s.name, uri, position: pos, refs: external });
			}
		}
		items.sort((a, b) => b.refs - a.refs);
		this.items = items;
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(node: ImpactNode): vscode.TreeItem {
		if (node.kind === 'caller') {
			const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.None);
			item.description = `${vscode.workspace.asRelativePath(node.uri)}:${node.range.start.line + 1}`;
			item.iconPath = new vscode.ThemeIcon('call-incoming');
			item.command = { command: 'vscode.open', title: 'Open', arguments: [node.uri, { selection: node.range }] };
			return item;
		}
		const item = new vscode.TreeItem(node.name, vscode.TreeItemCollapsibleState.Collapsed);
		item.description = `${node.refs} refs · ${vscode.workspace.asRelativePath(node.uri)}`;
		item.tooltip = `${node.name} is referenced in ${node.refs} place(s). Expand to see callers.`;
		item.iconPath = new vscode.ThemeIcon('symbol-method');
		return item;
	}

	async getChildren(node?: ImpactNode): Promise<ImpactNode[]> {
		if (!node) { return this.items; }
		if (node.kind === 'symbol') { return incomingCallers(node.uri, node.position); }
		return [];
	}

	/** Highest reference count among a file's changed symbols (0 if none / not computed). */
	scoreFor(fsPath: string): number {
		let max = 0;
		for (const it of this.items) {
			if (it.uri.fsPath === fsPath && it.refs > max) { max = it.refs; }
		}
		return max;
	}
}
