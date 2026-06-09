// Copyright 2026 The Lume Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';
import * as net from 'net';

/** Common dev-server ports, in rough order of likelihood. */
const DEV_PORTS = [3000, 5173, 8080, 4200, 8000, 5000, 3001, 4321, 1313, 9000];

function portOpen(port: number, timeout = 300): Promise<boolean> {
	return new Promise(resolve => {
		const socket = new net.Socket();
		const done = (open: boolean) => { socket.destroy(); resolve(open); };
		socket.setTimeout(timeout);
		socket.once('connect', () => done(true));
		socket.once('timeout', () => done(false));
		socket.once('error', () => done(false));
		socket.connect(port, '127.0.0.1');
	});
}

/** Probe common ports and return the first localhost URL that answers. */
async function detectDevServer(): Promise<string | undefined> {
	const results = await Promise.all(DEV_PORTS.map(async p => ((await portOpen(p)) ? p : 0)));
	const open = results.find(p => p > 0);
	return open ? `http://localhost:${open}` : undefined;
}

/**
 * Feature #1: live preview — watch the thing you're building, beside the code.
 * Embeds a dev-server URL in a webview and reloads it when you save.
 */
export class LivePreview {
	private panel?: vscode.WebviewPanel;
	private url = '';

	async open(): Promise<void> {
		const configured = vscode.workspace.getConfiguration('lume').get<string>('preview.url', 'http://localhost:3000');
		const detected = this.url ? undefined : await detectDevServer();
		const input = await vscode.window.showInputBox({
			prompt: 'Live preview URL (your dev server)',
			value: this.url || detected || configured,
		});
		if (input === undefined) { return; }

		// Validate: only http/https. The default can come from workspace settings,
		// which are untrusted, so never interpolate it into HTML unchecked.
		let parsed: URL;
		try {
			parsed = new URL(input.trim());
		} catch {
			vscode.window.showErrorMessage('Lume: invalid preview URL.');
			return;
		}
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
			vscode.window.showErrorMessage('Lume: preview URL must start with http:// or https://');
			return;
		}
		this.url = parsed.toString();

		if (!this.panel) {
			this.panel = vscode.window.createWebviewPanel(
				'lumePreview',
				'Live Preview',
				vscode.ViewColumn.Beside,
				{ enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] },
			);
			this.panel.onDidDispose(() => { this.panel = undefined; });
		}
		this.panel.title = `Live Preview — ${parsed.host}`;
		this.panel.webview.html = this.html(parsed);
		this.panel.reveal(vscode.ViewColumn.Beside);
	}

	reload(): void {
		this.panel?.webview.postMessage({ type: 'reload' });
	}

	private html(url: URL): string {
		// Inject the URL as a JS string literal (not an HTML attribute); escape `<`
		// so it can't break out of the <script> element.
		const urlLiteral = JSON.stringify(url.toString()).replace(/</g, '\\u003c');
		return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-src ${url.origin};" />
<style>html,body{margin:0;padding:0;height:100vh;overflow:hidden;background:#fff}iframe{border:0;width:100%;height:100vh}</style>
</head>
<body>
<iframe id="frame"></iframe>
<script>
	const frame = document.getElementById('frame');
	frame.src = ${urlLiteral};
	window.addEventListener('message', (e) => {
		if (e.data && e.data.type === 'reload') { frame.src = frame.src; }
	});
</script>
</body>
</html>`;
	}
}
