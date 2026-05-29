# yacad MCP server — design spec

**Status:** approved through brainstorming. Implementation plan pending.

## Goal

Expose yacad's authoring stack to Claude (and other MCP clients) as a stdio MCP server. The agent edits real `DocSession`s through the full validation pipeline; a connected browser studio2 instance acts as a read-only viewer over the agent's current state.

A secondary, deliberate goal: use this surface as a **stress test for the validation stack**. Lua authoring tools are exposed in v1 so we can discover where an agent can introduce nondeterminism and tighten validation in response.

## Architecture

One Node process registered in `.mcp.json`, launched by a `run.sh` wrapper that runs `pnpm --filter @yacad/studio2 build` first so the served viewer is always current with the studio2 source. The MCP holds **all** authoritative state — the agent's tools mutate a Node-side `DocLibrary`, an embedded `Engine + ManifoldKernel + WasmoonLuaRuntime + WasmoonWarpEvaluator` evaluates geometry, and an HTTP+WS server (same process) serves the freshly-built studio2 dist plus a WS endpoint for live state.

Studio2 in the browser runs as today — its own kernel in a worker for fast viewport rendering — but reads doc state from the MCP via a new `RemoteVfs` backend instead of IndexedDB. v1 viewer is read-only; bidirectional editing and selection-state back-channel are explicitly out of scope.

```
┌─────────────────────────────────────────┐                ┌─────────────────────┐
│  apps/mcp (Node)                        │                │  studio2 (browser)  │
│                                         │                │                     │
│  ┌─────────────────────────────────┐    │                │  ┌───────────────┐  │
│  │ MCP tools (stdio)               │    │  HTTP (dist)   │  │ App.svelte    │  │
│  │ ┌──────────────────────────┐    │◄───┼────────────────┤  │ + viewerMode  │  │
│  │ │ DocLibrary               │    │                    │  │               │  │
│  │ │   ↓                      │    │  WS (RemoteVfs +   │  │ RemoteVfs     │  │
│  │ │ FilesystemVfs            │    │      doc-changed)  │  │   ↓           │  │
│  │ └──────────────────────────┘    │◄═══┼═══════════════►│  │ DocLibrary    │  │
│  │                                 │                    │  │   ↓           │  │
│  │ ┌──────────────────────────┐    │                    │  │ Worker        │  │
│  │ │ Engine + Manifold + Lua  │    │                    │  │ (own kernel)  │  │
│  │ └──────────────────────────┘    │                    │  └───────────────┘  │
│  └─────────────────────────────────┘    │                │                     │
└─────────────────────────────────────────┘                └─────────────────────┘
```

## Components

Three new workspace packages, one new app, one studio2 refactor.

### `@yacad/vfs-fs` (new)

`FilesystemVfs` — implements the existing `Vfs` interface from `@yacad/vfs` against Node `fs.promises`. Same path layout as `IndexedDbVfs` (`/docs/{id}/meta.json`, `/docs/{id}/document.json`, `/docs/{id}/blobs/{hash}.bin`) so `DocLibrary` is unchanged. Constructor takes a root directory; default `./.yacad-mcp/vfs/`. Atomic writes via write-temp-then-rename.

### `@yacad/remote-vfs` (new)

Two halves of a small WS-RPC protocol over which one process serves a `Vfs` to another:

- `RemoteVfs` (browser-side, implements `Vfs`): every method (`read/write/list/delete`) becomes a JSON-RPC request over a single WebSocket. Auto-reconnects with exponential backoff; on reconnect, replays any pending requests.
- `RemoteVfsServer` (Node-side): wraps any `Vfs` (in practice, `FilesystemVfs`) and serves it. Rejects writes from clients flagged `viewer` with `viewer-read-only` (v1 viewer is read-only — flipping that flag is what enables future bidirectional editing without a protocol change).

The same WS endpoint also broadcasts `doc-changed` / `current-doc-changed` / `library-changed` events.

### `apps/mcp/` (new)

The Node executable. Wires together:

- `FilesystemVfs(libraryDir) → DocLibrary → DocSession`
- `Engine + ManifoldKernel + WasmoonLuaRuntime + WasmoonWarpEvaluator` (same composition the worker uses today)
- `validateLuaSource` for Lua-authoring tools
- MCP SDK over stdio for tool dispatch
- HTTP server serving `apps/studio2/dist/` at `/`
- WS endpoint at `/ws` mounting `RemoteVfsServer` + the doc-change broadcaster

Flags:

- `--port N` (default `5179`)
- `--host HOST` (default `127.0.0.1`) — bind address for the HTTP+WS server. When the host is anything other than `127.0.0.1` / `localhost` / `::1`, the server generates a random access token at startup and requires it on every HTTP request and WS upgrade (query param `?token=...`). Localhost-only mode never requires a token.
- `--library-dir PATH` (default `./.yacad-mcp/vfs`)
- `--no-viewer` — skip HTTP+WS entirely; MCP runs headless (no port bound, viewer build not required for startup — `run.sh` should respect this if invoked accordingly)

Prints the viewer URL to stderr on start so Claude can show it to the user.

### `apps/mcp/run.sh` (new)

```bash
#!/usr/bin/env bash
set -euo pipefail
# Rebuild studio2 so the served viewer reflects the current source.
# Skip when MCP is being launched headless.
if [[ "${YACAD_MCP_NO_VIEWER:-}" != "1" ]]; then
  pnpm --filter @yacad/studio2 build
fi
exec node "$(dirname "$0")/dist/server.js" "$@"
```

This is what `.mcp.json` invokes. Every MCP restart rebuilds the viewer — resolves the "studio2 iteration" concern from Approach 1.

### `apps/studio2` (modified)

The only studio2 change: backend selection at startup. Today's `main.ts` constructs `new IndexedDbVfs()` unconditionally. After the refactor:

- Default (no URL params, no build flag): `IndexedDbVfs` — today's behavior, normal `pnpm dev` works as before.
- `?backend=remote&ws=<url>`: construct `new RemoteVfs(url)` instead. Library is the MCP's, not local.
- A `viewerMode` reactive flag (set from the same query param) hides editing affordances: tool palette, +child / wrap-with controls, inspector fields become read-only. Tree, viewport, perf panel, export gadget all remain (read operations are fine).

## Tool surface (v1)

All tools return `{ ok: true, data }` on success or `{ ok: false, error: { code, message, details? } }` on failure. Validation failures include `details.issues` (Lua) or `details.path` (DAG) so the agent has structured feedback to recover from.

### Library (5)

- `listDocs()` → `[{ id, name }]`
- `createDoc(name, initialDoc?)` → `{ id }` — creates the doc, opens its session in the MCP, and sets it as current focus
- `openDoc(id)` → `{ id, name, doc, blobs: [{ hash, base64 }] }` — opens the session in the MCP (if not already open) and sets it as current focus
- `deleteDoc(id)` → `{ ok }`
- `setCurrentDoc(id)` — switches viewer focus to an already-open session without re-fetching. Subsequent mutation tools target this doc. The agent can hold multiple sessions open via `openDoc`; `setCurrentDoc` cheaply moves between them

### Read (3)

- `getDoc()` → current doc `NodeDoc` tree
- `getNodeAt(path)` → `{ type, params, childCount, outputType }`
- `evaluate({ tier?, includePerNode? })` → `{ bbox, triangleCount, stats: { hits, misses, totalMs, lookupMs, kernelMs }, perNode? }` — `includePerNode` defaults false to keep result size manageable

### Mutate (8)

`addChild(parentPath, nodeDoc, insertAt?)`, `wrapWith(path, type, params?)`, `unwrap(path)`, `removeAt(path)`, `moveChild(srcPath, destParentPath, destIndex)`, `replaceAt(path, newDoc)`, `setParam(path, key, value)`, `setParams(path, patch)`.

Each calls the corresponding `@yacad/mutations` function inside `session.mutate(...)`, so buildGraph validation runs on every change.

### Lua authoring (2)

- `addLuaDefinition({ schema, code })` → `{ hash }` — runs `validateLuaSource` first; on failure returns `{ ok: false, error: { code: 'lua-validation', details: { issues } } }` without registering
- `validateLuaCode({ schema, code })` → `{ issues: [] }` — dry-run validation, never registers

### Export (4)

- `exportStl(path?)` → `{ filename, base64 }` (3D)
- `exportSvg(path?)` → `{ filename, base64 }` (2D)
- `exportDxf(path?)` → `{ filename, base64 }` (2D)
- `exportPng(path?, opts?)` → `{ filename, base64 }` (2D)

Path defaults to `'$'` (root). Mismatched output type → `wrong-geometry-kind` error.

### Cache (1)

- `clearCache()` — drops L1 (and L2 if/when added); next eval is all misses. Lets the agent demonstrate cache-vs-rebuild timings.

### Server (2)

- `getViewerUrl()` → `{ url }` — current viewer URL including the access token when one is in force. The agent calls this when it wants to show the user where to look. Returns `no-viewer` error if `--no-viewer`.
- `rotateAccessToken()` → `{ url, token }` — generates a new random access token, invalidates the old one, drops every connected WS so viewers reconnect with the new URL. Returns `not-applicable` when the server is bound to localhost-only (no token mode).

**Total: 25 tools.**

## Data flow

### Tool: mutation (representative)

1. Claude calls `addChild(parentPath, nodeDoc)` over stdio.
2. MCP handler runs `session.mutate(prev => addChild(prev, parentPath, nodeDoc))`.
3. `session.mutate` calls `buildGraph` on the result; on failure throws `DagError` → handler returns structured error.
4. On success, the doc-store writes through `FilesystemVfs` (autosave path).
5. Handler broadcasts `{ kind: 'doc-changed', docId, doc, addedBlobs: [] }` to all WS subscribers focused on `docId`.
6. Viewer's `RemoteVfs`/`RemoteDocLibrary` translates the event into a `SessionState` update; Svelte re-renders tree + inspector; viewport re-evaluates locally.
7. Tool returns `{ ok: true, data: { /* maybe the new path */ } }` to Claude.

### Tool: `evaluate`

1. Claude calls `evaluate({ includePerNode: false })`.
2. MCP runs its Node `Engine.evaluate(currentDoc)` — same Engine/Kernel as the worker.
3. Result is summarized (bbox + triangleCount + stats) and returned. PerNode rows omitted by default to keep agent context small.
4. The MCP-side `MemoryStore` populates on this call; subsequent evals after small edits hit the cache.

### Tool: Lua authoring

1. Claude calls `addLuaDefinition({ schema, code })`.
2. MCP runs `validateLuaSource(def)`; on `LuaValidationError`, returns issues without registering.
3. On success, computes content hash, adds the canonical bytes to the current session's blob set (which writes through to FS), returns the hash so the agent can reference it from a `lua` node.

### Viewer connect/reconnect

1. Browser loads from the MCP's HTTP at `/`, with `?backend=remote&ws=ws://host:port/ws`.
2. Studio2's `main.ts` sees the param, constructs `new RemoteVfs(wsUrl)`.
3. `RemoteVfs` opens WS, sends `library.list()` + `library.openSession(currentId)`.
4. Server pushes `current-doc-changed` immediately so the viewer renders the current focus.
5. WS dies → exponential backoff reconnect → on reconnect, re-issue `library.openSession(currentId)` — no diff sync, small docs make full-state refresh cheap and simple.

## Persistence

`./.yacad-mcp/vfs/` mirrors the existing IndexedDB layout exactly. `DocLibrary` is unchanged — only the storage backend differs. Project-scoped (one library per cwd). `.gitignore` is the user's call.

The Node engine's cache is in-memory only for v1 (`MemoryStore` from `@yacad/cache`). Survives the MCP process lifetime; lost on restart. A filesystem-backed L2 is a possible follow-up if cache cold-start becomes painful, but the warm-MCP-process case (typical Claude session) doesn't need it.

## WebSocket protocol

JSON-RPC-style frames. Both directions allowed; v1 only routes server→client for mutations.

**Server → client events (broadcast):**

| Event                 | Payload                                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `current-doc-changed` | `{ id, meta, doc, blobs: [{ hash, base64 }] }` — fired on `setCurrentDoc` or initial connect                               |
| `doc-changed`         | `{ id, doc }` — tree mutation only                                                                                         |
| `blob-added`          | `{ id, hash, base64 }` — emitted when a blob (Lua def, imported mesh) is added to a session, decoupled from tree mutations |
| `meta-changed`        | `{ id, meta }`                                                                                                             |
| `library-changed`     | `{ docs: [{ id, name }] }`                                                                                                 |

Blob events are separate from `doc-changed` because adding a blob (via `addLuaDefinition` or mesh-import tools) doesn't necessarily mutate the doc tree, and conversely a tree mutation rarely needs to ship blobs. Keeping them split mirrors how `session.addBlob` and `session.mutate` work today.

**Client → server requests (RPC, correlated by `id`):**

| Method                    | Returns                                       |
| ------------------------- | --------------------------------------------- |
| `library.list()`          | `[{ id, name }]`                              |
| `library.openSession(id)` | `{ meta, doc, blobs[] }` (one-shot fetch)     |
| `vfs.read(key)`           | `bytes \| null`                               |
| `vfs.write(key, bytes)`   | `ok` — rejected with `viewer-read-only` in v1 |
| `vfs.list(prefix)`        | `keys[]`                                      |
| `vfs.delete(key)`         | `ok` — rejected with `viewer-read-only` in v1 |

In v1, `viewerMode` studio2 has its editing affordances hidden, so the `RemoteVfs` `write`/`delete` methods are never called in normal use. The protocol routes exist so future bidirectional editing slots in without a protocol change — just flipping a server-side flag.

## Error handling

Every tool body is wrapped in try/catch. Known errors map to stable codes:

| Source                                     | Code                                                |
| ------------------------------------------ | --------------------------------------------------- |
| `LuaValidationError`                       | `lua-validation` (with full `issues[]` in details)  |
| `DagError`                                 | `dag-validation` (with offending `path` in details) |
| Missing doc/blob                           | `not-found`                                         |
| Wrong geometry kind for export             | `wrong-geometry-kind`                               |
| Path doesn't resolve                       | `bad-path`                                          |
| Viewer attempts write in v1                | `viewer-read-only`                                  |
| Bad/missing token on non-localhost connect | HTTP 401 / WS close 4001                            |
| `getViewerUrl` when `--no-viewer`          | `no-viewer`                                         |
| `rotateAccessToken` on localhost-only      | `not-applicable`                                    |

WS disconnect doesn't fail tools — broadcasts to no subscribers are no-ops; eval and mutation work without a viewer connected. With `--no-viewer`, the broadcast channel is omitted entirely.

## Testing

- **`@yacad/vfs-fs`**: re-run the existing `Vfs` contract test suite against `FilesystemVfs(tmpdir)`. Round-trip read/write, list with prefix, delete idempotency, missing-key returns undefined.
- **`@yacad/remote-vfs`**: in-process pair test — stand up `RemoteVfsServer(MemoryVfs())` on a Node `ws` server, point a `RemoteVfs` at it, run the same Vfs contract suite. Plus a reconnect test (close socket mid-flight, assert pending request resolves after reconnect).
- **`apps/mcp` tool handlers**: each tool handler is a pure function of `(args, ctx) → Promise<result>`. Unit tests instantiate handlers with a `FilesystemVfs(tmpdir)` and call directly — no MCP transport simulation. Cover the happy path plus one validation-failure path per mutation-class tool.
- **e2e (Playwright)**: start `apps/mcp` on a random port, launch the viewer URL headlessly, call a mutation handler in-process, assert the viewer's tree updates within a timeout. One happy-path test for v1; broader e2e if/when the surface grows.
- **Lua validation stress**: this is the explicit secondary goal — once tools land, run agent-driven sessions whose explicit purpose is "try to introduce nondeterminism." Findings feed back into `validateLuaSource` and the sandbox. Out of scope for the v1 spec proper but worth noting.

## What's explicitly out of scope (v1)

- Bidirectional editing (viewer mutations)
- Selection-state back-channel (viewer → MCP "user selected node X")
- Comments / annotations
- Conflict resolution / multi-writer support
- Filesystem-backed L2 cache for the Node engine
- Inline (MCP-app-SDK) widget rendering — the viewer is a separate browser session, not an inline chat widget
- A read-write `viewerMode` (just a flag for now; flipping it requires the WS write-path which is stubbed)
