# Architecture

yacad is a TypeScript pnpm monorepo wired as a layered pipeline: authoring surfaces produce a parametric DAG, the engine walks it through a content-addressable cache, kernels evaluate nodes into geometry, and a renderer puts pixels on screen. Each layer is one or more packages; the studio app is the only DOM consumer.

This document is a navigator — what's where, why, and how the pieces fit. For the original architectural conviction, see [vision.md](vision.md). For per-node-type details, see [language-reference.md](language-reference.md).

## Layered pipeline

```
┌─────────────────────────────────────────────────────────────┐
│  Authoring Surfaces                          apps/studio    │
│  - JSON DAG editor                           apps/studio2   │
│  - Sample-scene library                                     │
│  - Lua escape hatch                                         │
├─────────────────────────────────────────────────────────────┤
│  Document Model              @yacad/dag    @yacad/canonical │
│  - Node = { id, type, params, children, hash }              │
│  - Node-type registry + 2D/3D type system                   │
│  - Canonical JSON for hash stability                        │
│  - Mutations + selection (studio v2)                        │
├─────────────────────────────────────────────────────────────┤
│  VFS / Cache                            @yacad/cache        │
│  - Content-addressable object store     @yacad/vfs          │
│  - L1 in-memory + L2 IndexedDB tiers                        │
│  - Structured keys: { semantic_hash, produced_by }          │
├─────────────────────────────────────────────────────────────┤
│  Evaluation Engine          @yacad/engine    @yacad/lua     │
│  - Lazy memoized DAG walker                                 │
│  - Cache-hit instrumentation                                │
│  - Wasmoon Lua sandbox (deterministic)                      │
├─────────────────────────────────────────────────────────────┤
│  Geometry Kernel                  @yacad/kernel-manifold    │
│  - Manifold WASM 3.5.0                                      │
│  - (node, childGeoms) → Geometry                            │
├─────────────────────────────────────────────────────────────┤
│  Worker host                          @yacad/worker         │
│  - Hosts engine + cache + kernel in a Web Worker            │
│  - Main thread holds DAG, sends edits, receives geometry    │
├─────────────────────────────────────────────────────────────┤
│  Renderer                             @yacad/render         │
│  - three.js viewport                                        │
│  - Progressive: placeholders → preview → final              │
├─────────────────────────────────────────────────────────────┤
│  I/O                                                        │
│  - Export: STL, DXF, SVG, PNG                               │
│  - Import: STL, OBJ, glTF (decoder node types)              │
└─────────────────────────────────────────────────────────────┘
```

The pipeline is acyclic. Geometry flows up; edits and parameter changes flow down. Caching at every node boundary means an edit to a leaf parameter recomputes only that node and its ancestors — siblings and cousins are reused from cache.

## Package map

The repo's `packages/*` are framework-agnostic libraries; `apps/*` are the only DOM consumers. Dependency flow is acyclic:

```
canonical → hash ┐
geometry ────────┼→ dag → kernel-manifold ┐
                 ├→ cache ─────────────────┼→ engine → worker → studio
                 └→ render ─────────────────────────────────────┘
```

### Foundations

- **`@yacad/canonical`** — canonical JSON serialization. Sorted keys, normalized numbers. Two semantically identical parameter sets must produce byte-identical canonical forms; the cache hit rate depends on it.
- **`@yacad/hash`** — pluggable `Hasher` interface. SHA-256 via `SubtleCrypto` is the default; blake3 is the original design target.
- **`@yacad/geometry`** — value types: `Mesh`, `CrossSection`, `BBox`, `Geometry` discriminated union (`{ kind: '2d', section } | { kind: '3d', mesh }`). No code, no logic — just types.

### Document model

- **`@yacad/dag`** — the core data model. Defines `Node` (`{ id, type, params, children, hash }`), the node-type registry, semantic hashing, the 2D/3D type system, and 20 built-in node types. The `NodeTypeDef` discriminated union covers three kinds: `Kernel` (computed by the kernel), `Expandable` (composed of sub-DAG — Lua nodes use this), and `Decoder` (leaf node decoding an opaque blob — the mesh imports use this).
- **`@yacad/mutations`** — _(studio v2 foundation)_ helpers for editing a DAG immutably: `setParam`, `addChild`, `moveChild`, `replaceAt`, `wrapWith`. Path-based addressing.
- **`@yacad/selection`** — _(studio v2 foundation)_ selection state shared between viewport and inspector.

### Cache and VFS

- **`@yacad/cache`** — content-addressable object store. Cache keys are structured: `{ semantic_hash, produced_by: { kernel, kernel_version, engine_version, quality_tier } }`. The semantic hash identifies _the geometry_; `produced_by` is provenance metadata so the cache can hold multiple valid artifacts under the same hash. L1 (`Map` + LRU + pin), L2 (IndexedDB), and `TieredStore` are the implementations. Artifacts: `mesh`, `bbox`, `crossSection`, `luaDefinition`.
- **`@yacad/vfs`** — _(studio v2 foundation)_ document filesystem abstraction. `MemoryVfs` and `IndexedDbVfs` implementations.
- **`@yacad/doc-store`** — _(studio v2 foundation)_ document library / session management built on `@yacad/vfs`.

### Evaluation

- **`@yacad/engine`** — lazy memoized DAG walker. Caches at every node boundary, emits per-node timings, instruments cache-hit rates. The engine is where the Merkle bet pays off: an edit to one parameter touches the engine's evaluation order minimally.
- **`@yacad/lua`** — Wasmoon-based Lua 5.4 sandbox. `openStandardLibs: false` + selective `loadLibrary`. `require`, `print`, `load`, `loadstring` are stripped. `math.randomseed` is seeded then stripped. Lua nodes are `Expandable` — they generate sub-DAGs that the engine then walks normally.
- **`@yacad/kernel-manifold`** — Manifold WASM 3.5.0 wrapped as a `Kernel`. Computes `(node, childGeoms) → Geometry`. Also hosts plane-rotation math (for `section`) and Catmull-Rom spline tessellation (for `spline`).

### Worker

- **`@yacad/worker`** — splits into a host (`./host`) that runs in a Web Worker and a `WorkerClient` that runs on the main thread. The worker hosts engine + cache + kernel; the main thread holds the editable DAG and renders. Communication is via `postMessage` with a typed promise wrapper. The studio app sends an `init` message with the resolved `manifold.wasm?url` (the bundler resolves package asset URLs on the main thread, not in the worker sub-bundle).

### Renderer

- **`@yacad/render`** — three.js viewport. Orbit camera, axis helpers, geometry-to-`Object3D` conversion for both 2D and 3D outputs (2D crosses bridge through a thin extrusion for preview). Progressive: placeholder → preview → final mesh as the worker reports back.

### I/O

- **`@yacad/export-stl`** — binary STL.
- **`@yacad/export-dxf`** — AutoCAD-2010 DXF (`LWPOLYLINE` per polygon, structurally validated against `dxf-parser` in tests).
- **`@yacad/export-svg`** — single `<path>` with `fill-rule="evenodd"`, Y-flipped via viewBox, structurally validated against `fast-xml-parser`.
- **`@yacad/export-png`** — split entry: `renderCrossSectionToContext` is environment-agnostic; `crossSectionToPngBrowser` uses `OffscreenCanvas`; `crossSectionToPngNode` uses `@napi-rs/canvas` (devDep, tests/CI only).
- **`@yacad/import-stl`**, **`@yacad/import-obj`**, **`@yacad/import-gltf`** — decoder node types. Each takes a blob hash; the decoder resolves it through the VFS, parses, and produces a `Mesh`.

### Test infrastructure

- **`@yacad/e2e`** — full-pipeline scene→STL tests over JSON scenes in `packages/e2e/scenes/`, with snapshotted geometry summaries (vertex count, bbox, hash). Add new scenes here to grow regression coverage — including DAG translations of other systems' test corpora.

### Apps

- **`apps/studio`** — the original studio. JSON editor + viewport + cache-hit panel + language reference. The reference implementation of "what the system can do end-to-end."
- **`apps/studio2`** — _(in progress)_ studio v2 foundation. Document library, inspectors per node type, structural mutations via `@yacad/mutations`, Monaco Lua editor. Not feature-equivalent to studio v1 yet.

## Threading model

The worker hosts evaluation (engine + cache + kernel); the main thread owns the DAG and the viewport.

```
┌──────────────── main thread ─────────────────┐    ┌─────── Web Worker ───────┐
│  studio UI (Svelte)                          │    │  WorkerHost              │
│  ┌─ DAG (source of truth, edited live)       │    │  ┌─ engine               │
│  ├─ Viewport (three.js)                      │    │  ├─ cache (L1+L2)        │
│  └─ WorkerClient ────────────► postMessage ──┼────┼──┤  └─ kernel-manifold   │
│                                              │    │     (Manifold WASM)      │
│       Geometry ◄──────────────  postMessage ─┼────┼────►                     │
└──────────────────────────────────────────────┘    └──────────────────────────┘
```

Why split this way: the Manifold WASM is heavy and runs synchronously inside the worker. Keeping it off the main thread means UI doesn't lock up during evaluation. The DAG stays on the main thread because edits need to be immediate-mode (no roundtrip latency for typing); only the (geometry-producing) evaluation roundtrips.

The `manifold.wasm` URL is resolved on the main thread (bundlers handle package asset URLs there) and shipped to the worker via an `init` message.

## Core data structures

These are the load-bearing types. Reading their source files is the fastest way to ground further reading.

- **`Node`** in [`@yacad/dag`](../packages/dag/src/node.ts) — `{ id, type, params, children, hash }`. The hash is `hash(type, canonical(params), child_hashes...)`. The `id` is for stable identity within a document (UI references) and is _not_ part of the hash.
- **`Geometry`** in [`@yacad/geometry`](../packages/geometry/src/index.ts) — discriminated union: `{ kind: '2d'; section: CrossSection } | { kind: '3d'; mesh: Mesh }`. Operations are dual-typed at node boundaries.
- **`NodeTypeDef`** in [`@yacad/dag/src/registry.ts`](../packages/dag/src/registry.ts) — `{ Kernel | Expandable | Decoder }` discriminated union. The registry holds all node types, schema-derived docs, parameter validators, and output-type resolvers.
- **`CacheKey` / `Artifact`** in [`@yacad/cache`](../packages/cache/src/index.ts) — `{ semantic_hash, produced_by }` keys; `Artifact` is a discriminated union `{ 'mesh' | 'bbox' | 'crossSection' | 'luaDefinition' }`.
- **`Kernel`** in [`@yacad/kernel-manifold`](../packages/kernel-manifold/src/kernel.ts) — `(node, childGeoms) → KernelResult`. The contract for plugging an alternative kernel (e.g., a future OCCT.js escape hatch) in.

## Architectural invariants

These are decisions code review treats as load-bearing. Don't relitigate without explicit signal — flag tension instead. See [vision.md](vision.md) for the deeper why.

1. **DAG is the source of truth; meshes are derived, cached artifacts.** The system never stores meshes as primary data and never asks users to manipulate them directly.
2. **Every node's evaluation must be deterministic.** Non-determinism poisons the Merkle cache. Sandboxed code execution: no I/O, no clock, no unseeded RNG, no network.
3. **Cache keys are structured, not flat.** `{ semantic_hash, produced_by: { kernel, kernel_version, engine_version, quality_tier } }`. The semantic hash identifies geometry; `produced_by` is provenance.
4. **Canonical parameter serialization is critical.** Two semantically identical parameter sets must produce byte-identical canonical forms. Subtle bugs here silently degrade cache hit rates.
5. **Code is a first-class node type, not a separate mode.** Houdini's model, not OpenSCAD's. No attempt to round-trip arbitrary code into visual representation.
6. **Dual type system at node boundaries:** 2D shapes vs. 3D solids. Operations are typed. Catch errors at graph-construction time.
7. **Manifold is the primary kernel; OCCT.js is the escape hatch.** Kernel choice is per-node, declared by node type. Cache stores per-kernel artifacts under the same semantic hash.
8. **Scope discipline over feature breadth.** What's deliberately out of scope (below) is what keeps the architecture tractable.
9. **Open-source CAD projects are specification documents for _what the problem is_, not architectural references for _how to solve it_.** Mine their test corpora and forum-documented edge cases; design fresh.

## Deliberately out of scope

- **Complex surface lofts.** Mesh-based kernel; not the right tool. BREP kernels (OCCT) are the escape hatch.
- **Draft analysis, mold parting lines.** Manufacturing CAD concerns, not 3D-printing concerns.
- **Large assemblies, constraint solving.** Different problem class entirely.
- **Mesh editing.** Users edit parameters and structure, not vertices and faces. The DAG is what gets manipulated.
- **True BREP fillets.** Manifold can't do them. Tracked in [ROADMAP](ROADMAP.md) as an OCCT-integration item.
- **Slicer configuration.** The future "print bridge" layer is a separate concern from engine/I/O.

See [ROADMAP.md](ROADMAP.md) for items that _are_ in scope but deferred from prior phases.
