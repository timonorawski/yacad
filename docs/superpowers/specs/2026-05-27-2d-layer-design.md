# 2D layer design

**Status**: design approved, awaiting implementation plan
**Date**: 2026-05-27
**Scope**: Phase 2 of the parametric CAD roadmap — extend the dual-type system (declared but unused in Phase 1) with a working 2D layer: primitives, ops, 2D→3D bridges (extrude, revolve), and one 3D refinement (refine). Takes the platform from "MVP 3D object assembly" to "MVP CAD."

## Goals

- Realize the 2D half of [CLAUDE.md invariant #6](../../../CLAUDE.md) (dual type system at node boundaries). After this phase, `outputType` flows through the system as `'2d'` for real, not as a typing decoration with no consumers.
- Ship the smallest node-type set that lets a user build a real parametric model (profile → extrude → fillet → boolean compose). Concretely: 14 new node types plus extensions to three existing ones.
- Make `LuaNode → 2D → extrude → 3D` a first-class, zero-extra-code composition. The Phase-1 abstraction already supports this; the spec calls it out explicitly so authoring tools / examples lean into it.
- Preserve every Phase-1 invariant: structured cache keys, deterministic evaluation, canonical hashing, per-node failure isolation for expandable nodes, sandboxed Lua.

## Non-goals (deferred to Phase 3+)

- `smooth` / `smoothByNormals` / `smoothOut` — 3D smoothing of an existing mesh. Refinement of geometry already buildable; not unlocking new capability classes.
- `warp` (2D and 3D coordinate warp via a JS callback). The callback-driven API needs its own determinism design (the warp function is a node parameter that must serialize and hash); deferred until needed.
- `minkowski` sum/difference. No native Manifold 3.5.0 support; emulation via `extrude` + `union` is doable but design-y enough to belong in its own phase.
- Holes in `polygon`. For v1 you compose holes via `difference(outer, inner)` — works correctly and stays declarative.
- Open `path_2d` type plus sweep operations (`sweep_along_path`). Requires a new geometry kind in the type system and an entire new operations set; explicit Phase 3+ work.
- `extrude` with twist/scale driven by a Lua callback. The base `extrude` ships with constant `twist` and `scaleTop` params; callback-driven extrusion is a future feature pairing with `warp`.
- BREP fillets (`fillet_brep` on arbitrary 3D edges). Spec invariant #7 reserves these for OCCT.

## Decisions and rationale

### Scope: 2D primitives + ops + bridges + spline + minimal 3D refinement

The Phase 1 set (`box, sphere, cylinder, translate, rotate, union, difference`) is sufficient for procedural composition but cannot express anything a printable model actually needs (rounded corners, swept profiles, extruded outlines). The 2D phase ships the minimal extension that makes parametric CAD modeling possible. _Rejected:_ ship everything in the user's wishlist (also adds `smooth`, `warp`, `minkowski`) — larger surface, no new capability classes for v1.

### Spline: Catmull-Rom interpolation, closed-only, tessellated

A spline node takes control points + `segmentsPerCurve` + `tension`, and emits a `CrossSection` with one closed polygon produced by Catmull-Rom interpolation through the control points. Tessellation happens deterministically inside the node's kernel handler; the kernel never sees curves.

The decision is rationalized by:

1. **Matches author intuition.** "The curve goes through these points" is what users mean when they think "spline."
2. **Preserves the dual-type system as declared.** No new `'curve_2d'` type variant; the existing `'2d' | '3d'` discriminator stays.
3. **Composes cleanly downstream.** Manifold's `CrossSection` (and everything that operates on it — booleans, `offset_2d`, `extrude`, `revolve`) takes polygons. A spline that emits a polygon plugs in everywhere.

_Rejected:_ pure polyline (a `spline` would be indistinguishable from `polygon` with user-supplied points — no point in two node types); first-class parametric curves with their own type (much larger design surface, more operations, deferred to a future phase).

Bezier or other interpolation algorithms remain a clean future extension: either an `algorithm: 'catmull-rom' | 'bezier'` param on `spline`, or a separate node type with the same `output: '2d'` contract.

### Naming: type-overloaded ops; transforms split by arity

`union`, `difference`, `intersection`, `hull` are single node types whose `checkChildren` accepts all-2D OR all-3D children (rejects mixed). Their `output` is computed per-instance from `children[0].outputType` — the cleanest API surface for users ("union of polygons, union of solids, same word").

Transforms are split: `translate` (3D, `offset: vec3`) and `translate_2d` (2D, `offset: vec2`); same for `rotate` and `rotate_2d`. Overloading on `offset` arity would be brittle (a `vec2` JSON like `[10, 0]` is structurally distinct from `vec3` but easy to typo). Different node types make the dimension explicit in the document.

_Rejected:_ pure suffixed naming (`union_2d`, `difference_2d`, ...) is the conservative call but litters every document with `_2d` even when context makes the dimension obvious. _Also rejected:_ overloading transforms despite the arity ambiguity — the cost of confusing error messages outweighed the small naming consistency gain.

### Per-instance `output` on `KernelNodeType`

Phase 1 declared `KernelNodeType.output: GeometryType`. To support overloaded ops without inventing new abstractions, we extend it:

```ts
interface KernelNodeType {
  readonly kind: 'kernel';
  readonly type: string;
  readonly output: GeometryType | ((children: readonly Node[]) => GeometryType);
  // ... rest unchanged
}
```

`buildGraph` resolves `output` once per node-instance at build time (not at evaluate time) so `Node.outputType` stays populated as a plain `GeometryType` value just like today. The existing seven Phase-1 node types continue to use the static-string form and need no modification.

### Kernel + cache shape: uniform `Geometry` in the kernel, kind-tagged artifacts in the cache

The kernel's signature changes from `(node, Mesh[]) -> Mesh` to `(node, Geometry[]) -> Geometry`, where `Geometry` is a discriminated union `{ kind: '2d'; section } | { kind: '3d'; mesh }`. One return type, one path through the kernel.

The cache continues to store by artifact kind: `ArtifactKind` gains `'crossSection'` alongside the existing `'mesh' | 'bbox' | 'luaDefinition'`. Engine code maps `node.outputType` to artifact kind at lookup/store time. This is the same pattern Phase 1 used for `luaDefinition` — a structural placeholder `CrossSectionLike` lives in `@yacad/cache` so the cache package doesn't import `@yacad/geometry` for types it only references structurally.

_Rejected:_ parallel kernel methods (`evaluate` for 3D, `evaluate2d` for 2D) — pushes the type discrimination to every consumer instead of encapsulating it inside the kernel. _Also rejected:_ uniform discriminated union both in kernel API and as a single cache kind — loses the per-kind storage discrimination that's served the cache well.

### LuaNode → 2D: first-class composition, no code changes

`LuaSchema.output: GeometryType` already accepts `'2d' | '3d'` (declared in Phase 1; Phase 1 examples only used `'3d'`). `ExpandableNodeType.resolveOutput` already returns either. The `geo.*` API generator in `packages/lua/src/geo.ts` filters on `kind: 'kernel'` — the moment new 2D primitives register, they automatically appear as `geo.circle()`, `geo.rectangle()`, `geo.polygon()`, `geo.spline()` callable from Lua scripts.

A LuaNode with `schema.output: '2d'` whose code emits 2D primitives, wrapped by a kernel-backed `extrude` node, is a valid, type-checked, fully cached composition. The spec calls this out explicitly because it shifts what's expressible — procedural 2D shapes (logarithmic spirals, fractal boundaries, parametric icon sets) become inputs to standard CAD ops.

The implementation cost is zero; the documentation and example cost is "add at least one Lua→2D scene to the studio corpus." The Phase-2 testing strategy includes a `lua-2d-flower` E2E scene specifically to exercise and demonstrate this path.

## Architecture

### Package changes

```text
@yacad/geometry        — add CrossSection type, Geometry discriminated union,
                         alongside existing Mesh and BBox.

@yacad/kernel-manifold — Kernel.evaluateTimed(node, childGeometries): KernelResult.
                         KernelResult.geometry: Geometry replaces .mesh: Mesh.
                         Per-node-type handlers dispatch on node.type, asserting
                         child geometry kinds match the declared input type.

@yacad/cache           — ArtifactKind gains 'crossSection'.
                         New CrossSectionArtifact + CrossSectionLike structural
                         placeholder (mirrors LuaDefinitionLike from Phase 1).

@yacad/dag             — KernelNodeType.output widened to allow
                         (children: readonly Node[]) => GeometryType.
                         buildGraph resolves it once per node instance.
                         Registers 14 new node types (see Node Types).

@yacad/engine          — walk() unchanged in shape; child results are
                         Geometry[] not Mesh[]; cache lookup picks kind from
                         node.outputType. EvaluateResult.mesh is replaced by
                         .geometry: Geometry (callers update accordingly —
                         no two-field backward-compat).

@yacad/render          — three.js viewport learns to render 2D geometry:
                         triangulated fill on XY plane plus polygon outline.
                         View defaults to top-down when the root is 2D.

@yacad/studio          — scene library gains 2D primitive, 2D composite, and
                         Lua-emits-2D example scenes (~6 new entries).
```

Dependency flow unchanged (no new packages, no new edges). The cache's structural placeholder pattern keeps `@yacad/cache` free of geometry-package imports.

### `Geometry` type

```ts
// @yacad/geometry
export interface CrossSection {
  /** One or more closed simple polygons. Outer polygons CCW; holes CW. */
  readonly polygons: ReadonlyArray<ReadonlyArray<Vec2>>;
}

export type Geometry =
  | { readonly kind: '3d'; readonly mesh: Mesh }
  | { readonly kind: '2d'; readonly section: CrossSection };
```

`CrossSection` is the internal serialization-friendly form (plain nested arrays of `Vec2`). The Manifold kernel converts to/from its in-WASM `CrossSection` class on each operation (same pattern `Mesh` ↔ Manifold uses today). `Vec2 = [number, number]` lives in `@yacad/geometry` alongside the existing `Vec3`.

### `KernelNodeType.output` extension

```ts
interface KernelNodeType {
  readonly kind: 'kernel';
  readonly type: string;
  readonly output: GeometryType | ((children: readonly Node[]) => GeometryType);
  checkChildren(children: readonly Node[], path: string): void;
  normalizeParams(params: unknown, path: string): Record<string, unknown>;
}
```

`buildGraph` resolves this at node-construction time:

```ts
const outputType = typeof def.output === 'function' ? def.output(children) : def.output;
```

`Node.outputType` remains a plain `GeometryType` string — downstream consumers see no change.

### Per-instance kind mapping for cache artifacts

```ts
// @yacad/engine — utility used by walk()
function artifactKindFor(geometryType: GeometryType): ArtifactKind {
  return geometryType === '2d' ? 'crossSection' : 'mesh';
}
```

Engine reads `node.outputType` at cache-lookup time, calls `store.get(key, artifactKindFor(node.outputType))`, and unwraps the artifact's payload into `Geometry` for the in-memory pass.

## Node types

14 new node types plus extensions to three existing ones.

### 2D primitives (kernel-backed, `output: '2d'`, no children)

- **`circle`** — `{ radius: number, segments?: number }`. Segments default via Manifold's `getCircularSegments(radius)`.
- **`rectangle`** — `{ size: [x, y], center?: false }`. Centered or origin-anchored same as `box`.
- **`polygon`** — `{ points: [[x, y], ...] }`. One closed simple polygon, ≥3 points. CCW convention; loader auto-reverses CW input.
- **`spline`** — `{ points: [[x, y], ...], segmentsPerCurve?: 16, tension?: 0.5 }`. Catmull-Rom interpolation, closed loop. Tessellation deterministic given params.

### 2D-only transforms (kernel-backed, `output: '2d'`, one 2D child)

- **`translate_2d`** — `{ offset: [x, y] }`.
- **`rotate_2d`** — `{ angle: number }` (degrees).

### Type-overloaded ops (kernel-backed, `output: (c) => c[0].outputType`)

- **`union`** — extension. Now accepts ≥1 children, all same type (all 2D or all 3D).
- **`difference`** — extension. Same.
- **`intersection`** — new. ≥2 children, all same type.
- **`hull`** — new. ≥1 children, all same type. Convex hull.

For all four: `checkChildren` asserts all children have the same `outputType` and rejects mixed-dimension lists with a clear path-annotated message.

### 2D→3D bridges (kernel-backed, `output: '3d'`, one 2D child)

- **`extrude`** — `{ height: number, twist?: 0, scaleTop?: [1, 1], segments?: 1 }`. Lifts the 2D region along +Z. `segments` controls Z-axis subdivisions (relevant when twist ≠ 0 or `scaleTop` is non-uniform).
- **`revolve`** — `{ axis: 'y' | 'x', segments?: number, degrees?: 360 }`. Sweeps the 2D region around the chosen axis. Input must lie entirely on the non-negative side of the axis (kernel guard).

### 2D refinement (kernel-backed, `output: '2d'`, one 2D child)

- **`offset_2d`** — `{ delta: number, joinType?: 'round' | 'square' | 'miter', miterLimit?: 2, segments?: 16 }`. Positive `delta` grows; negative shrinks. `joinType: 'round'` is the prismatic-fillet primitive. `segments` controls roundness on circular joins.

### 3D refinement (kernel-backed, `output: '3d'`, one 3D child)

- **`refine`** — `{ n?: number, maxEdgeLength?: number }`. Exactly one of the two must be set. `n` subdivides each triangle edge into n; `maxEdgeLength` refines until no edge exceeds the target.

## Data flow

### Authoring

1. User constructs a document with any mix of 2D and 3D node types. Type discipline is enforced at `buildGraph` time.
2. For Lua-driven 2D shapes: user defines a `LuaDefinition` with `schema.output: '2d'`; the Lua code emits 2D primitives via the auto-generated `geo.circle`, `geo.polygon`, etc. Studio synchronizes the definition to the worker via `putLuaDefinition` (Phase 1 mechanism, unchanged).

### Evaluation

1. `Engine.walk` reaches a node, computes its hash, looks up via `store.get(key, artifactKindFor(node.outputType))`.
2. On hit: return the cached `Geometry`.
3. On miss for a kernel-backed node: recursively walk children to `Geometry[]`, invoke `kernel.evaluateTimed(node, childGeometries)`, store the result under the appropriate `ArtifactKind`, return.
4. On miss for an expandable node: call `def.expand(...)`, resolve `__input_ref` sentinels by name (unchanged from Phase 1), `buildGraph` the result with the resolver, recursively walk. Cache write keyed on the outer node's hash and `artifactKindFor(node.outputType)`.

### Kernel dispatch

`ManifoldKernel.evaluateTimed`'s `node.type` switch grows handlers for each new node type. Each handler:

1. Asserts `childGeometries.length` matches expected arity.
2. Asserts each child's `kind` matches expected dimension; throws `KernelError` if not (should never fire — `buildGraph` already validated).
3. Imports each child into Manifold's WASM space (`Mesh` ↔ `Manifold` object; `CrossSection` polygons ↔ `CrossSection` object). Tracked as `importMs`.
4. Runs the operation. Tracked as `opMs`.
5. Exports the result to JS. Tracked as `exportMs`.
6. Returns `{ geometry, timings }`.

Existing seven node types: handlers untouched.

### Spline tessellation

In-kernel-package, JS-only (no Manifold call):

```ts
function tessellateSpline(points: Vec2[], segmentsPerCurve: number, tension: number): CrossSection {
  // For each pair (P[i], P[i+1]) with neighbors P[i-1], P[i+2] (wrapping for closure),
  // emit `segmentsPerCurve` interpolated points via the Catmull-Rom formula.
  // Concatenate, drop the wrap-duplicate, return a single CCW polygon CrossSection.
}
```

Pure function of `(points, segmentsPerCurve, tension)`. Deterministic. The kernel handler for `spline` calls this and wraps the result in a `Geometry`.

### Studio rendering

The renderer (`@yacad/render`) gains a `renderGeometry(geometry: Geometry): Object3D` entry point. Internally:

- 3D: existing `Mesh → BufferGeometry → Mesh(material)` path.
- 2D: triangulate the polygon via Manifold's `triangulate(polygons)` (cheap; runs on the main thread, no WASM call), build a flat `BufferGeometry` on the XY plane, render as a half-transparent fill plus a polyline outline. Camera defaults to a top-down preset when the root output is 2D.

## Error handling

Three failure surfaces, all with existing handler classes (no new error types needed):

### Build-time (`buildGraph`) — `DagError`

- Wrong child arity for any new node type.
- Wrong child output type (e.g., `extrude`'s child not 2D).
- Mixed-dimension children to a type-overloaded op (`union(box, circle)` rejected).
- Spline `points.length < 3`.
- Polygon `points.length < 3`.
- `refine` with both `n` and `maxEdgeLength`, or with neither.
- `revolve` with invalid `axis` (only `'y'` and `'x'` accepted).

### Kernel-time — `KernelError` (existing class)

- Manifold rejects degenerate input (self-intersecting polygon, empty cross-section, NaN/Infinity coordinates).
- `revolve` with input on the wrong side of the axis. Hint: "translate the input to non-negative coordinates on the axis you're revolving around."
- `offset_2d` shrinking a shape past its inradius produces an empty `CrossSection`. Not an error — downstream `extrude` of an empty section produces an empty mesh, which is a valid (if useless) result.

### Expansion-time — unchanged from Phase 1

- `LuaError{phase:'output'}` wraps `DagError` if a Lua-emitted sub-DAG fails build validation.
- A LuaNode declaring `schema.output: '2d'` whose code returns a 3D node fails the existing `outputType` check on the resolved sub-root.

### Engine isolation

Per-node failure isolation from Phase 1 (scoped to expandable nodes) applies unchanged. Kernel-node failures continue to throw out of `walk` and root-wrapped as `EvaluationError`.

## Testing strategy

Mirrors the Phase 1 pattern.

### Unit tests in `@yacad/geometry`

- `CrossSection` round-trip through `postMessage`-equivalent structured-clone (deep equality).
- `Vec2` accessor utilities (parity with existing `Vec3`).

### Unit tests in `@yacad/dag`

- New per-instance `output: (children) => GeometryType` form: `buildGraph` produces correct `Node.outputType` for overloaded ops.
- Each new node type: positive arity + type cases; negative cases with path-annotated `DagError`.
- Type-overloaded ops reject mixed-dimension children with a clear error.
- Spline rejects `points.length < 3`.

### Unit tests in `@yacad/kernel-manifold`

- Each 2D primitive produces a non-empty `CrossSection` with sane bounds.
- `extrude(rectangle(10x10), height=5)` → mesh volume ≈ 500 (area × height).
- `revolve(circle at +x offset 10, radius 1, 360°)` → torus-equivalent (Euler χ = 0).
- `offset_2d` with `joinType: 'round'` on a rectangle produces a rounded-corner shape (vertex count > original).
- Spline tessellation determinism: same inputs → byte-identical `CrossSection.polygons` across runs.
- `refine(n=2)` on a box produces 4× the triangle count of the original (each tri split into 4).

### Engine integration tests

- Cache hit on second evaluation of a 2D-only graph (`extrude(circle)`).
- Mixed pipeline: LuaNode with `output: '2d'` emits a `polygon`, wrapping `extrude` produces a 3D mesh. Inner cache hits on Lua-output match.
- Type-discriminated cache isolation: two synthetic nodes with colliding `semanticHash` but different `outputType` end up in distinct `ArtifactKind` buckets (no false sharing).

### E2E scenes (`packages/e2e/scenes/`)

- `2d/circle.json`, `2d/spline-star.json`, `2d/rounded-rect.json` (rectangle + offset_2d with round join).
- `composite/extruded-gear.json` — literal gear profile: `union(circle, polygon-teeth)` → `extrude`. Replaces Phase 1's procedural-Lua gear with a declarative version.
- `composite/revolved-vase.json` — spline-defined profile revolved around Y. Demonstrates spline → revolve.
- `composite/lua-2d-flower.json` — Lua with `schema.output: '2d'` emits a many-petaled flower polygon; outer `extrude` lifts to 3D. Demonstrates Lua→2D first-class composition.

### Studio Playwright (smoke)

- Load a 2D-root scene, assert the viewport renders (canvas non-empty).
- Load `lua-2d-flower`, switch to a 3D scene, switch back — renderer survives type transitions.

### Perf guards

Land in `bench/perf.test.ts` alongside the Phase 1 LuaNode guards:

- 2D-only cold path: `extrude(spline(N=64 points))` under a calibrated bound (initial: ≤500 ms loose; tightened after observation).
- Warm path: same scene, second evaluation under bound matching 3D warm path (≤20 ms).
- Lua→2D→extrude cold vs warm. Verifies the two-level cache from Phase 1 still works across the type boundary.

Two-pass calibration: loose initial commit, tighten to ~1.5× observed in a follow-up commit.

## Open questions

- **Camera preset for 2D-root viewports.** Top-down (`xy` plane facing camera) is the obvious default. If a 3D-root scene later contains a 2D sub-tree (e.g., inspector showing the input to an `extrude`), the viewport stays in 3D mode. Inspector-side hover-preview of intermediate 2D geometry is a future feature.
- **Polygon orientation auto-correction.** Manifold expects CCW outer polygons. The plan does auto-reversal in the `polygon` node-type's `normalizeParams`. Whether to ALSO auto-detect and reverse spline-generated polygons (which depend on control-point order) is a Phase 3 nicety.
- **Vec2 location.** Lives in `@yacad/geometry` alongside `Vec3`. The `Vec3` type currently lives in `@yacad/dag/types.ts` for historical reasons (introduced before `@yacad/geometry` existed). Moving `Vec3` to `@yacad/geometry` and re-exporting from `@yacad/dag` is a clean follow-up; doing it as part of this phase is reasonable but not required.
- **`hull` for mixed dimensions.** `hull` of a 2D set and a 3D set is undefined here. The type-overloaded contract rejects mixed children. If a future use case needs "convex hull of a 2D shape projected into 3D space," that's a separate node type, not an extension of `hull`.
