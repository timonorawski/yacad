#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
cd "$ROOT"
LOG_DIR="${YACAD_MCP_LOG_DIR:-$ROOT/.yacad-mcp/logs}"
BUILD_LOG="$LOG_DIR/startup-build.log"
mkdir -p "$LOG_DIR"
: > "$BUILD_LOG"
run_startup_build() {
  local LABEL="$1"
  shift
  printf '==> %s\n' "$LABEL" >> "$BUILD_LOG"
  if ! "$@" >> "$BUILD_LOG" 2>&1; then
    printf 'yacad-mcp startup build failed: %s (see %s)\n' "$LABEL" "$BUILD_LOG" >&2
    exit 1
  fi
}
# Always (re)build the MCP server so source edits land without a manual step.
run_startup_build "@yacad/mcp build" pnpm --filter @yacad/mcp build
# Rebuild studio2 so the viewer reflects current source, unless headless.
if [[ "${YACAD_MCP_NO_VIEWER:-}" != "1" && "$*" != *"--no-viewer"* ]]; then
  run_startup_build "@yacad/studio2 build" pnpm --filter @yacad/studio2 build
fi
HAS_PORT=0
HAS_OPEN_VIEWER=0
HAS_NO_VIEWER=0
for ARG in "$@"; do
  case "$ARG" in
    --port | --port=*) HAS_PORT=1 ;;
    --open-viewer) HAS_OPEN_VIEWER=1 ;;
    --no-viewer) HAS_NO_VIEWER=1 ;;
  esac
done
if [[ "$HAS_PORT" == "0" ]]; then
  set -- --port auto "$@"
fi
if [[ "$HAS_OPEN_VIEWER" == "0" && "$HAS_NO_VIEWER" == "0" && "${YACAD_MCP_NO_VIEWER:-}" != "1" ]]; then
  set -- "$@" --open-viewer
fi
exec node "$HERE/dist/main.js" "$@"
