---
status: accepted
---

# Apache-2.0 for Lume, MIT preserved for VS Code-derived code

Lume is a fork of VS Code (MIT). We license Lume's own code under Apache-2.0 for its explicit patent grant and trademark clause — protections that matter once a company stands behind the product — while preserving VS Code's original MIT license in `LICENSE-VS-Code.txt` for the inherited code. Void, our closest reference fork, made the same choice.

## Considered Options

- **MIT** — simplest, matches VS Code upstream, but no patent grant.
- **Apache-2.0** (chosen) — patent grant + trademark protection, at the cost of a dual-license layout (`LICENSE.txt` Apache, `LICENSE-VS-Code.txt` MIT, `NOTICE`).

## Consequences

- New source files carry an Apache-2.0 header; VS Code-derived files keep their MIT headers.
- A `NOTICE` file ships with every distribution.
