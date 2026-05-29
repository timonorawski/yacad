# Lua input introspection — design exploration

**Status**: exploration, not approved. No implementation commitment.
**Date**: 2026-05-29
**Scope**: Map the design space for letting Lua expandable nodes read evaluated properties (bbox, edges, mesh) of their inputs. Surfaces architectural tensions, proposes a coherent shape, leaves the final calls to the user.

## Context

Three threads point at the same gap:

1. The [LuaNode spec](2026-05-27-luanode-design.md)'s "Computed properties on `InputRef` (bbox, etc.)" deferred item: today only `outputType()` is sync-available; `bbox()` and beyond are anticipated but unimplemented.
2. The [fillet/chamfer decomposition spec](2026-05-29-fillet-chamfer-decomposition-design.md) shipped two known-edge scenes and explicitly punted the **derived-edge** case (filleting the intersection curve of two booleaned cylinders) to "the evaluator follow-up."
3. The roadmap's "BREP fillets" item is the OCCT escape hatch — but if Lua can read upstream geometry, many "BREP-required" operations become tractable in Manifold via composition.

Closing the gap unlocks a class of mesh-aware operations expressible as Lua: fillet/chamfer on derived edges, curvature-driven smoothing, color-by-curvature, anywhere-you-need-the-mesh-to-decide-something.

## The shape of the problem

Today's flow:

```
buildGraph → engine.walk → for each expandable node:
                              expand(params, [opaque InputRef]) → sub-DAG
                              engine walks sub-DAG, evaluates inputs lazily
```

What we want:

```
buildGraph → engine.walk → for each expandable node:
                              [pre-evaluate declared-introspected inputs]
                              expand(params, [InputRef-with-mesh-data]) → sub-DAG
                              engine walks sub-DAG, evaluates remaining inputs lazily
```

The key word is **declared**. The engine needs to know which inputs to pre-evaluate before calling `expand`, so the call signature stays synchronous and the cost is honest.

## Motivating scene (the test the follow-up should ship with)

```
filleted_intersection(
  body = difference(
    cylinder(r=10, h=30),
    translate({offset=[5,0,0]}, cylinder(r=10, h=30))
  ),
  radius = 1.5
)
```

The fillet's Lua reads `inputs.body:edges(threshold=30°)` — a list of sharp-edge polylines extracted from the difference result — packs them into `values.edges`, and emits a `warp` that pushes nearby vertices toward the rolling-ball fillet surface along each edge.

Until this scene works, the evaluator follow-up isn't done.

## The subtree-closure invariant

Before any other design discussion: the architectural commitment that makes input introspection sound is **the evaluator's universe of accessible data is exactly the subtree rooted at the LuaNode**. Anything that affects `expand`'s output must be transitively reachable via the LuaNode's hash — `LuaNode.hash = hash(type, canonical(params), child_hashes)`.

This is a refinement of CLAUDE.md invariant #2 (determinism) for the input-introspection case. Without it, introspection silently breaks the Merkle cache: a LuaNode whose output depends on something not in its hash would produce different meshes for the same hash, poisoning every consumer.

### What it permits

Inside `expand`, the Lua may read any function of:
- `params` (the LuaNode's own params, in the hash)
- `inputs[i]` (children, whose hashes are in the LuaNode's hash)
- Anything **transitively** derivable from a child's mesh — bbox, edges, in-future mesh data, surface area, anything the kernel can compute from `(child_mesh, explicit_args)`

### What it forbids

- Reading from sibling or cousin nodes (peers in the parent's children list, or anywhere else in the DAG)
- Querying the engine's evaluation cache for arbitrary hashes
- Observing ambient state (wall-clock, RNG without seed, environment, network, the validator's own state)
- Reading from any LuaDefinition other than the one whose code is currently executing
- Mutating shared state visible to other expands

The Lua sandbox already enforces most of these (no `os`/`io`/`time`/`require`). The new surface (`InputRef.bbox()`, `InputRef.edges()`) must uphold the rest **by construction of the API**.

### How the proposed API design upholds it

1. **`InputRef` is the sole exposure of geometric data to Lua.** No alternate path to mesh information exists in the sandbox.
2. **Every `InputRef` method is a pure function of `(input_mesh, explicit_args)`.** No closure over engine state, no I/O, no time.
3. **Each `InputRef` instance is bound to a single child of the current expand call.** Constructed by the engine from `expand`'s declared inputs; never given access to other nodes' refs.
4. **The schema declaration (`needsEvaluated`) is content-addressed.** It's part of the LuaDefinition's canonical bytes; changing it changes `definitionHash`; changing that changes the LuaNode's hash.

### Algorithm versioning is NOT a violation (but needs handling)

If `extractSharpEdges` itself changes (we fix a bug, update the threshold semantics), the same `(input_mesh, threshold)` produces different edges. The LuaNode's `semantic_hash` is unchanged but the actual mesh emitted differs across yacad versions.

This is the same situation as a kernel-version change, and the same mitigation applies: include the introspection algorithm version in `produced_by` (alongside `kernel_version` and `engine_version`). Different versions cache separately under the same `semantic_hash`. The semantic hash correctly identifies "this is the same logical fillet"; the structured key distinguishes "produced by yacad V1 vs V2."

This means: when introspection algorithms ship behavioral changes, the version dimension MUST bump. Backward-compatible algorithm changes (same outputs, just faster) leave the version unchanged.

### Review-time guard

Every new `InputRef` method proposed in a future spec must show:

1. **Purity proof**: the method is `f(input_mesh, explicit_args)`, no closure over anything else.
2. **Version bookkeeping**: changes to the implementation that alter outputs bump the introspection algorithm version.
3. **No back-channels**: the method doesn't write to or read from any state shared across `expand` calls.

This is a code-review discipline, not a runtime check. The current `bbox()` and `edges(threshold)` proposals both pass these checks trivially because they're stateless pure functions of the mesh.

### What this rules out as a future direction

A method like `InputRef.snapshot()` that returns a "current mesh state" handle the user can hold across calls — that would violate purity (the state could change). Similarly, any "view the engine's current cache state from Lua" API is structurally rejected by this invariant.

If we ever want such capabilities (e.g., for performance instrumentation), they live OUTSIDE the expandable-node-evaluation path — not inside Lua's `expand`.

## Architectural tensions

Each tension has options and a recommendation. The recommendations cohere into a single design (see [§Recommended shape](#recommended-shape)).

### 1. Sync API vs async API in Lua

Wasmoon supports async via coroutines, but Lua semantics around async are awkward (`coroutine.yield` patterns leak into user code). The alternative is **schema-declared pre-evaluation**: the LuaDefinition declares which inputs need to be evaluated before `expand` runs, the engine evaluates them upfront, and the Lua code sees plain data synchronously.

**Recommended**: schema-declared pre-evaluation. Lua stays simple, the engine has all the info it needs to schedule, and the cost is visible in the LuaDefinition rather than hidden in an async dance.

### 2. Where the declaration lives

If pre-eval is schema-driven, where does the schema flag live?

- **(a)** `LuaInputDecl.needsEvaluated?: boolean` — per-input flag in the LuaDefinition schema.
- **(b)** `ExpandableNodeType.inputNeedsEvaluated(params, resolver, name): boolean` — runtime callback on the node type.

Option (a) is content-addressed (part of the LuaDefinition's hash) and statically inspectable. Option (b) is more flexible (can depend on params) but obscures the cost.

**Recommended**: (a). Concreteness over flexibility. If a future use case needs param-dependent pre-eval, lift to (b) at that point.

### 3. API granularity — what does the Lua see?

Three layers of granularity:

- **bbox**: 6 numbers (xmin, ymin, zmin, xmax, ymax, zmax). Tiny. Trivially cacheable. Lua sees `inputs.body:bbox() → {min={x,y,z}, max={x,y,z}}`.
- **edges**: list of sharp-edge polylines with face-angle metadata. Medium-sized (10–1000s of vertices typically). Lua sees `inputs.body:edges(thresholdDegrees) → [[{x,y,z}, ...], ...]`.
- **mesh**: raw vertex + index arrays. Potentially large. Lua sees `inputs.body:mesh() → {vertices, indices}` (likely as Lua tables, slow to manipulate).

**Recommended**: ship `bbox()` and `edges()`; defer `mesh()` until a use case demands raw access. The first two cover the deferred LuaNode spec item AND the fillet-on-derived-edge demo without exposing the full mesh blast radius to Lua.

### 4. Where mesh analysis lives

`extractSharpEdges(mesh, thresholdDegrees)` and `boundingBox(mesh)` are kernel-adjacent operations. Three candidate homes:

- **`@yacad/kernel-manifold`**: Manifold has built-in face/vertex topology data. Edge extraction is essentially free given Manifold's mesh representation. But couples mesh analysis to one kernel.
- **A new `@yacad/mesh-analyze` package**: kernel-independent algorithms operating on `@yacad/geometry`'s `Mesh` type. Cleaner separation, but a second copy of topology logic that Manifold already has.
- **In `@yacad/engine`**: as evaluators alongside the kernel.

**Recommended**: `@yacad/kernel-manifold` for now. The duplication argument is hypothetical (OCCT integration is far away), and Manifold's topology data is the load-bearing input. When OCCT or another kernel arrives, factor out at that point — the interface `extractSharpEdges(mesh, threshold) → SharpEdgeSet` is small and rehome-able.

### 5. Cache artifact kinds

Today: `Artifact = {kind: 'mesh'} | {kind: 'bbox'} | {kind: 'luaDefinition'}`.

`bbox` is already in the union (deferred in the LuaNode spec, planned but unimplemented as a cache artifact). `edges` would add `{kind: 'edges', edges: SharpEdgeSet}`.

The structured cache key already accommodates: same `semantic_hash`, different `produced_by.quality_tier` or a new dimension. Or just key the edge artifact by `{semantic_hash, produced_by: {…, kind: 'edges'}}` — minor structural addition.

**Recommended**: extend `Artifact` with `edges`. Reuse the structured-key mechanism cleanly. `bbox` ships at the same time since the deferred LuaNode item names it.

### 6. The InputRef interface

Today (`@yacad/dag/registry.ts`):

```ts
interface InputRef {
  readonly name: string;
  readonly type: GeometryType;
  outputType(): GeometryType;
}
```

Extension:

```ts
interface InputRef {
  readonly name: string;
  readonly type: GeometryType;
  outputType(): GeometryType;
  // NEW — only callable when the input was declared with needsEvaluated=true.
  // Throws if the input wasn't pre-evaluated (defensive — should never fire
  // if the LuaDefinition schema is honest).
  bbox(): BBox;
  edges(thresholdDegrees?: number): SharpEdgeSet;
}
```

**Recommended**: extend `InputRef` minimally. Two new methods, `bbox` and `edges`, both sync. The "throws if not pre-evaluated" guard is a runtime safety net for misdeclared schemas.

### 7. Recursive evaluator nodes

If a fillet's input is itself a Lua node that does mesh introspection, the chain has to evaluate inside-out. The engine's existing depth-first walk already handles this — `inputs.body` is evaluated to a mesh before the outer expand runs, regardless of how that mesh was produced.

**No new mechanism needed.** This works for free with the schema-declared pre-eval pattern.

### 8. Determinism guarantees

Architectural invariant #2: deterministic evaluation. If a Lua node reads mesh data, its behavior depends on that data. Same child hash → same mesh → same Lua behavior. The system stays deterministic.

But: **floating-point comparisons on mesh data are a footgun.** A Lua node that compares vertex coords with `==` or thresholds at `< 1e-9` could produce subtly different sub-DAGs across kernel versions or minor numerical changes. The Lua source itself doesn't change, but the mesh might shift by an epsilon.

**Recommended**: document the footgun in the spec; defer enforcement. Optional future: a "deterministic comparison" helper in the sandbox that rounds to a fixed-precision grid before comparing.

### 9. Performance — eager eval breaks lazy story selectively

The current lazy story: an emitted sub-DAG that doesn't use `inputs.foo` doesn't trigger foo's evaluation. With introspection, declaring `needsEvaluated` on an input forces evaluation regardless.

This is a per-LuaDefinition opt-in. A LuaDefinition that doesn't declare any introspection is unchanged from today.

**Recommended**: accept the loss. The schema-driven declaration makes the cost explicit. Optional future optimization: skip the introspection if the sub-DAG turns out not to use `inputs.foo` at all — but this requires post-hoc analysis of the emitted sub-DAG, which is complicated for marginal gain.

### 10. Failure handling

What if the upstream input fails to evaluate? Today, an evaluation failure aborts the engine walk. With introspection: same — if `inputs.body` fails to evaluate, the outer LuaNode can't run.

**Recommended**: existing engine error propagation handles this. Document it in the spec.

### 11. Generalization to non-Lua expandable types

`ExpandableNodeType` is the abstract layer (`@yacad/dag`); `LuaNode` is one concrete implementation. The introspection capability should live at the `ExpandableNodeType` level so future expandable types (JS code nodes, ML generators, hand-rolled TS procedural nodes per the LuaNode spec's forward-looking notes) get it too.

The schema declaration (`needsEvaluated`) is Lua-specific (it's on `LuaInputDecl`), but the engine-side machinery (pre-evaluate declared inputs, hand the evaluated geometries to `expand`) is at the abstract layer.

**Recommended**: add `evaluatedInputs(params, resolver) → string[]` to `ExpandableNodeType` returning the names of inputs that need pre-eval. `makeLuaNodeType` implements it by reading the LuaDefinition's `needsEvaluated` flags. Future expandable types implement it however they like.

### 12. `inputs.foo:bbox()` vs `inputs.foo:edges()` API consistency

Both are computed properties on `InputRef`. They share infrastructure:

- Both require the input to be pre-evaluated (declared `needsEvaluated`).
- Both produce a cached artifact under the input's semantic hash with `produced_by.kind` differing.
- Both are sync in Lua.

`bbox()` takes no args (it's a property of the mesh). `edges(thresholdDegrees)` takes an arg — the angle threshold above which an edge is "sharp."

**Threshold as part of the cache key**: a different threshold = a different cached `SharpEdgeSet`. Trivial to fold into the structured key by including threshold in `produced_by`.

## Recommended shape

Synthesizing the tensions above, under the [subtree-closure invariant](#the-subtree-closure-invariant):

### Architecture

```text
LuaDefinition.schema.inputs[*].needsEvaluated  — declaration (content-addressed)
                                       │
                                       ▼
ExpandableNodeType.evaluatedInputs(params, resolver) → string[]  — generic surface
                                       │
                                       ▼
Engine.walk: when entering an expandable node, evaluate the named inputs to
             Geometry first, build evaluated-InputRef objects, then call expand
                                       │
                                       ▼
InputRef.{bbox, edges}() — sync, backed by cached artifacts from kernel-manifold
                                       │
                                       ▼
Lua sees plain tables; emits warp whose values include the introspected data
```

### Public surface (concrete)

```ts
// @yacad/dag
export interface LuaInputDecl {
  readonly name: string;
  readonly type: GeometryType;
  readonly optional?: boolean;
  /** Forces engine pre-evaluation. The Lua code may call inputs[name]:bbox() /
   *  :edges() / future mesh-derived methods. Default false. */
  readonly needsEvaluated?: boolean;
}

export interface BBox {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

export interface SharpEdgeSegment {
  readonly polyline: ReadonlyArray<readonly [number, number, number]>;
  /** Mean dihedral angle of the faces on either side, in degrees. */
  readonly angle: number;
}
export type SharpEdgeSet = readonly SharpEdgeSegment[];

export interface InputRef {
  readonly name: string;
  readonly type: GeometryType;
  outputType(): GeometryType;
  /** Throws if not pre-evaluated (schema didn't declare needsEvaluated). */
  bbox(): BBox;
  edges(thresholdDegrees?: number): SharpEdgeSet;
}

export interface ExpandableNodeType {
  // ... existing fields ...
  /** Names of inputs the engine must evaluate before calling expand. */
  evaluatedInputs(params: Record<string, unknown>, resolver: DefinitionResolver): readonly string[];
}
```

### Cache artifact extensions

```ts
// @yacad/cache (or wherever the Artifact union lives)
export type Artifact =
  | { readonly kind: 'mesh'; readonly mesh: Mesh }
  | { readonly kind: 'bbox'; readonly bbox: BBox }
  | { readonly kind: 'edges'; readonly thresholdDegrees: number; readonly edges: SharpEdgeSet }
  | { readonly kind: 'luaDefinition'; readonly definition: LuaDefinition };
```

The structured cache key carries `produced_by.kind` to distinguish artifacts under the same `semantic_hash`. `edges` additionally carries `threshold` in the structured key so different thresholds cache independently.

### Mesh analysis

A new module `packages/kernel-manifold/src/mesh-analyze.ts` exporting:

```ts
export function extractBBox(mesh: Mesh): BBox;
export function extractSharpEdges(mesh: Mesh, thresholdDegrees: number): SharpEdgeSet;
```

Both implemented against Manifold's topology data. When a second kernel arrives, factor out into `@yacad/mesh-analyze`.

### Engine changes

`Engine.walk`, when entering an expandable node:

1. Call `def.evaluatedInputs(params, resolver)` to get the names of inputs needing pre-eval.
2. For each, recursively walk the corresponding child to a `Geometry`, then compute bbox + (lazily) edges.
3. Build the `InputRef` objects with the computed properties bound.
4. Call `def.expand(params, inputRefs)` as today.
5. The returned sub-DAG is built + walked as today.

The lazy story is preserved for **inputs not in the `evaluatedInputs` list** — they remain opaque references that the sub-DAG may or may not use.

### Lua-side surface

```lua
-- inside a fillet-on-edge LuaDefinition:
local edges = inputs.body:edges(30)  -- 30° dihedral threshold
local edgeData = {}
for i, seg in ipairs(edges) do
  edgeData[i] = { angle = seg.angle, points = seg.polyline }
end

return geo.warp(
  {
    code = WARP_FILLET_CODE,
    values = { edges = edgeData, radius = params.radius },
  },
  { inputs.body }
)
```

## Open questions for the user

These are the calls I'd want you to make before this becomes a spec:

1. **Granularity scope for v1**: ship `bbox()` only? `bbox()` + `edges()`? Add `mesh()` too? My recommendation is `bbox()` + `edges()` — covers the LuaNode-spec deferred item and the motivating scene.
2. **`SharpEdgeSet` shape**: polylines (recommended) or raw edge segments (pair-of-vertices + adjacency)? Polylines are easier for the warp callback; raw segments give more flexibility but push reconstruction work into every consumer.
3. **`edges()` threshold default**: 30°? 45°? Or required, no default? I lean 30° (matches common CAD conventions) but no strong opinion.
4. **Mesh-analyze package boundary now or later?** I recommend later (keep in `kernel-manifold` for v1) — but if you'd rather have the separation up front for invariant-#7 cleanliness, the factor-out is small.
5. **Determinism / floating-point footgun**: document only, or enforce via a sandbox helper? Document is what we've done so far for other footguns (no clock, no I/O, seeded RNG); a comparison-rounding helper would be a deliberate addition.
6. **Naming**: "InputRef introspection" / "evaluated inputs" / "input properties" — pick one term and use it consistently. The fillet/chamfer spec called this "the evaluator capability" which collides with `WarpEvaluator`. I prefer **"input introspection"**.
7. **Motivating scene placement**: the filleted-intersection scene as a third exploratory showcase (alongside chamfered-box, filleted-slab)? Or just an `eval.test.ts` end-to-end fixture without a doc-picker entry? I lean toward a full showcase since this is the headline demo for the technique.
8. **Promote subtree-closure to CLAUDE.md?** It's a refinement of invariant #2 specific to expandable-node introspection. If we expect this pattern to recur (JS code nodes, ML generators, etc.), it deserves explicit invariant status in CLAUDE.md so future contributors don't accidentally weaken it. If you'd rather keep CLAUDE.md focused on the load-bearing original nine, this stays a per-spec architectural commitment.

## What this exploration does NOT decide

- Implementation order (which package first, test sequence).
- Whether to land `bbox()` and `edges()` in one spec or two.
- The exact threshold semantics for "sharp edge" (mean dihedral vs max? face-pair angles vs polyline curvature?).
- UI/inspector treatment of `needsEvaluated` declarations.
- Whether the studio2 inspector should show "this input is pre-evaluated" as a visual cue.

These are decision points for the actual spec.

## How this fits the project's invariants

- **#1 DAG is truth**: unchanged. Introspection reads cached artifacts; doesn't mutate.
- **#2 Determinism**: preserved by construction. The new [subtree-closure invariant](#the-subtree-closure-invariant) is the input-introspection refinement of this — the Lua's accessible universe is exactly the LuaNode's hash closure. Floating-point footgun documented.
- **#3 Structured cache keys**: extended cleanly with `produced_by.kind: 'edges'`. The introspection algorithm version is part of `produced_by` (alongside `kernel_version`, `engine_version`) so behavioral algorithm changes cache separately under the same `semantic_hash`.
- **#4 Canonical params**: introspection results travel through `values` (free-form record); canonical serialization handles them.
- **#5 Code is first-class**: this generalizes the existing LuaNode mechanism; no new authoring mode.
- **#6 Dual type system**: unchanged.
- **#7 Manifold primary kernel**: mesh-analyze stays in `kernel-manifold`; OCCT escape hatch path remains open.
- **#8 Scope discipline**: deliberately narrow — bbox + edges, not full mesh; one motivating scene to ship.
- **#9 Existing CAD projects as test corpora**: edge detection from arbitrary boolean intersections is exactly the kind of operation OpenSCAD users complain they can't easily do; the motivating scene becomes a forum-grade test case.
