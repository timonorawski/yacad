#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT"
# Rebuild studio2 so the viewer reflects current source, unless headless.
if [[ "${YACAD_MCP_NO_VIEWER:-}" != "1" && "$*" != *"--no-viewer"* ]]; then
  pnpm --filter @yacad/studio2 build
fi
exec node "$HERE/dist/server.js" "$@"
