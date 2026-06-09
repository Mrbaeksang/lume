# Lume

Transparent, AI-native code editor — a downstream fork of VS Code (Code - OSS). Lume's job is to make AI code changes **legible** (what changed, why, how to undo), not to write code better. See @README.md for the product pitch.

## North Star

Every feature must answer: **"does this make the AI's work more visible/trustworthy?"** If not, it doesn't belong in Lume. We do not add general IDE features or improve code-writing — VS Code already does that.

Ship **one feature at a time, sharp.** Current MVP: **live AI diff** (inline, labeled, pre-commit) via `diffEditorWidget` + in-memory `TextModel` (no git dependency).

## Tech Stack

- **Language**: TypeScript (strict), some Node + browser layers
- **Runtime**: Electron (desktop) + web workbench
- **Build**: gulp + esbuild/tsgo, npm scripts. Node version pinned in @.nvmrc

## Project Structure

```
src/vs/base        — utilities, no dependencies on other layers
src/vs/platform    — services (DI), cross-cutting
src/vs/editor      — Monaco editor core (incl. diffEditor)
src/vs/workbench   — the IDE shell: parts, contrib/*, services
src/vs/code        — Electron main/host
extensions/        — bundled extensions
```

Layering is enforced (`base ← platform ← editor ← workbench`). Don't import "downward → upward".

## Commands

```bash
npm install                # deps (first run is slow)
npm run watch              # compile client + extensions, watch mode
./scripts/code.sh          # launch the dev build
npm run compile            # one-shot compile
npm run test-node          # unit tests (node)
npm run eslint             # lint
npm run hygiene            # license headers + formatting check
npm run valid-layers-check # enforce layer boundaries
```

## How we work (Karpathy guidelines)

**1. Think before coding.** State assumptions explicitly. If the request has multiple readings, surface them — don't pick silently. If a simpler path exists, say so. If unclear, stop and ask.

**2. Simplicity first.** Minimum code that solves the problem. No speculative abstractions, no config/flexibility that wasn't asked for, no error handling for impossible cases. If 200 lines could be 50, rewrite.

**3. Surgical changes.** Touch only what the task needs. Match VS Code's existing style even if you'd do it differently. Don't refactor, reformat, or "improve" adjacent code. Remove only the orphans *your* change created — never pre-existing dead code (mention it instead).

**4. Goal-driven.** Turn tasks into verifiable goals before coding: "fix bug" → "write a test that reproduces it, then make it pass." Loop until the check is green.

## Fork discipline (keep upstream merges clean)

- **Prefer additive over invasive.** New behavior → a new `workbench/contrib/<feature>/` module + a DI service, registered via the contribution model. Avoid editing upstream files when a contrib/service can do it.
- **When you must edit an upstream file**, keep the diff minimal and localized — small edits survive `git merge upstream/main`; rewrites cause conflict hell.
- **Never reformat or rename in upstream files** as a side effect.
- Lume-owned code lives under clearly-named `contrib/` modules so it's obvious what's ours vs upstream's.

## Git

- `origin` = `Mrbaeksang/lume`, `upstream` = `microsoft/vscode`. Default branch `main`.
- Sync upstream: `git fetch upstream && git merge upstream/main`.
- The ECC pre-commit hook flags upstream **test fixtures** as secrets (e.g. `secretFilter.spec.ts`). `--no-verify` is acceptable **only** when committing untouched upstream code; **never** bypass it for Lume code.
- License: Lume code = Apache-2.0 (`LICENSE.txt`); VS Code-derived code = MIT (`LICENSE-VS-Code.txt`); see `NOTICE` and `docs/adr/0001-apache-2-license.md`. New files get an Apache-2.0 header; don't relicense upstream MIT headers. No Microsoft branding/marketplace — use [Open VSX](https://open-vsx.org).

## Agent skills config

- @docs/agents/issue-tracker.md — issues live on GitHub (`gh` CLI)
- @docs/agents/triage-labels.md — triage label vocabulary
- @docs/agents/domain.md — domain docs layout (single-context)

## Deep references (read on demand, large)

- `.github/copilot-instructions.md` — upstream VS Code architecture & coding guide
