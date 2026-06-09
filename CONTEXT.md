# Lume

A transparent code editor (a VS Code fork) that shows what an Agent changed in the workspace, so the changes can be reviewed and trusted before they are kept. Lume contains no AI of its own and is agnostic to which Agent edits the code.

## Language

**Agent**:
An external, third-party tool that edits files in the workspace (e.g. Claude Code, Codex). Lume bundles none and integrates with none specifically — it is agnostic to which one is used.
_Avoid_: AI, assistant, copilot, bot

**External edit**:
A change to a workspace file produced by an Agent — written from outside Lume's editor — as opposed to one the user types directly in Lume. Lume identifies it by origin: any change that arrives from the filesystem rather than through Lume's editor (excluding ignored paths) is treated as an External edit.
_Avoid_: AI edit, AI change

**Baseline**:
The version of a file that External edits are shown against — the last state the user accepted, or the file's content just before the Agent first touched it. Git-independent and persisted per file.
_Avoid_: HEAD, original, base version

**Review**:
Seeing an External edit against its Baseline and deciding to keep it (accept — the Baseline advances to the new content) or undo it (the file reverts to its Baseline).
_Avoid_: approve, diff
