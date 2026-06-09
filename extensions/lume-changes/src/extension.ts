// Copyright 2026 The Lume Authors
// SPDX-License-Identifier: Apache-2.0

import * as vscode from 'vscode';

/**
 * Slice 0: activate the extension and register an (empty) "AI Changes" view.
 * Detecting External edits and populating this list lands in slice 1.
 */
class ChangesProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
	private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
	readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

	getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
		return element;
	}

	getChildren(): vscode.TreeItem[] {
		// No External edits tracked yet — slice 1 populates this.
		return [];
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}
}

export function activate(context: vscode.ExtensionContext): void {
	const provider = new ChangesProvider();
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider('lume.changes', provider),
		vscode.commands.registerCommand('lume.refresh', () => provider.refresh()),
	);
}

export function deactivate(): void {}
