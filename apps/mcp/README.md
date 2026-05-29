# @yacad/mcp

Stdio MCP server that holds an authoritative yacad `DocSession`, exposes 25 tools for editing it (full mutations + Lua authoring + export + server control), and serves a freshly-built studio2 viewer over HTTP+WS at `http://localhost:5179/?backend=remote&ws=ws://localhost:5179/ws` (default port).

## Install (Claude Code)

Copy `.mcp.json.example` to your project's `.mcp.json`, replace the absolute path, and restart Claude Code.

## Flags

| Flag | Default | Effect |
|---|---|---|
| `--port N` | `5179` | HTTP+WS port |
| `--host HOST` | `127.0.0.1` | Bind address. Anything other than `127.0.0.1` / `localhost` / `::1` turns on access-token enforcement: HTTP requests and WS upgrades require `?token=...` matching the random token generated at startup. The token is printed to stderr on launch; `getViewerUrl` returns the URL with the token baked in. `rotateAccessToken` generates a new one and disconnects existing viewers. |
| `--library-dir PATH` | `./.yacad-mcp/vfs` | Where docs are persisted on disk |
| `--no-viewer` | off | Skip HTTP+WS; runs headless. `run.sh` also skips the studio2 rebuild in this mode |

## Persistence

Per-project. Docs persist under `<cwd>/.yacad-mcp/vfs/`. Consider gitignoring it for working scenes, committing for shared samples.

## Spec

See `docs/superpowers/specs/2026-05-29-yacad-mcp-design.md`.
