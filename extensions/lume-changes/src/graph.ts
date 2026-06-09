// Copyright 2026 The Lume Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import { ImpactGraph } from './impact';

/**
 * Feature #8 (visual): render impact as an interactive node-link graph in a webview.
 * Changed symbols glow at the centre; the things that call them orbit around, linked
 * by edges. Pan, zoom, drag, hover-highlight. Click a node to jump. No AI, no deps.
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
	:root { --accent: var(--vscode-charts-blue, #3794ff); }
	* { box-sizing: border-box; }
	html, body { margin: 0; padding: 0; height: 100vh; overflow: hidden;
		background: var(--vscode-editor-background); color: var(--vscode-editor-foreground);
		font-family: var(--vscode-font-family); font-size: 12px; user-select: none; }
	#bar { position: fixed; top: 0; left: 0; right: 0; height: 38px; display: flex; align-items: center; gap: 16px;
		padding: 0 14px; z-index: 5; backdrop-filter: blur(8px);
		background: color-mix(in srgb, var(--vscode-editor-background) 75%, transparent);
		border-bottom: 1px solid var(--vscode-widget-border, #ffffff14); }
	#bar .title { font-weight: 600; letter-spacing: .3px; }
	.legend { display: inline-flex; align-items: center; gap: 6px; opacity: .8; }
	.dot { width: 9px; height: 9px; border-radius: 50%; }
	.dot.changed { background: var(--accent); box-shadow: 0 0 6px var(--accent); }
	.dot.caller { background: var(--vscode-descriptionForeground, #888); }
	#bar .spacer { flex: 1; }
	#bar button { font: inherit; color: var(--vscode-foreground); background: transparent;
		border: 1px solid var(--vscode-widget-border, #ffffff22); border-radius: 5px; padding: 3px 9px; cursor: pointer; }
	#bar button:hover { background: var(--vscode-toolbar-hoverBackground, #ffffff14); }
	#hint { opacity: .55; font-size: 11px; }
	svg { display: block; width: 100vw; height: 100vh; cursor: grab; }
	svg.panning { cursor: grabbing; }
	.edge { fill: none; stroke: var(--vscode-descriptionForeground, #888); stroke-opacity: .35; stroke-width: 1.5; transition: stroke-opacity .12s; }
	.edge.hot { stroke: var(--accent); stroke-opacity: .95; stroke-width: 2; }
	.node { cursor: pointer; }
	.node .card { rx: 9; stroke: var(--vscode-widget-border, #ffffff22); stroke-width: 1;
		fill: var(--vscode-editorWidget-background, #252526); transition: opacity .12s; }
	.node.changed .card { fill: color-mix(in srgb, var(--accent) 22%, var(--vscode-editorWidget-background, #252526));
		stroke: var(--accent); filter: drop-shadow(0 0 7px color-mix(in srgb, var(--accent) 55%, transparent)); }
	.node .accent { rx: 2; }
	.node.changed .accent { fill: var(--accent); }
	.node.caller .accent { fill: var(--vscode-descriptionForeground, #888); }
	.node .name { font-size: 12px; font-weight: 600; fill: var(--vscode-editor-foreground); }
	.node .sub { font-size: 10px; fill: var(--vscode-descriptionForeground, #999); }
	.node:hover .card { stroke: var(--accent); stroke-width: 2; }
	.dim { opacity: .18; }
	.node.far { opacity: .72; }
	.badge { fill: var(--accent); }
	.badge-text { fill: var(--vscode-editor-background, #1e1e1e); font-size: 10px; font-weight: 700; pointer-events: none; }
	#empty { position: fixed; inset: 38px 0 0 0; display: flex; align-items: center; justify-content: center;
		text-align: center; padding: 40px; opacity: .65; line-height: 1.6; }
</style>
</head>
<body>
<div id="bar">
	<span class="title">Impact</span>
	<span class="legend"><span class="dot changed"></span>AI changed</span>
	<span class="legend"><span class="dot caller"></span>used by</span>
	<span id="counts" class="legend"></span>
	<span class="spacer"></span>
	<span id="hint">scroll = zoom · drag = move</span>
	<button id="fit">Fit</button>
</div>
<div id="empty" style="display:none">No impact to graph yet.<br/>Change a function/class that's used elsewhere, then open this again.</div>
<svg id="g">
	<defs>
		<marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
			<path d="M0,0 L10,5 L0,10 z" fill="var(--vscode-descriptionForeground, #888)"></path>
		</marker>
		<pattern id="grid" width="26" height="26" patternUnits="userSpaceOnUse">
			<circle cx="1" cy="1" r="1" fill="var(--vscode-editorIndentGuide-background, #ffffff10)"></circle>
		</pattern>
	</defs>
	<rect id="bg" x="-5000" y="-5000" width="10000" height="10000" fill="url(#grid)"></rect>
	<g id="view">
		<g id="edges"></g>
		<g id="nodes"></g>
	</g>
</svg>
<script>
	const vscode = acquireVsCodeApi();
	const graph = ${data};
	const SVG = 'http://www.w3.org/2000/svg';
	const NS = (n, a) => { const e = document.createElementNS(SVG, n); for (const k in a) e.setAttribute(k, a[k]); return e; };
	const trim = (s, m) => s.length > m ? s.slice(0, m - 1) + '…' : s;

	const svg = document.getElementById('g');
	const viewG = document.getElementById('view');
	const edgesG = document.getElementById('edges');
	const nodesG = document.getElementById('nodes');

	if (!graph.nodes.length) {
		document.getElementById('empty').style.display = 'flex';
	} else {
		document.getElementById('counts').textContent = graph.nodes.length + ' nodes · ' + graph.edges.length + ' links';
		run();
	}

	function run() {
		const W = 220, H = 46;
		const nodes = graph.nodes.map((n, i) => ({ ...n, w: W, h: H,
			x: Math.cos(i) * 200 + (n.kind === 'changed' ? 0 : 320),
			y: (i - graph.nodes.length / 2) * 70, vx: 0, vy: 0, fixed: false }));
		const byId = {}; nodes.forEach(n => byId[n.id] = n);
		const links = graph.edges.map(e => ({ s: byId[e.from], t: byId[e.to] })).filter(l => l.s && l.t);

		// --- force layout (settle once) ---
		for (let step = 0; step < 420; step++) {
			for (let a = 0; a < nodes.length; a++) {
				for (let b = a + 1; b < nodes.length; b++) {
					const na = nodes[a], nb = nodes[b];
					let dx = na.x - nb.x, dy = na.y - nb.y;
					let d2 = dx * dx + dy * dy || 1; const d = Math.sqrt(d2);
					const f = 14000 / d2; const ux = dx / d, uy = dy / d;
					na.vx += ux * f; na.vy += uy * f; nb.vx -= ux * f; nb.vy -= uy * f;
				}
			}
			for (const l of links) {
				let dx = l.t.x - l.s.x, dy = l.t.y - l.s.y; const d = Math.sqrt(dx * dx + dy * dy) || 1;
				const f = (d - 190) * 0.04; const ux = dx / d, uy = dy / d;
				l.s.vx += ux * f; l.s.vy += uy * f; l.t.vx -= ux * f; l.t.vy -= uy * f;
			}
			for (const n of nodes) {
				n.vx += -n.x * 0.006; n.vy += -n.y * 0.006;
				n.vx *= 0.82; n.vy *= 0.82;
				if (!n.fixed) { n.x += n.vx; n.y += n.vy; }
			}
		}

		// --- view transform (pan/zoom) ---
		let scale = 1, tx = 0, ty = 0;
		const apply = () => viewG.setAttribute('transform', 'translate(' + tx + ',' + ty + ') scale(' + scale + ')');
		const fit = () => {
			const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y);
			const minX = Math.min(...xs) - 40, maxX = Math.max(...xs) + W + 40;
			const minY = Math.min(...ys) - 40, maxY = Math.max(...ys) + H + 40;
			const vw = window.innerWidth, vh = window.innerHeight - 38;
			scale = Math.min(vw / (maxX - minX), vh / (maxY - minY), 1.4);
			tx = -minX * scale + (vw - (maxX - minX) * scale) / 2;
			ty = -minY * scale + (vh - (maxY - minY) * scale) / 2 + 38;
			apply();
		};
		document.getElementById('fit').onclick = fit;

		// --- render ---
		const edgeEls = [], nodeEls = [];
		const neighbours = {};
		for (const l of links) {
			(neighbours[l.s.id] = neighbours[l.s.id] || new Set()).add(l.t.id);
			(neighbours[l.t.id] = neighbours[l.t.id] || new Set()).add(l.s.id);
		}
		function edgePath(l) {
			const x1 = l.s.x + l.s.w / 2, y1 = l.s.y + l.s.h / 2;
			const x2 = l.t.x + l.t.w / 2, y2 = l.t.y + l.t.h / 2;
			const mx = (x1 + x2) / 2;
			return 'M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + x2 + ',' + y2;
		}
		for (const l of links) {
			const p = NS('path', { class: 'edge', 'marker-end': 'url(#arrow)', d: edgePath(l) });
			l.el = p; edgeEls.push(p); edgesG.appendChild(p);
		}
		function placeNode(n) {
			for (const [el, dx, dy] of n.parts) { el.setAttribute('x', n.x + dx); el.setAttribute('y', n.y + dy); }
		}
		for (const n of nodes) {
			const g = NS('g', { class: 'node ' + n.kind + (n.depth === 2 ? ' far' : '') });
			n.parts = [];
			const part = (el, dx, dy) => { n.parts.push([el, dx, dy]); g.appendChild(el); return el; };
			const card = part(NS('rect', { class: 'card', width: n.w, height: n.h }), 0, 0);
			if (n.kind === 'changed' && n.refs) {
				card.style.filter = 'drop-shadow(0 0 ' + (5 + Math.min(n.refs, 12) * 1.6) + 'px color-mix(in srgb, var(--accent) 60%, transparent))';
			}
			part(NS('rect', { class: 'accent', width: 4, height: n.h - 18 }), 6, 9);
			const name = part(NS('text', { class: 'name' }), 18, 20); name.textContent = trim(n.label, 24);
			const file = (n.file.split('/').pop() || n.file);
			const sub = part(NS('text', { class: 'sub' }), 18, 35); sub.textContent = trim(file + ':' + (n.line + 1), 30);
			if (n.kind === 'changed' && n.refs) {
				const bw = 24 + String(n.refs).length * 7;
				part(NS('rect', { class: 'badge', width: bw, height: 15, rx: 7.5 }), n.w - bw - 8, 7);
				const bt = part(NS('text', { class: 'badge-text', 'text-anchor': 'middle' }), n.w - bw / 2 - 8, 18); bt.textContent = n.refs + '↗';
			}
			const tt = NS('title', {}); tt.textContent = n.label + '  (' + file + ':' + (n.line + 1) + (n.refs ? ' · used ' + n.refs + 'x' : '') + ')'; g.appendChild(tt);
			n.el = g; nodeEls.push(g); nodesG.appendChild(g);
			placeNode(n);
			g.addEventListener('mouseenter', () => highlight(n.id));
			g.addEventListener('mouseleave', () => highlight(null));
			startDrag(g, n);
		}
		function redraw() {
			for (const l of links) l.el.setAttribute('d', edgePath(l));
			for (const n of nodes) placeNode(n);
		}
		function highlight(id) {
			if (!id) { nodeEls.forEach(e => e.classList.remove('dim')); edgeEls.forEach(e => e.classList.remove('dim', 'hot')); return; }
			const keep = neighbours[id] || new Set();
			for (const n of nodes) n.el.classList.toggle('dim', n.id !== id && !keep.has(n.id));
			for (const l of links) {
				const on = l.s.id === id || l.t.id === id;
				l.el.classList.toggle('hot', on); l.el.classList.toggle('dim', !on);
			}
		}

		// --- interactions ---
		let dragNode = null, panning = false, last = null, moved = false;
		function startDrag(g, n) {
			g.addEventListener('mousedown', (e) => { dragNode = n; n.fixed = true; last = { x: e.clientX, y: e.clientY }; moved = false; e.stopPropagation(); });
			g.addEventListener('click', () => { if (!moved) vscode.postMessage({ type: 'open', file: n.file, line: n.line }); });
		}
		svg.addEventListener('mousedown', (e) => { panning = true; last = { x: e.clientX, y: e.clientY }; svg.classList.add('panning'); });
		window.addEventListener('mousemove', (e) => {
			if (dragNode) { dragNode.x += (e.clientX - last.x) / scale; dragNode.y += (e.clientY - last.y) / scale; last = { x: e.clientX, y: e.clientY }; moved = true; redraw(); }
			else if (panning) { tx += e.clientX - last.x; ty += e.clientY - last.y; last = { x: e.clientX, y: e.clientY }; apply(); }
		});
		window.addEventListener('mouseup', () => { if (dragNode) dragNode.fixed = false; dragNode = null; panning = false; svg.classList.remove('panning'); });
		svg.addEventListener('wheel', (e) => {
			e.preventDefault();
			const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
			const ns = Math.max(0.2, Math.min(3, scale * factor));
			tx = e.clientX - (e.clientX - tx) * (ns / scale); ty = e.clientY - (e.clientY - ty) * (ns / scale);
			scale = ns; apply();
		}, { passive: false });

		fit();
	}
</script>
</body>
</html>`;
	}
}
