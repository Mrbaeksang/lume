#!/usr/bin/env bash
# Launch the slimmed Lume dev build with the correct toolchain.
#   ./lume-dev.sh [folder|args...]
set -euo pipefail
cd "$(dirname "$0")"

# Build/run needs Node major 24 (see .nvmrc). Prefer a brew node@24 if present.
if [ -x /opt/homebrew/opt/node@24/bin/node ]; then
	export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
fi

# Authenticated downloads avoid GitHub rate-limit (403) on built-in extensions.
if command -v gh >/dev/null 2>&1; then
	export GITHUB_TOKEN="${GITHUB_TOKEN:-$(gh auth token 2>/dev/null || true)}"
fi

# Slim: drop the bundled chat/agent and Microsoft/GitHub sign-in extensions.
exec ./scripts/code.sh \
	--disable-extension GitHub.copilot-chat \
	--disable-extension vscode.microsoft-authentication \
	--disable-extension vscode.github-authentication \
	"$@"
