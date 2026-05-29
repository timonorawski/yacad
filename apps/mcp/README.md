# @yacad/mcp

Stdio MCP server that holds an authoritative yacad `DocSession`, exposes tools for editing it (full mutations + Lua authoring + export + server control), and serves a freshly-built studio2 viewer over HTTP+WS. The server binary defaults to `http://localhost:5179/?backend=remote&ws=ws://localhost:5179/ws`; the local convenience `run.sh` wrapper defaults to an auto-discovered port and attempts to open the viewer in a browser.

## Install (Claude Code)

Copy `.mcp.json.example` to your project's `.mcp.json`, replace the absolute path, and restart Claude Code.

## Flags

| Flag                 | Default            | Effect                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--port N`           | `5179`             | HTTP+WS port. Use `--port auto` to let the OS assign a free ephemeral port; `getViewerUrl` and stderr logging report the discovered URL.                                                                                                                                                                                                                                              |
| `--host HOST`        | `127.0.0.1`        | Bind address. Anything other than `127.0.0.1` / `localhost` / `::1` turns on access-token enforcement: HTTP requests and WS upgrades require `?token=...` matching the random token generated at startup. The token is printed to stderr on launch; `getViewerUrl` returns the URL with the token baked in. `rotateAccessToken` generates a new one and disconnects existing viewers. |
| `--library-dir PATH` | `./.yacad-mcp/vfs` | Where docs are persisted on disk                                                                                                                                                                                                                                                                                                                                                      |
| `--no-viewer`        | off                | Skip HTTP+WS; runs headless. `run.sh` also skips the studio2 rebuild in this mode                                                                                                                                                                                                                                                                                                     |
| `--open-viewer`      | off                | After the viewer starts, make a best-effort attempt to open the viewer URL in the default browser. Failures are logged to stderr and never fail MCP startup.                                                                                                                                                                                                                          |

## `run.sh` local defaults

`apps/mcp/run.sh` is for local development convenience. It rebuilds the MCP server, rebuilds studio2 unless headless, and adds these defaults when the caller has not supplied an override:

- `--port auto`
- `--open-viewer`

Pass `--port N`, `--open-viewer`, or `--no-viewer` explicitly to override the wrapper defaults.

Startup build output is written to `./.yacad-mcp/logs/startup-build.log` (or `YACAD_MCP_LOG_DIR/startup-build.log`) so stdout remains reserved for the stdio MCP transport.

## Persistence

Per-project. Docs persist under `<cwd>/.yacad-mcp/vfs/`. Consider gitignoring it for working scenes, committing for shared samples.

## Spec

See `docs/superpowers/specs/2026-05-29-yacad-mcp-design.md`.
