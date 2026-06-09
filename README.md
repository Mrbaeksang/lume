<div align="center">

# Lume

### See what your AI actually changed — before you trust it.

A transparent, AI-native code editor. Built on VS Code.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE.txt)
![Status](https://img.shields.io/badge/status-early%20WIP-orange.svg)
![Based on VS Code](https://img.shields.io/badge/based%20on-Code%20--%20OSS-007ACC.svg)

</div>

---

## Why Lume

AI writes most of the code now. The bottleneck moved from *writing* to *trusting*.

92% of developers code with AI — and nearly half don't trust what it ships ([Fortune, 2026](https://fortune.com/2026/04/02/in-the-age-of-vibe-coding-trust-is-the-real-bottleneck/)). Your job quietly turned from author into reviewer, but your editor never caught up: it still drops a 1,000-line diff on you and wishes you luck.

**Lume is the editor for that job.** It doesn't try to write code better than Cursor or Copilot — it makes what the AI did *legible*: **what** changed, **why**, and **how to undo it** — in real time, before anything is committed.

## The idea

- **Live AI diff** — every edit the AI makes, shown inline and labeled, *before* commit. No git ceremony.
- **Change triage** — a 1,000-line diff organized by impact, instead of dumped on you.
- **Plan & reasoning** — see the AI's plan *before* it runs, not after it breaks.
- **Checkpoints** — a step-by-step time machine. Undo one bad change without untangling forty.
- **Live preview** — watch the thing you're building, not just the code.

We're shipping these one at a time, sharp. First up: **live AI diff**.

> **Status: day one.** This is a public fork of VS Code being reshaped into the above. Star to follow along — the interesting parts are still being built.

## Built on VS Code

Lume is a downstream fork of [Code - OSS](https://github.com/microsoft/vscode) (MIT) — the open-source core of VS Code, the same foundation Cursor and Windsurf build on. We track upstream so the editor stays current while we add the trust layer on top.

## Development

```bash
npm install
npm run watch      # compile + watch
./scripts/code.sh  # launch the dev build
```

Node version is pinned in [`.nvmrc`](.nvmrc).

## License

Licensed under the [MIT License](LICENSE.txt).

Lume is **not affiliated with or endorsed by Microsoft**. "Visual Studio Code" and the VS Code logo are trademarks of Microsoft; Lume ships under its own branding and uses [Open VSX](https://open-vsx.org) for extensions.

---

<div align="center">
Standing on the shoulders of <a href="https://github.com/microsoft/vscode">VS Code</a>. 💙
</div>
