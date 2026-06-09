// Copyright 2026 The Lume Authors
// SPDX-License-Identifier: Apache-2.0

/**
 * Aligned hunks between Baseline (`a`) and current (`b`), so a single changed region
 * can be kept or undone on its own. `aStart..aEnd` index Baseline lines, `bStart..bEnd`
 * index current lines (half-open ranges; an empty range = pure insertion/deletion).
 */
export interface Hunk {
	aStart: number;
	aEnd: number;
	bStart: number;
	bEnd: number;
}

const MAX_DIFF_CELLS = 4_000_000;

function lines(text: string): string[] {
	return text.length ? text.split('\n') : [];
}

export function computeHunks(before: string, after: string): Hunk[] {
	const a = lines(before);
	const b = lines(after);
	const n = a.length;
	const m = b.length;
	if (n * m > MAX_DIFF_CELLS) {
		return n || m ? [{ aStart: 0, aEnd: n, bStart: 0, bEnd: m }] : [];
	}
	const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}

	const hunks: Hunk[] = [];
	let i = 0;
	let j = 0;
	let h: Hunk | null = null;
	const flush = () => { if (h) { hunks.push(h); h = null; } };
	const startHunk = () => { if (!h) { h = { aStart: i, aEnd: i, bStart: j, bEnd: j }; } };

	while (i < n && j < m) {
		if (a[i] === b[j]) {
			flush();
			i++; j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			startHunk(); i++; h!.aEnd = i;
		} else {
			startHunk(); j++; h!.bEnd = j;
		}
	}
	while (i < n) { startHunk(); i++; h!.aEnd = i; }
	while (j < m) { startHunk(); j++; h!.bEnd = j; }
	flush();
	return hunks;
}

/** Replace lines [start, end) of `text` with `replacement`, with bounds guards. */
export function spliceLines(text: string, start: number, end: number, replacement: string[]): string {
	const ls = lines(text);
	const safeStart = Math.max(0, Math.min(start, ls.length));
	const safeEnd = Math.max(safeStart, Math.min(end, ls.length));
	ls.splice(safeStart, safeEnd - safeStart, ...replacement);
	return ls.join('\n');
}

export function sliceLines(text: string, start: number, end: number): string[] {
	return lines(text).slice(start, end);
}
