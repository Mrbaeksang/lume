---
status: accepted
---

# Lume has no built-in AI and is Agent-agnostic

Lume ships no LLM, agent, or AI features of its own; it observes edits made by any external Agent (Claude Code, Codex, …) and makes them reviewable before they are kept. We chose observation over integration so Lume stays a small, focused trust layer instead of competing with agent vendors — accepting that we give up token-by-token streaming, which would require controlling the model's output stream.

## Considered Options

- **Built-in agent** (Void's path) — enables live, token-by-token streaming diffs, but means building and maintaining an AI provider. Large scope; Void carried this weight and was later deprecated.
- **Agent-agnostic observation** (chosen) — no AI to build, works with whatever Agent the user already runs, and aligns with the thesis: make the AI's work *visible*, not *better*.

## Consequences

- Lume detects External edits by watching the filesystem, not through any agent API.
- The MVP shows edits *after* the Agent writes them (post-hoc), not as they stream.
- Concurrent human + Agent editing of the same open file is out of scope for the MVP (the user runs the Agent, then reviews).
