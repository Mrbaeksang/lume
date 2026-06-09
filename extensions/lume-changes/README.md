# Lume — AI Changes

The MVP of [Lume](../../README.md): see what an AI agent changed in your workspace, and review it before you keep it.

Agent-agnostic — it watches the filesystem, so it works with whatever edits your code (Claude Code, Codex, Aider, …). No AI is bundled. See `../../docs/adr/0002-no-builtin-ai-agent-agnostic.md` and `0003-mvp-as-extension.md`.

## Develop

```bash
cd extensions/lume-changes
npm install
npm run compile     # or: npm run watch
```

Then open this folder in VS Code and press **F5** to launch the Extension Development Host. The **Lume** icon appears in the activity bar with an "AI Changes" view.

## Status

Slice 0 — scaffold + empty panel. Detection, diff, and accept/undo land in the following slices.
