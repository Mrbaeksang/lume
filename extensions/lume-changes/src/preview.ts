// Copyright 2026 The Lume Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';

/**
 * Feature #1: live preview — watch the thing you're building, beside the code.
 * Embeds a dev-server URL in a webview and reloads it when you save.
 */
export class LivePreview {
	private panel?: vscode.WebviewPanel;
	private url = '';

	async open(): Promise<void> {
		const fallback = vscode.workspace.getConfiguration('lume').get<string>('preview.url', 'http://localhost:3000');
		const url = await vscode.window.showInputBox({
			prompt: 'Live preview URL (your dev server)',
			value: this.url || fallback,
		});
		if (!url) { return; }
		this.url = url.trim();

		if (!this.panel) {
			this.panel = vscode.window.createWebviewPanel(
				'lumePreview',
				'Live Preview',
				vscode.ViewColumn.Beside,
				{ enableScripts: true, retainContextWhenHidden: true },
			);
			this.panel.onDidDispose(() => { this.panel = undefined; });
		}
		this.panel.title = `Live Preview — ${this.url}`;
		this.panel.webview.html = this.html(this.url);
		this.panel.reveal(vscode.ViewColumn.Beside);
	}

	reload(): void {
		this.panel?.webview.postMessage({ type: 'reload' });
	}

	private html(url: string): string {
		const safe = url.replace(/"/g, '&quot;');
		return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-src http: https:;" />
<style>html,body{margin:0;padding:0;height:100vh;overflow:hidden;background:#fff}iframe{border:0;width:100%;height:100vh}</style>
</head>
<body>
<iframe id="frame" src="${safe}"></iframe>
<script>
	const frame = document.getElementById('frame');
	window.addEventListener('message', (e) => {
		if (e.data && e.data.type === 'reload') { frame.src = frame.src; }
	});
</script>
</body>
</html>`;
	}
}
