# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository status

The Phase 0 POC is implemented: a TypeScript pnpm monorepo realizing the Merkle-DAG → cache → engine → kernel → render pipeline end-to-end, plus a Svelte studio app. `docs/vision.md` remains the authoritative spec — read it before substantive design work; it is dense and load-bearing.

## Commands

```bash
pnpm install              # install workspace deps
pnpm build                # tsc -b: build all library packages (project references)
pnpm test                 # vitest run: all package unit tests
pnpm test:watch           # vitest watch mode
pnpm lint                 # eslint (flat config) over all TS
pnpm format               # prettier --write
pnpm dev                  # run the studio app (Vite dev server)
pnpm build:app            # production build of the studio app

# single package / single test
pnpm --filter @yacad/dag test          # one package's tests (run from root)
pnpm vitest run packages/dag           # tests under a path
pnpm vitest run -t "semantic hashing"  # tests matching a name
pnpm --filter @yacad/studio check      # svelte-check the app
```

Vitest resolves `@yacad/*` to package **source** (see `vitest.config.ts`), and the studio app's `vite.config.ts` aliases them to source too — so `pnpm test` and `pnpm dev` need no prior `tsc -b`. `tsc -b` is the type-correctness gate (CI runs build + lint + format:check + test + build:app).

## Monorepo layout

`packages/*` are framework-agnostic libraries wired as the vision's layers; `apps/studio` is the only DOM/Svelte consumer; `tooling/*` holds the shared tsconfig base and ESLint config. Dependency flow (acyclic):

```
canonical → hash ┐
geometry ────────┼→ dag → kernel-manifold ┐
                 └→ cache ─────────────────┼→ engine → worker → studio
                    render ────────────────┘            render ─┘
```

- `@yacad/canonical` — canonical JSON (invariant #4). `@yacad/hash` — pluggable `Hasher` (SHA-256). `@yacad/geometry` — `Mesh`/`BBox` value types.
- `@yacad/dag` — `Node` model, node-type registry + 2D/3D type system (#6), semantic hashing.
- `@yacad/cache` — structured keys `{semantic_hash, produced_by}` (#3), `ObjectStore`, L1 (Map+LRU+pin) / L2 (IndexedDB) / `TieredStore`.
- `@yacad/kernel-manifold` — Manifold WASM kernel (#7); `(node, childMeshes) → Mesh`, deterministic (#2).
- `@yacad/engine` — lazy memoized walker + cache-hit instrumentation. `@yacad/worker` — worker host (`./host`) + main-thread `WorkerClient`.
- `@yacad/render` — three.js viewport. `@yacad/export-stl` — binary STL.

The worker hosts engine + cache + kernel; the main thread holds the editable DAG and renders. The app resolves `manifold.wasm?url` on the main thread and sends it to the worker via an `init` message (bundlers resolve package asset URLs on the main side, not in the worker sub-bundle).

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

## Layered structure (target)

```
Authoring Surfaces  →  Document Model (DAG)  →  VFS / Cache  →  Evaluation Engine  →  Geometry Kernels  →  Renderer
```

Consumers of the cache use a single async-uniform `ObjectStore` interface; tier (memory / IndexedDB / remote) is hidden behind it. Evaluation runs in a Web Worker; the main thread interacts via promises and renders progressively (placeholders → preview → final).

## Phase 0 (POC) scope

The vision designates a weekend POC to validate the core bet. When implementing, stay within this scope unless the user expands it:

- Manifold WASM in a Web Worker
- DAG with blake3 hashing (SHA-256 via SubtleCrypto acceptable as fallback)
- Object store: L1 (Map) + L2 (IndexedDB), async-uniform
- Structured cache keys (even if `produced_by` is minimal)
- ~6 node types: `box`, `sphere`, `cylinder`, `translate`, `rotate`, `union`, `difference`
- Trivial UI: JSON editor + three.js viewport
- STL export

Explicitly **out** of POC scope: Lua/code nodes, WYSIWYG editor, format imports, slicer bridge, persistence beyond the cache, anything OCCT.

Success = editing a parameter recomputes only the changed subtree + ancestors (verified by cache-hit-rate instrumentation), sub-100ms response on small models, page reload warm-starts from IndexedDB.

## Working in this repo

- `docs/vision.md` is the spec. Treat it as authoritative for design questions until code starts to constrain it.
- Keep this file's commands / structure in sync as packages change, rather than letting it drift.
- The vision's "Open Questions Carried Forward" section lists decisions deliberately deferred — surface them rather than silently picking an answer.
- `packages/e2e` runs full-pipeline scene→STL tests over `packages/e2e/scenes/*.json` with captured (snapshot) geometry summaries. Add new scenes there — including DAG translations of other systems' test corpora (invariant #9) — to grow regression coverage.
