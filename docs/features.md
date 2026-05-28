# Features

A capability inventory of what's shipped today. Complements [ROADMAP.md](ROADMAP.md) (what's deferred) and [language-reference.md](language-reference.md) (per-node-type details).

## Authoring

- **JSON DAG editor** (studio sidebar). Live recompile on edit, with a sample-scene dropdown covering 3D primitives, 2D primitives, Lua-driven scenes, and mesh-import variants.
- **Sandboxed Lua code nodes.** Wasmoon-based Lua 5.4 with `openStandardLibs: false` + selective `math` / `string` / `table` loaders. `math.randomseed` seeded then stripped; `require`, `print`, `load`, `loadstring` stripped from the environment. A Lua node carries its source plus a parameter and input schema; the runtime expands it into a sub-DAG that the engine then walks.
- **Sample-scene library** including a procedural-tree fixture (the designated parity test for the Lua runtime).
- **Studio v2 foundation (in progress).** Document library, per-node-type inspectors, structural mutations, and a Monaco-based Lua editor. Lives under `apps/studio2` and `packages/{vfs, doc-store, mutations, selection}`. Not feature-equivalent to studio v1 yet.

## Geometry kernel

- **Manifold WASM 3.5.0** as the primary kernel, hosted in a Web Worker.
- **Dual-typed geometry** at every node boundary: `Geometry = { kind: '2d', section: CrossSection } | { kind: '3d', mesh: Mesh }`. Operations are typed (`extrude` takes 2D returns 3D, `section` takes 3D returns 2D, booleans are dual-typed). Type errors surface at graph-construction time.

## Node types (24)

See [language-reference.md](language-reference.md) for full parameter schemas. Summary:

**3D primitives** — `box`, `sphere`, `cylinder`

**2D primitives** — `circle`, `rectangle`, `polygon`, `spline` (Catmull-Rom closed spline)

**3D transforms** — `translate`, `rotate`

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
- **Artifacts:** `mesh`, `bbox`, `crossSection`, `luaDefinition`.

## Studio app (`apps/studio`)

- **three.js viewport** — orbit camera, axis helpers, geometry-to-`Object3D` conversion for both 2D and 3D outputs.
- **Live JSON editor** — edits debounce to a worker `evaluate` request; the worker walks the DAG, evaluates new/changed nodes, and reports geometry + per-node timings back.
- **Stats panel** — total nodes, cache hits, misses, hit rate, evaluation phase timings (kernel, lua, serialize, etc.), per-node breakdown.
- **Language reference panel** — auto-generated from registered node types' parameter schemas; lives next to the editor for quick reference.
- **Export buttons** gated on the current result's geometry kind: STL for 3D, DXF/SVG/PNG for 2D.

## Engineering substrate

- **TypeScript pnpm monorepo** with workspace packages and project references. `tsc -b` is the type-correctness gate; CI runs build + lint + format:check + test + build:app.
- **Vitest** for unit tests; tests colocated with source (`foo.ts` + `foo.test.ts`). 530+ unit tests across the workspace.
- **`@yacad/e2e`** — full-pipeline scene→STL snapshot tests over JSON fixtures in `packages/e2e/scenes/`. Captured geometry summaries (vertex count, bbox, hash) catch silent regressions.
- **Playwright smoke** — `apps/studio/e2e/studio.spec.ts` covers the cold-start path, incremental recompute, 2D/3D scene switching, mesh-import scenes, Lua scenes, and export-button gating.
- **ESLint flat config + Prettier.** Format and lint pass as CI gates.
- **GitHub Actions CI** — `ci.yml` (build + unit + lint + format), `browser-e2e.yml` (Playwright), `perf.yml` (kernel performance regression check).
- **Per-phase design + plan docs** — every non-trivial feature ships as a design spec (`docs/superpowers/specs/`) and an implementation plan (`docs/superpowers/plans/`) committed alongside the code. The history of decisions is in the repo.
