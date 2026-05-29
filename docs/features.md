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

- **Three-pane shell** — tree / viewport / inspector layout (familiar from Houdini/Blender).
- **Tree view** — collapse, select, single-highlight; shows node type labels and geometry-kind icons. Lua nodes get an expansion toggle (◆) to reveal the generated sub-DAG inline; derived nodes render with visual distinction (muted, italic, dashed indent) and read-only inspectors.
- **Property inspector** dispatching by node kind: paramSchema-driven forms for kernel nodes (with type-specific widgets for `int`, `number`, `boolean`, `string`, `vec2`, `vec3`, `vec2-array`, `enum`, plus `exclusiveGroup` fieldsets for mutually exclusive params); Lua inspector with live validation issues; decoder inspector. Derived (generated) nodes show a "Generated node" badge and enforce read-only mode.
- **Monaco slide-over Lua editor** — syntax highlighting, Revert / Save buttons, always-visible validation status chip (pass/fail + ms timing, debounced 150 ms).
- **Structural-mutation tool palette** — auto-generated wrap-with and add-child pickers from the node-type registry; delete, unwrap.
- **Document library** — multi-document picker; open, create, rename, delete. Persisted in IndexedDB via `@yacad/vfs` + `@yacad/doc-store`. First-run seeded from v1's example scenes (including the showcase fixtures).
- **Undo / redo** — snapshot-based, session-lifetime.
- **Document import/export** — single-bundle JSON or multi-doc archive via the header menu.
- **Performance panel** — node count, hit/miss/hit-rate, per-node timing breakdown.
- **Export gadget** — per-node STL / SVG / DXF / PNG, gated on the node's geometry kind.
- **Viewport toolbar** — display mode cycle (solid / wireframe / solid+edges), camera presets (front / back / left / right / top / bottom / isometric), perspective toggle, zoom controls (fit / + / −).
- **Docs drawer** — in-app panels for Language Reference, Lua API reference, Architecture, and Features docs.

### Common authoring

- **Sandboxed Lua code nodes.** Wasmoon-based Lua 5.4 with `openStandardLibs: false` + selective `math` / `string` / `table` loaders. `math.randomseed` seeded then stripped; `require`, `print`, `load`, `loadstring` stripped from the environment. A Lua node carries its source plus a parameter and input schema; the runtime expands it into a sub-DAG that the engine then walks.
- **Lua static validation.** `validateLuaSource` runs AST-level checks before any definition is committed: rejects undeclared `params.*` and `inputs.*` references, sandbox API violations, and malformed `geo.<type>` calls.
- **Showcase scene library** — six annotated parametric scenes seeded into the document library: house (13 params, gable roof), castle (12 params, curtain walls + crenellations), tree (12 params, recursive Lua + imported glTF leaves), torus knot (6 params, demonstrating the `warp` node), chamfered box (exploratory boolean-composition fillet), and filleted slab (exploratory boolean-composition chamfer).

### MCP server (`apps/mcp`)

An MCP (Model Context Protocol) server exposing the full DAG pipeline as tool calls for agentic workflows:

- **Library management** — list, open, create, delete documents.
- **Document reading** — get full document tree, inspect node at path.
- **Mutations** — setParam, addChild, moveChild, removeAt, replaceAt, wrapWith, unwrap, plus `addLuaDefinition` for Lua code nodes.
- **Exports** — STL, SVG, DXF, PNG (gated on geometry kind).
- **Cache control** — clear cache, rotate access token.
- **Viewer** — get viewer URL, set current document for live viewing.

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
- **Vitest** for unit tests; tests colocated with source (`foo.ts` + `foo.test.ts`). 248+ test files across the workspace.
- **`@yacad/e2e`** — full-pipeline scene→STL snapshot tests plus `packages/e2e/showcase/` scenes (house, castle, tree, torus-knot, chamfered-box, filleted-slab). Captured geometry summaries (vertex count, bbox, hash) catch silent regressions.
- **Playwright smoke** — `apps/studio/e2e/studio.spec.ts` covers the cold-start path, incremental recompute, 2D/3D scene switching, mesh-import scenes, Lua scenes, and export-button gating. `apps/studio2` has its own Playwright suite including a LuaInspector validation test.
- **ESLint flat config + Prettier.** Format and lint pass as CI gates.
- **GitHub Actions CI** — `ci.yml` (build + unit + lint + format), `browser-e2e.yml` (Playwright), `perf.yml` (kernel performance regression check), `deploy.yml` (studio v2 → GitHub Pages on push to `main`).
- **Per-phase design + plan docs** — every non-trivial feature ships a design spec (`docs/superpowers/specs/`) committed alongside the code. The history of decisions is in the repo.
