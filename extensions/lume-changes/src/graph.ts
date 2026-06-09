// Copyright 2026 The Lume Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import { ImpactGraph } from './impact';

/**
 * Feature #8 (visual): render the impact data as a node-link graph in a webview —
 * changed symbols on the left, the places that call them on the right, connected by
 * edges, so the blast radius reads at a glance. Click a node to jump to it. No AI.
 */
export class ImpactGraphPanel {
	private panel?: vscode.WebviewPanel;

	show(graph: ImpactGraph): void {
		if (!this.panel) {
			this.panel = vscode.window.createWebviewPanel(
				'lumeImpactGraph',
				'Impact Graph',
				vscode.ViewColumn.Beside,
				{ enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
			);
			this.panel.onDidDispose(() => { this.panel = undefined; });
			this.panel.webview.onDidReceiveMessage((msg: { type?: string; file?: string; line?: number }) => {
				if (msg?.type === 'open' && msg.file) {
					const uri = vscode.Uri.file(msg.file);
					const line = msg.line ?? 0;
					void vscode.window.showTextDocument(uri, { selection: new vscode.Range(line, 0, line, 0) });
				}
			});
		}
		this.panel.webview.html = this.html(graph);
		this.panel.reveal(vscode.ViewColumn.Beside);
	}

	private html(graph: ImpactGraph): string {
		const data = JSON.stringify(graph).replace(/</g, '\\u003c');
		return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';" />
<style>
	html, body { margin: 0; padding: 0; height: 100vh; overflow: auto;
		background: var(--vscode-editor-background); color: var(--vscode-editor-foreground);
		font-family: var(--vscode-font-family); font-size: 12px; }
	#empty { padding: 24px; opacity: .7; }
	.node { cursor: pointer; }
	.node rect { rx: 6; }
	.node:hover rect { stroke: var(--vscode-focusBorder); stroke-width: 2; }
	.label { font-size: 12px; fill: var(--vscode-editor-foreground); pointer-events: none; }
	.sub { font-size: 10px; fill: var(--vscode-descriptionForeground); pointer-events: none; }
	.edge { fill: none; stroke: var(--vscode-editorIndentGuide-activeBackground, #888); stroke-width: 1.5; opacity: .8; }
	.col-title { font-size: 11px; fill: var(--vscode-descriptionForeground); text-transform: uppercase; letter-spacing: .5px; }
</style>
</head>
<body>
<div id="empty" style="display:none">No impact to graph yet. Change a referenced symbol (a function/class used elsewhere) and open this again.</div>
<svg id="g" xmlns="http://www.w3.org/2000/svg"></svg>
<script>
	const vscode = acquireVsCodeApi();
	const graph = ${data};
	const SVG = 'http://www.w3.org/2000/svg';
	const NODE_W = 190, NODE_H = 34, V_GAP = 16, MARGIN = 28, COL_GAP = 280;

	function el(name, attrs, parent) {
		const n = document.createElementNS(SVG, name);
		for (const k in attrs) { n.setAttribute(k, attrs[k]); }
		if (parent) { parent.appendChild(n); }
		return n;
	}
	function trim(s, max) { return s.length > max ? s.slice(0, max - 1) + '…' : s; }

	const svg = document.getElementById('g');
	const changed = graph.nodes.filter(n => n.kind === 'changed');
	const callers = graph.nodes.filter(n => n.kind === 'caller');

	if (!graph.nodes.length) {
		document.getElementById('empty').style.display = 'block';
		svg.style.display = 'none';
	} else {
		const changedX = MARGIN;
		const callerX = MARGIN + NODE_W + COL_GAP;
		const pos = {};
		const place = (list, x) => list.forEach((n, i) => { pos[n.id] = { x, y: MARGIN + 22 + i * (NODE_H + V_GAP) }; });
		place(changed, changedX);
		place(callers, callerX);

		const rows = Math.max(changed.length, callers.length, 1);
		const width = callerX + NODE_W + MARGIN;
		const height = MARGIN + 22 + rows * (NODE_H + V_GAP) + MARGIN;
		svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
		svg.setAttribute('width', width);
		svg.setAttribute('height', height);

		const defs = el('defs', {}, svg);
		const marker = el('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' }, defs);
		el('path', { d: 'M0,0 L10,5 L0,10 z', fill: 'var(--vscode-editorIndentGuide-activeBackground, #888)' }, marker);

		el('text', { x: changedX, y: 16, class: 'col-title' }, svg).textContent = 'AI changed';
		el('text', { x: callerX, y: 16, class: 'col-title' }, svg).textContent = 'used by';

		// edges: caller -> changed (dependency points at the changed symbol)
		for (const e of graph.edges) {
			const a = pos[e.from], b = pos[e.to];
			if (!a || !b) { continue; }
			const x1 = b.x + NODE_W, y1 = b.y + NODE_H / 2;          // changed node right edge
			const x2 = a.x, y2 = a.y + NODE_H / 2;                   // caller node left edge
			const mx = (x1 + x2) / 2;
			el('path', { class: 'edge', 'marker-end': 'url(#arrow)', d: 'M' + x2 + ',' + y2 + ' C' + mx + ',' + y2 + ' ' + mx + ',' + y1 + ' ' + x1 + ',' + y1 }, svg);
		}

		// nodes
		for (const n of graph.nodes) {
			const p = pos[n.id];
			const g = el('g', { class: 'node' }, svg);
			el('rect', {
				x: p.x, y: p.y, width: NODE_W, height: NODE_H, rx: 6,
				fill: n.kind === 'changed' ? 'var(--vscode-charts-blue, #3794ff)' : 'var(--vscode-editorWidget-background, #2a2a2a)',
				stroke: 'var(--vscode-widget-border, #454545)', 'stroke-width': 1,
				'fill-opacity': n.kind === 'changed' ? 0.85 : 1,
			}, g);
			el('text', { x: p.x + 12, y: p.y + 15, class: 'label' }, g).textContent = trim(n.label, 24);
			const file = n.file.split('/').pop() || n.file;
			el('text', { x: p.x + 12, y: p.y + 28, class: 'sub' }, g).textContent = trim(file + ':' + (n.line + 1), 26);
			g.addEventListener('click', () => vscode.postMessage({ type: 'open', file: n.file, line: n.line }));
			const t = el('title', {}, g);
			t.textContent = n.label + '  (' + file + ':' + (n.line + 1) + ')';
		}
	}
</script>
</body>
</html>`;
	}
}
