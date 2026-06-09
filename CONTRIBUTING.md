# Contributing to Lume

Thanks for your interest. Lume is a focused fork of VS Code — we add an **AI trust/visibility layer** and deliberately keep scope tight. Read this before opening a PR.

## What belongs in Lume

One filter: **does this make the AI's work more visible or trustworthy?** (live diff, change triage, plan/reasoning, checkpoints, live preview.) General editor features and code-writing improvements belong upstream in VS Code, not here.

## Setup

```bash
npm install
npm run watch      # compile + watch
./scripts/code.sh  # launch the dev build
```

Node version is pinned in [`.nvmrc`](.nvmrc).

## Before you push

```bash
npm run compile            # must pass
npm run test-node          # unit tests
npm run eslint             # lint
npm run valid-layers-check # layer boundaries
```

## House rules

- **Conventions live in [CLAUDE.md](CLAUDE.md)** — read it. Surgical changes, simplicity first, match existing style.
- **Fork discipline.** Prefer additive `workbench/contrib/<feature>/` modules + DI services over editing upstream files. When you must edit upstream, keep the diff minimal so `git merge upstream/main` stays clean. Never reformat or rename in upstream files.
- **Licensing.** New files get an Apache-2.0 header. Don't relicense VS Code-derived (MIT) files. See [`NOTICE`](NOTICE).

## Issues

We track work as GitHub issues. Triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. A `ready-for-agent` issue is fully specified — an agent (or you) can pick it up with no extra context.
