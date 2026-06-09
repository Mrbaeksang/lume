---
status: accepted
---

# The MVP ships as a VS Code extension, not core fork changes

Everything the MVP needs — detecting External edits, swapping the diff reference via `QuickDiffProvider`, a changes panel, the diff editor, and file-level accept/undo — is reachable through the VS Code extension API. We build the MVP as an extension (in `extensions/lume-changes/`) so it ships in days and runs in stock VS Code / Cursor for fast validation, instead of gating the first release on building the full fork.

## Consequences

- The MVP runs in any VS Code-family editor, so we can publish to Open VSX and gather users before the fork is product-ready.
- Core behaviors the extension API can't override (e.g. silent auto-reload when a file changes on disk) are deferred to the fork; they aren't needed for the MVP.
- The extension is developed inside the fork repo and travels with it; the fork remains the long-term home for branding, distribution, and core-level changes.
