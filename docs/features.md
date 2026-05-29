# Features

A capability inventory of what's shipped today. Complements [ROADMAP.md](ROADMAP.md) (what's deferred) and [language-reference.md](language-reference.md) (per-node-type details).

## Authoring

### Studio v1 (`apps/studio`)

The original reference implementation, kept for compatibility and Playwright e2e coverage:

- **JSON DAG editor** (sidebar). Live recompile on edit; sample-scene dropdown covering 3D primitives, 2D primitives, Lua-driven scenes, and mesh-import variants.
- **three.js viewport** — orbit camera, axis helpers, 2D and 3D geometry rendering.
- **Stats panel** — cache hit rate, per-node timing breakdown.
- **Language reference panel** — auto-generated from the registry's `paramSchema`.
- **Export buttons** gated on geometry kind: STL for 3D; DXF/SVG/PNG for 2D.

### Studio v2 (`apps/studio2`, live at [cad.yamplay.cc](https://cad.yamplay.cc))

The current Svelte 5 studio, auto-deployed from `main`:

- **Three-pane shell** — tree / viewport / inspector layout (familiar from Houdini/Blender). On mobile (< 900 px) the tree and inspector become slide-in sheets toggled by toolbar buttons; on desktop (≥ 900 px) both open by default alongside the viewport.
- **Tree view** — collapse, select, single-highlight; shows node type labels and geometry-kind icons. Lua nodes get an expansion toggle (◆) to reveal the generated sub-DAG inline; derived nodes render with visual distinction (muted, italic, dashed indent) and read-only inspectors.
- **Property inspector** dispatching by node kind: paramSchema-driven forms for kernel nodes (with type-specific widgets for `int`, `number`, `boolean`, `string`, `vec2`, `vec3`, `vec2-array`, `enum`, plus `exclusiveGroup` fieldsets for mutually exclusive params); Lua inspector with live validation issues; decoder inspector. Derived (generated) nodes show a "Generated node" badge and enforce read-only mode.
- **Node focus mode** — clicking a node row in the tree focuses that node: the performance panel filters to its subtree and the viewport scopes to its evaluated geometry. Clicking another node or the background exits focus. Powered by `focusedNodeId` / `focusedHash` state in `App.svelte`.
- **Monaco slide-over Lua editor** — syntax highlighting, Revert / Save buttons, always-visible validation status chip (pass/fail + ms timing, debounced 150 ms).
- **Structural-mutation tool palette** — auto-generated wrap-with and add-child pickers from the node-type registry; delete, unwrap.
- **Document library** — multi-document picker; open, create, rename, delete. Persisted in IndexedDB via `@yacad/vfs` + `@yacad/doc-store`. First-run seeded from v1's example scenes (including the showcase fixtures).
- **Undo / redo** — snapshot-based, session-lifetime.
- **Document import/export** — single-bundle JSON or multi-doc archive via the header menu.
- **Performance panel** — node count, hit/miss/hit-rate, per-node timing breakdown.
- **Export gadget** — per-node STL / SVG / DXF / PNG, gated on the node's geometry kind.
- **Viewport toolbar** — display mode cycle (solid / wireframe / solid+edges), camera presets (front / back / left / right / top / bottom / isometric), perspective toggle, zoom controls (fit / + / −).
- **Docs drawer** — in-app panels for Language Reference, Lua API reference, Architecture, and Features docs.
- **Live remote-viewer mode** — launch with `?backend=remote&ws=ws://host:port/ws` to mirror an MCP server session read-only. All editing UI is hidden. WebSocket broadcasts (`current-doc-changed`, `doc-changed`, `blob-added`, `meta-changed`, `library-changed`) keep the tree, inspector, blob set, and document list in sync with the server. Backend selected in `main.ts`; WS subscriptions wired in `App.svelte`.

### Common authoring

- **Sandboxed Lua code nodes.** Wasmoon-based Lua 5.4 with `openStandardLibs: false` + selective `math` / `string` / `table` loaders. For LuaNode: `math.randomseed` is called with a deterministic seed derived from the definition hash, then stripped; `math.random` survives. For `warp` nodes: both `math.random` and `math.randomseed` are stripped (per-vertex randomness breaks the Merkle cache). `require`, `print`, `load`, `loadstring` stripped in all modes. A Lua node carries its source plus a parameter and input schema; the runtime expands it into a sub-DAG that the engine then walks.
- **Lua static validation.** `validateLuaSource` runs AST-level checks before any definition is committed: rejects undeclared `params.*` and `inputs.*` references, sandbox API violations, and malformed `geo.<type>` calls.
- **Showcase scene library** — six annotated parametric scenes seeded into the document library: house (13 params, gable roof), castle (12 params, curtain walls + crenellations), tree (12 params, recursive Lua + imported glTF leaves), torus knot (6 params, demonstrating the `warp` node), chamfered box (exploratory boolean-composition fillet), and filleted slab (exploratory boolean-composition chamfer).

### MCP server (`apps/mcp`)

A stdio MCP server that holds an authoritative `DocSession` and simultaneously serves a freshly-built studio2 viewer over HTTP+WS — giving an agent a live browser window into the model it is editing.

- **Composition.** One Node process: MCP SDK over stdio for tool dispatch; `Engine + ManifoldKernel + WasmoonLuaRuntime + WasmoonWarpEvaluator` for evaluation; `FilesystemVfs` (`@yacad/vfs-fs`) for persistence; HTTP serving `apps/studio2/dist/`; WS endpoint at `/ws` mounting `@yacad/remote-vfs`'s `RemoteVfsServer`. Studio2 in the browser uses `RemoteVfs` instead of IndexedDB — the VFS layout on disk is identical so the `DocLibrary` is unchanged.
- **Setup.** Copy `.mcp.json.example` to `.mcp.json`, replace the absolute path, restart Claude Code. `run.sh` rebuilds the bundled MCP and studio2 on every launch so the served viewer always reflects current source. In `--no-viewer` mode the rebuild is skipped.
- **Tool surface: 30 tools in eight groups.**
  - Library (5) — `listDocs`, `createDoc`, `openDoc`, `deleteDoc`, `setCurrentDoc`. Manage the document library and control which doc has viewer focus.
  - Read (3) — `getDoc`, `getNodeAt`, `evaluate`. Inspect the DAG tree and evaluate geometry (returns bbox, triangle count, cache stats).
  - Mutate (8) — `addChild`, `wrapWith`, `unwrap`, `removeAt`, `moveChild`, `replaceAt`, `setParam`, `setParams`. Full structural and param-level DAG mutations.
  - Lua (2) — `addLuaDefinition` (validate, register, and persist a `LuaDefinition` blob into the current doc — requires a current doc open first), `validateLuaCode` (dry-run validation, never registers).
  - Export (4) — `exportStl` (3D → binary STL, base64), `exportSvg` / `exportDxf` / `exportPng` (2D → base64). Export tools are gated on node geometry kind.
  - Cache (1) — `clearCache`. Drops the engine cache; next evaluate is all misses.
  - Server (2) — `getViewerUrl` (returns URL with token when applicable), `rotateAccessToken` (generates a fresh token and drops connected viewers).
  - Docs (5) — `listNodeTypes`, `getNodeTypeDoc`, `getLanguageReference`, `getLuaApiReference`, `getExamples`. Read-only introspection of the node-type registry and showcase examples; no current doc required.
- **Viewer mode.** Studio2 is served from the same process with `?backend=remote&ws=...` query params so it reads state from the MCP's VFS over WS. Live-broadcasting keeps the viewer in sync: `current-doc-changed` fires on `createDoc` / `openDoc` / `setCurrentDoc`; `doc-changed` / `meta-changed` / `blob-added` fire from per-session event subscriptions on every mutation; `library-changed` fires on `createDoc` / `deleteDoc`.
- **Access control.** Localhost binds (`127.0.0.1` / `localhost` / `::1`) require no token. Any other `--host` value generates a random 32-hex-char token at startup, printed to stderr; the token is required as `?token=...` on every HTTP request and WS upgrade. `rotateAccessToken` generates a new token and closes existing WS connections (they reconnect with the new URL). `getViewerUrl` always returns the URL with the token baked in.
- **Flags.** `--port N` (default `5179`) — HTTP+WS port. `--host HOST` (default `127.0.0.1`) — bind address; non-localhost enables token enforcement. `--library-dir PATH` (default `./.yacad-mcp/vfs`) — persistence root. `--no-viewer` — skip HTTP+WS; MCP runs headless.
- **Persistence.** Per-project under `<cwd>/.yacad-mcp/vfs/`. `@yacad/vfs-fs`'s `FilesystemVfs` mirrors the IndexedDB path layout exactly (`/docs/{id}/meta.json`, `/docs/{id}/document.json`, `/docs/{id}/blobs/{hash}.bin`); atomic writes via write-temp-then-rename.

## Geometry kernel

- **Manifold WASM 3.5.0** as the primary kernel, hosted in a Web Worker.
- **Dual-typed geometry** at every node boundary: `Geometry = { kind: '2d', section: CrossSection } | { kind: '3d', mesh: Mesh }`. Operations are typed (`extrude` takes 2D returns 3D, `section` takes 3D returns 2D, booleans are dual-typed). Type errors surface at graph-construction time.

## Node types (25)

See [language-reference.md](language-reference.md) for full parameter schemas. Summary:

**3D primitives** — `box`, `sphere`, `cylinder`

**2D primitives** — `circle`, `rectangle`, `polygon`, `spline` (Catmull-Rom closed spline)

**3D transforms** — `translate`, `rotate`, `warp` (per-vertex Lua deformation)

**2D transforms** — `translate_2d`, `rotate_2d`

**Booleans (dual-typed; accept either 2D or 3D)** — `union`, `difference`, `intersection`, `hull`

**Refinement** — `refine` (3D mesh subdivision), `offset_2d` (signed grow/shrink with round / square / miter joins)

**Bridges between dimensions** — `extrude` (2D→3D), `revolve` (2D→3D), `section` (3D→2D arbitrary-plane slice)

**Code** — `lua` (Expandable node type — Lua source + parameter/input schema produces a sub-DAG)

**Import decoders** — `import-stl`, `import-obj`, `import-gltf` (Decoder node types — opaque blob hash + format-specific parser produces a `Mesh`)

## Geometry I/O

### Export

- **STL (binary)** — `@yacad/export-stl`. Pure mesh export.
- **DXF** — `@yacad/export-dxf`. AutoCAD 2010 (AC1024). `LWPOLYLINE` per polygon with `AcDbEntity` / `AcDbPolyline` subclass markers. Configurable layer and `$INSUNITS`. Output structurally validated against `dxf-parser` in tests.
- **SVG** — `@yacad/export-svg`. Single `<path>` with `fill-rule="evenodd"` (Manifold's CW-hole convention renders correctly). Y-axis flipped via negated viewBox. Autocomputed pixel dimensions; configurable stroke / fill / strokeWidth / background. Output structurally validated against `fast-xml-parser`.
- **PNG** — `@yacad/export-png`. Split entry: `renderCrossSectionToContext` is environment-agnostic; `crossSectionToPngBrowser` uses `OffscreenCanvas` + `convertToBlob`; `crossSectionToPngNode` uses `@napi-rs/canvas` (devDep, tests/CI only).

DXF, SVG, and PNG operate on `CrossSection` — pair them with the `section` node to slice a 3D part into a 2D profile for laser cutting, documentation, or fabrication-shop dispatch.

### Import

- **STL (binary)** — `@yacad/import-stl`. Welds vertices by exact position (recovers face adjacency that STL's per-triangle storage throws away).
- **OBJ** — `@yacad/import-obj`. Triangulates polygonal faces; ignores material / smoothing-group data.
- **glTF (`.glb` only)** — `@yacad/import-gltf`. Embedded binary glTF. JSON glTF with external `.bin` files is not accepted — export as `.glb` before importing.

Each import is a `Decoder` node type: it takes a blob hash, the runtime resolves the blob through the VFS, parses, and produces a `Mesh`.

## Caching

- **Structured cache keys** — `{ semantic_hash, produced_by: { kernel, kernel_version, engine_version, quality_tier } }`. The semantic hash identifies the geometry; `produced_by` is provenance metadata. Multiple valid artifacts can coexist under the same semantic hash (e.g., preview vs final, alternate kernels).
- **L1: in-memory `Map`** with LRU eviction and pinning. Hot artifacts; bounded by configurable budget.
- **L2: IndexedDB** with write-behind persistence. Survives page reload; the next session warm-starts from L2.
- **`TieredStore`** presents a single async-uniform `ObjectStore` interface; consumers don't know which tier serves their request.
- **Per-node timings + cache-hit instrumentation** surfaced by the engine, displayed in the studio's stats panel.
- **Artifacts:** `mesh`, `bbox`, `crossSection`, `luaDefinition`, `expandedDoc` (cached resolved sub-DAG for Lua node inspection).

## VFS & persistence

- **`@yacad/vfs` — async-uniform `Vfs` interface.** Four methods: `read`, `write`, `delete`, `list(prefix)`. Values are opaque `Uint8Array` bytes; callers own encoding. Same interface across all backends; consumers never see the tier.
- **Backends shipped:** `MemoryVfs` (in-process; used by tests) and `IndexedDbVfs` (browser default; survives page reload). Key layout under a configurable root prefix: `/docs/{id}/meta.json`, `/docs/{id}/document.json`, `/docs/{id}/blobs/{hash}.bin`. A separate prefix (`/samples/`) mirrors the same layout for the sample library.
- **`@yacad/vfs-fs` — `FilesystemVfs` (Node).** Atomic writes via write-to-`{key}.tmp` then `rename`; a crashed process cannot leave half-written files. Used by the MCP server; persists project-local docs under `./.yacad-mcp/vfs/` by default.
- **`@yacad/remote-vfs` — `RemoteVfs` (browser) + `RemoteVfsServer` (Node).** Wraps any `Vfs` over a WebSocket with JSON-RPC framing (`vfs.read`, `vfs.write`, `vfs.delete`, `vfs.list`) plus a server-event push channel. The server can flag a connection `readOnly`; writes and deletes are rejected with `viewer-read-only` (used in the MCP viewer mode). `RemoteVfs` reconnects with exponential backoff and queues pending RPCs while the socket is down.
- **`@yacad/doc-store` — `DocLibrary` and `DocSession`.** Both sit over any `Vfs`. `DocLibrary` handles create / list / open / delete / rename. `DocSession` owns the open document's in-memory state: undo/redo snapshots, autosave, blob-set management, validation, and an event stream (`doc-changed`, `meta-changed`, `blob-added`, `persisted`, `invalidated`).
- **Composition.** Standalone studio: `IndexedDbVfs` → `DocLibrary`. MCP server: `FilesystemVfs` → `DocLibrary`, with `RemoteVfsServer` exposing the same VFS over `/ws` so a studio2 browser using `RemoteVfs` can read docs and receive live-change events. Same `DocLibrary` code on both sides; only the storage tier differs.

## Not yet

Explicitly out of scope or not yet started. See [ROADMAP.md](ROADMAP.md) for the full deferred list.

- **BREP / OCCT kernel** — no fillets, chamfers, or true edge rounding. Manifold is the only active kernel. OCCT.js integration is planned but not started.
- **3D mesh export beyond STL** — no OBJ, glTF, or 3MF output. Deferred until the mesh data model carries normals/UVs/materials.
- **2D vector import** — no DXF or SVG import. Export is done; import is a future decoder node.
- **Print bridge** — no slicer invocation, no Klipper dispatch, no print farm support.
- **WYSIWYG 3D editing** — no 3D viewport click→select, bounding-box widgets, or in-viewport transform handles. Tree-editor + inspector are shipped; viewport interaction is spec 3.
- **Constraint solver** — no parametric constraints or dimensional sketch solver.
- **Agentic features** — no STL-to-parametric reconstruction, no SCAD refactoring agent, no LLM-driven authoring.
- **Multi-user collaboration** — no shared sessions, no remote sync beyond the planned future remote cache tier.

## Engineering substrate

- **TypeScript pnpm monorepo** with workspace packages and project references. `tsc -b` is the type-correctness gate; CI runs build + lint + format:check + test + build:app.
- **Vitest** for unit tests; tests colocated with source (`foo.ts` + `foo.test.ts`). 75 test files across the workspace.
- **`@yacad/e2e`** — full-pipeline scene→STL snapshot tests plus `packages/e2e/showcase/` scenes (house, castle, tree, torus-knot, chamfered-box, filleted-slab). Captured geometry summaries (vertex count, bbox, hash) catch silent regressions.
- **Playwright smoke** — `apps/studio/e2e/studio.spec.ts` covers the cold-start path, incremental recompute, 2D/3D scene switching, mesh-import scenes, Lua scenes, and export-button gating. `apps/studio2/e2e/` has its own Playwright suite (`studio2.spec.ts` + `lua-validation.spec.ts`). `apps/mcp/e2e/mutation-updates-viewer.spec.ts` covers the MCP-to-viewer live-update path.
- **ESLint flat config + Prettier.** Format and lint pass as CI gates.
- **GitHub Actions CI** — `ci.yml` (build + lint + format:check + test + build:app), `browser-e2e.yml` (Playwright, studio v1), `perf.yml` (kernel performance regression check), `deploy.yml` (studio v2 → GitHub Pages on push to `main`).
- **Per-phase design + plan docs** — every non-trivial feature ships a design spec (`docs/superpowers/specs/`) committed alongside the code. The history of decisions is in the repo.
