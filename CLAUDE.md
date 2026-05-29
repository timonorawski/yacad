# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status

The core pipeline (Merkle-DAG → cache → engine → kernel → render) is shipped. Phases 0–2 plus mesh imports (Phase 2.5), the 2D-vector exports, the Lua static validator, the `warp` per-vertex transform, and Studio v2 are all landed; `apps/studio2` is the active studio (live at cad.yamplay.cc). `docs/ROADMAP.md` tracks shipped phases vs. deferred work in summary form. `docs/vision.md` remains the authoritative spec — read it before substantive design work; it is dense and load-bearing.

## Commands

```bash
pnpm install                              # install workspace deps
pnpm build                                # tsc -b: build all library packages (project references)
pnpm test                                 # vitest run: all package unit tests
pnpm test:watch                           # vitest watch mode
pnpm lint                                 # eslint (flat config) over all TS
pnpm format                               # prettier --write
pnpm dev                                  # run the active studio v2 app (Vite dev server)
pnpm dev:legacy                           # run the legacy studio v1 app intentionally
pnpm build:app                            # production build of the studio v2 app

# single package / single test
pnpm --filter @yacad/dag test             # one package's tests (run from root)
pnpm vitest run packages/dag              # tests under a path
pnpm vitest run -t "semantic hashing"     # tests matching a name
pnpm --filter @yacad/studio check         # svelte-check apps/studio (v1)
pnpm --filter @yacad/studio2 check        # svelte-check apps/studio2 (v2)
pnpm --filter @yacad/studio2 test:e2e     # Playwright smoke (auto-spawns dev server)
```

Vitest resolves `@yacad/*` to package **source** (see `vitest.config.ts`), and the studio apps' `vite.config.ts` files alias them to source too — so `pnpm test` and `pnpm dev` need no prior `tsc -b`. `tsc -b` is the type-correctness gate (CI runs build + lint + format:check + test + build:app + e2e).

## Monorepo layout

`packages/*` are framework-agnostic libraries wired as the vision's layers; `apps/studio2` is the active Svelte 5 studio, `apps/studio` is the legacy v1 (JSON-editor based) kept for historical reference and archaeology; `tooling/*` holds the shared tsconfig base and ESLint config. Dependency flow (acyclic, simplified):

```
canonical → hash ┐
geometry ────────┼→ dag ─┬→ kernel-manifold ┐
                 │      └→ lua ─────────────┤
                 └→ cache ─────────────────┼→ engine → worker ─┐
                    render ────────────────┘                    ├→ studio2 (active)
                                                                └→ studio (v1)
vfs → doc-store → mutations / selection ─────────────────────────────────→ studio2
import-{stl, obj, gltf}      → dag (decoder node types)
export-{stl, dxf, svg, png}  → studio2 (per-node download gadget)
```

- `@yacad/canonical` — canonical JSON (invariant #4). `@yacad/hash` — pluggable `Hasher` (SHA-256). `@yacad/geometry` — `Mesh` / `BBox` / `CrossSection` value types.
- `@yacad/dag` — `Node` model, node-type registry + 2D/3D type system (#6), semantic hashing, `paramSchema` for kernel types, `ExpandableNodeType` abstraction.
- `@yacad/cache` — structured keys `{semantic_hash, produced_by}` (#3), `ObjectStore`, L1 (Map+LRU+pin) / L2 (IndexedDB) / `TieredStore`.
- `@yacad/kernel-manifold` — Manifold WASM kernel (#7); `(node, childMeshes) → Mesh|CrossSection`, deterministic (#2). Hosts the `WarpEvaluator` injection seam for per-vertex Lua callbacks.
- `@yacad/lua` — Lua sandboxed code-as-node (`LuaNode`), `WasmoonLuaRuntime`, `WasmoonWarpEvaluator`, `validateLuaSource` static analyzer, `SANDBOX_GLOBALS` single source of truth for the sandbox surface (#11).
- `@yacad/engine` — lazy memoized walker + cache-hit instrumentation. `@yacad/worker` — worker host (`./host`) + main-thread `WorkerClient` with `putLuaDefinition` validation.
- `@yacad/render` — three.js viewport.
- `@yacad/export-stl` / `@yacad/export-dxf` / `@yacad/export-svg` / `@yacad/export-png` — output formats; gated on geometry kind in studio2's per-node export gadget.
- `@yacad/import-stl` / `@yacad/import-obj` / `@yacad/import-gltf` — decoder node types (`{type, params: {blobHash}}` shape); content-addressed blobs flow through the doc-store's blob channel.
- `@yacad/vfs` — async-uniform KV byte store (L1 memory + L2 IndexedDB), the persistence layer under `@yacad/doc-store`.
- `@yacad/doc-store` — multi-document library + per-session API + undo/redo + invalidation state. The studio2 app talks to this, not to vfs directly.
- `@yacad/mutations` — pure `NodeDoc → NodeDoc` transformer primitives (`setParam`, `addChild`, `removeAt`, `wrapWith`, etc.).
- `@yacad/selection` — small framework-agnostic selection-state package; single-select today, multi-select is additive-extensible.

The worker hosts engine + cache + kernel + Lua runtime; the main thread holds the editable DAG and renders. The app resolves `manifold.wasm?url` (and similarly the Wasmoon WASM URL) on the main thread and sends them to the worker via an `init` message (bundlers resolve package asset URLs on the main side, not in the worker sub-bundle).

## What is being built

A parametric 3D printing platform whose central bet is that **the parametric model is the artifact, not the STL**. The unifying abstraction is a **content-addressable Merkle DAG of parametric operations** — the same pattern that underlies Git, IPFS, Bazel, and Nix, applied to CAD.

Target audience sits between Tinkercad (accessible), OpenSCAD/CadQuery (powerful), and Thingiverse (social). No existing tool covers all three corners.

## Architectural invariants

These are decisions the vision treats as non-negotiable. Don't relitigate them in code review or design discussion without explicit user signal — flag tension instead.

1. **DAG is the source of truth; meshes are derived, cached artifacts.** The system never stores meshes as primary data and never asks users to manipulate them directly.
2. **Every node's evaluation must be deterministic.** Non-determinism poisons the Merkle cache. Sandboxed code execution: no I/O, no clock, no unseeded RNG, no network.
3. **Cache keys are structured, not flat:** `{ semantic_hash, produced_by: { kernel, kernel_version, engine_version, quality_tier } }`. The semantic hash identifies geometry; `produced_by` is provenance. Keep this separation when implementing cache code.
4. **Canonical parameter serialization is critical.** Two semantically identical parameter sets must produce byte-identical canonical forms (sorted-key JSON, normalized numbers). Subtle bugs here silently degrade cache hit rates — test exhaustively.
5. **Code is a first-class node type, not a separate mode.** Follows Houdini's model, not OpenSCAD's. No attempt to round-trip arbitrary code into visual representation.
6. **Dual type system at node boundaries:** 2D shapes vs. 3D solids. Operations are typed (`extrude` takes 2D returns 3D, booleans take 3D return 3D). Catch errors at graph-construction time.
7. **Manifold is the primary kernel; OCCT.js is the escape hatch.** Kernel choice is per-node, declared by node type. Cache stores per-kernel artifacts under the same semantic hash.
8. **Scope discipline over feature breadth.** Explicitly out of scope: complex surface lofts, draft analysis, mold parting lines, large assemblies, constraint solving. This is what keeps the architecture tractable — don't quietly expand scope.
9. **Open-source CAD projects (FreeCAD, OpenSCAD, JSCAD, CadQuery) are specification documents for _what the problem is_, not architectural references for _how to solve it_.** Mine their test corpora and forum-documented edge cases; design fresh.
10. **Subtree closure for expandable-node introspection.** Any mechanism that lets an expandable node read upstream geometry during evaluation (today: declared inputs as opaque refs; future: bbox/edges/mesh introspection per the input-introspection design exploration) MUST restrict the accessible universe to exactly the subtree rooted at that node. The node's hash already includes its children's hashes, so anything derivable from a child's mesh is correctly cache-keyed; reading from siblings, cousins, or any node outside the subtree silently breaks the Merkle cache. This is the refinement of #2 for the input-introspection path; review every new `InputRef` method against it.
11. **Analyzer/runtime parity is structural, not aspirational.** When the system has both a runtime that accepts a set (sandbox surface, registered node types, paramSchema entries) and an analyzer that judges that set ahead of evaluation (the Lua static validator, future linters, autocomplete), the analyzer's valid set MUST be derived from the runtime's actual surface — not maintained as a parallel hardcoded list. The pattern: single source of truth (e.g., `SANDBOX_GLOBALS` consumed by both `WasmoonLuaRuntime` and `validateLuaSource`; `buildGeoApi()` consumed by both runtime and validator), plus a parity test that fails the build on drift (`packages/lua/src/wasmoon-runtime.test.ts` and `packages/dag/src/registry.test.ts` are the templates). Two production bugs shipped before this was made explicit.

## Layered structure (target)

```
Authoring Surfaces  →  Document Model (DAG)  →  VFS / Cache  →  Evaluation Engine  →  Geometry Kernels  →  Renderer
```

Consumers of the cache use a single async-uniform `ObjectStore` interface; tier (memory / IndexedDB / remote) is hidden behind it. Evaluation runs in a Web Worker; the main thread interacts via promises and renders progressively (placeholders → preview → final).

## Scope: shipped vs. deferred

Phase 0 (POC) is shipped. Subsequent phases — LuaNode (Phase 1), 2D layer (Phase 2), mesh imports (Phase 2.5), Section node, 2D vector exports, Lua static validation, `warp`, Studio v2 (foundation + tree editor) — are also shipped. Current development sits between consolidation (e.g., the input-introspection follow-up to fillet/chamfer) and the next bets (WYSIWYG 3D editing, slicer/print bridge).

`docs/ROADMAP.md` tracks shipped phases and deferred items in summary form. The vision's "Open Questions Carried Forward" section lists decisions deliberately deferred; surface them rather than silently picking an answer.

Out of scope (still, per invariant #8): complex surface lofts, draft analysis, mold parting lines, large assemblies, constraint solving.

## Working in this repo

- `docs/vision.md` is the load-bearing spec. Treat it as authoritative for design questions until code starts to constrain it. `docs/architecture.md` captures the current layered architecture in implementer-friendly form; `docs/features.md` and `docs/language-reference.md` are user-facing.
- **Design discipline:** `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` holds the design history; every non-trivial feature lands a spec before code (with `Status:` line indicating maturity). Implementation plans (TDD-shaped task lists) live in `docs/superpowers/plans/`. Plans are optional for small one-file changes — the user has explicitly skipped them for tactical work.
- Keep this file's commands / structure in sync as packages change, rather than letting it drift.
- **Test surfaces in `packages/e2e`:**
  - `packages/e2e/scenes/*.json` — JSON scene fixtures run end-to-end through the pipeline with snapshot-style geometry summaries. Catches silent geometry regressions across kernel/engine versions.
  - `packages/e2e/showcase/<name>/` — LuaDefinition-driven showcases (house, castle, tree, torus-knot, chamfered-box, filleted-slab). Each subfolder ships `README.md`, `index.ts` (LuaDefinition + seed function consumed by `apps/studio2/src/seed-scenes.ts`), `index.test.ts` (schema + `buildGraph` + **mandatory `validateLuaSource(def)` assertion**), and `eval.test.ts` (real kernel evaluation; catches geometric correctness that schema/buildGraph tests miss).
  - Add new scenes for cross-system test corpora (#9) and shipped showcase work; the showcase pattern is preferred for anything Lua-driven, the JSON pattern for kernel-primitive snapshot coverage.
- **LuaDefinition discipline:** every showcase's `index.test.ts` MUST include `expect(() => validateLuaSource(def)).not.toThrow()`. `buildGraph` doesn't expand Lua source, so without the static-validate assertion, broken `geo.*` calls land at user-load time instead of test time (we shipped this bug once and don't want to again).
- **Runtime/analyzer parity (#11):** when extending a runtime that has an analyzer counterpart (adding a base-lib function to the Lua sandbox, adding a kernel-node param, adding a decoder type), update the analyzer's valid set in the same commit and verify the parity test still passes. Templates: `packages/lua/src/wasmoon-runtime.test.ts` (sandbox parity), `packages/dag/src/registry.test.ts` (`paramSchema` completeness).
- **`paramSchema` is authoritative:** every kernel node's `normalizeParams` must accept exactly the params declared in its `paramSchema`. The `paramSchema-completeness` test in `registry.test.ts` exercises this; the warp incident (commit `50ab90d`) is the canonical example of what happens when this drifts.
