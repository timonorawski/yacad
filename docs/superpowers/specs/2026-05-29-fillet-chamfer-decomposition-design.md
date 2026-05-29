# Fillet / chamfer via boolean composition (exploratory)

**Status**: design approved 2026-05-29. Implementation pending.
**Date**: 2026-05-29
**Scope**: Two new showcase scenes — `chamfered-box` and `filleted-slab` — demonstrating that fillet and chamfer operations can be expressed as compositions of existing Manifold-backed ops (`difference`, `union`, `offset_2d`, `extrude`, `warp`) for cases where the affected edges are known at authoring time. Marked as exploratory experiments. These scenes test the architectural claim that BREP is not strictly required for fillet/chamfer in the common case.

## Context

Architectural invariant #7 in `CLAUDE.md` positions OCCT.js as "the escape hatch for BREP operations (real fillets, lofts, sweeps, NURBS surfaces)." `docs/vision.md` specifically calls out BREP fillets as the canonical OCCT use case.

This experiment tests a counterclaim: for shapes whose edges are _known at authoring time_ (any pure composition of primitives), fillet and chamfer reduce to existing operations. If the experiments validate the claim, the OCCT-integration story shifts from "needed for fillets" to "needed only when filleting arbitrary derived edges from imported meshes or kernel-produced intersections."

These scenes are deliberately limited to known-edge cases. The harder problem — fillet/chamfer of _derived_ edges (e.g., the intersection curve of two booleaned cylinders) — is deferred to a follow-up spec that introduces the **evaluator** capability: a Lua function that inspects child meshes to prepare warp `values`. The asymmetry is laid out below; the evaluator follow-up is in [§Open questions](#open-questions).

## Goals

- Ship two pure-Lua showcase scenes (`chamfered-box`, `filleted-slab`) using only existing operations.
- Demonstrate boolean composition for chamfers (Scene 1).
- Demonstrate `offset_2d(round)` + `extrude` + `warp` composition for fillets on extrusion-based shapes (Scene 2).
- Cover both via the existing showcase pattern (`packages/e2e/showcase/<name>/` with README + `index.ts` builder + `index.test.ts`).
- Label them as exploratory experiments in their READMEs and in the studio's document picker, not as canonical/production techniques.

## Non-goals

- **Fillet/chamfer on derived edges.** Boolean intersection edges, imported-mesh edges, etc. require an evaluator capability that inspects mesh data from Lua. Deferred to a follow-up spec.
- **A new kernel node type for fillet or chamfer.** These scenes use only existing ops. No `fillet` / `chamfer` registry entry is introduced. If the experiments prove the technique broadly viable, a follow-up could lift the patterns into reusable LuaDefinitions, but not into the kernel.
- **The evaluator capability itself.** Tracked separately. This spec stops at the architectural boundary.
- **Mesh edge detection.** Not exposed to Lua. The chamfered-box hardcodes its edge list from bbox params.
- **Fillet of arbitrary 3D edges.** Even the `filleted-slab` only fillets the box-aligned vertical and horizontal edges, not arbitrary 3D edges.

## Decisions and rationale

### Known-edge vs derived-edge asymmetry

The simplest fillet/chamfer cases don't need mesh inspection because the edges are knowable from the authoring code. For a box-shaped chamfer, the 12 edges are deterministic from the box dimensions. For a slab's corner fillet, the corner positions come from the source rectangle. These are the cases this spec targets.

The harder case — fillet on an edge that _emerges_ from kernel evaluation (boolean intersections, imported meshes) — requires a Lua-callable that can read mesh data after upstream evaluation completes. _Rejected_ approach: build the evaluator now and demonstrate all three cases together. Cost: bigger spec, an architectural call (per-warp `prepare` callback vs. general `inputs.foo.mesh()` properties) that should be made carefully. _Chosen_ approach: ship the known-edge scenes first to validate the broader claim cheaply, then design the evaluator informed by what these scenes actually need.

### Both scenes are Lua expandable nodes, not new kernel types

Each scene is built as a `LuaDefinition` whose `expand()` emits the appropriate sub-DAG. No `chamfer` or `fillet` kernel node is registered. _Why:_ the experiments are demonstrating that the _existing_ ops suffice; adding a kernel node would obscure that claim. Future productionization could promote validated patterns into kernel nodes if round-trip cost matters, but not in this spec.

### Two scenes, not one

The chamfered-box demonstrates pure boolean composition (lowest unknown, no warp math). The filleted-slab adds `offset_2d` + `warp` to demonstrate the full decomposition. Shipping both gives two anchor points along the technique spectrum.

## Architecture

Both scenes follow the showcase pattern established by `house`, `castle`, `tree`, `torus-knot`:

```
packages/e2e/showcase/<name>/
  README.md         — what the scene demonstrates + params
  index.ts          — builds the LuaDefinition + seed function
  index.test.ts     — pipeline test asserting the scene evaluates to a non-empty mesh
                      with stable bbox/hash
```

The seed function (called from `apps/studio2/src/seed-scenes.ts`) creates the document, registers the LuaDefinition blob, and persists the scene with an `Exploratory:` prefix in the name so its experimental status is visible in the document picker.

### Scene 1 — `chamfered-box`

LuaDefinition schema:

```ts
{
  inputs: [],
  params: {
    width:   { type: 'number', default: 50 },
    depth:   { type: 'number', default: 50 },
    height:  { type: 'number', default: 50 },
    chamfer: { type: 'number', default: 5 },
  },
  output: '3d',
}
```

Expansion:

```text
difference(
  box(width, depth, height),
  union(wedge_1, wedge_2, ..., wedge_12)
)
```

A wedge is a right-triangular prism whose right-angle apex sits on a box edge, beveling outward to chamfer-distance `c` on each adjacent face. The hypotenuse becomes the chamfered face after the boolean subtraction. Built per wedge as:

1. A `polygon` with three corners forming a `c × c` right triangle.
2. Extruded along the edge length (the matching box dimension).
3. Rotated to orient the extrusion axis along the edge direction.
4. Translated so the right-angle corner sits at the box's edge.

The 12 edges decompose into three groups of 4:

- **4 vertical edges** (corners of the top/bottom rectangles): extrusion along Z, length `height`.
- **4 top horizontal edges** (top rectangle perimeter): extrusion along X or Y, length `width` or `depth`.
- **4 bottom horizontal edges** (bottom rectangle perimeter): same as top.

The Lua emits these 12 wedges programmatically in nested loops. No per-vertex math; pure transform + boolean.

### Scene 2 — `filleted-slab`

LuaDefinition schema:

```ts
{
  inputs: [],
  params: {
    width:        { type: 'number', default: 60 },
    depth:        { type: 'number', default: 40 },
    height:       { type: 'number', default: 20 },
    cornerRadius: { type: 'number', default: 8  },   // XY corner fillet
    edgeRadius:   { type: 'number', default: 3  },   // top/bottom Z edge fillet
  },
  output: '3d',
}
```

Expansion is staged:

**Stage A — XY corner fillet via `offset_2d`:**

```text
profile = rectangle(width, depth)
profile = offset_2d(profile, delta = -cornerRadius, joinType = 'round')
profile = offset_2d(profile, delta = +cornerRadius, joinType = 'round')
slab    = extrude(profile, height)
```

The `-r` then `+r` pair with round joins is the canonical 2D corner-rounding technique. Manifold's `offset_2d` accepts `joinType: 'round'` (confirmed via `packages/dag/src/registry.ts`). The vertical edges of the slab become quarter-cylinder fillets of radius `cornerRadius`.

**Stage B — Z edge fillet via `warp` (only when `edgeRadius > 0`):**

```text
result = warp(slab,
  code   = <vertex-rolling-ball>,
  values = { edgeRadius, width, depth, height, cornerRadius })
```

The warp callback applies a rolling-ball fillet of radius `edgeRadius` along the top and bottom edges of the slab. The math:

```lua
-- For each vertex (x, y, z):
local r = params.edgeRadius
local h = params.height

-- Distance from the vertex's z to the nearest horizontal face.
local dz_top = h - z
local dz_bot = z

-- Only vertices within `r` of a horizontal face are affected; others pass through.
if dz_top >= r and dz_bot >= r then
  return x, y, z
end

-- Compute the closest point on the rounded-rectangle XY profile analytically
-- (the profile is parameterized by params.width, params.depth, params.cornerRadius).
-- The outward unit normal at that closest point gives the direction to inset.
local nx, ny = profileOutwardNormal(x, y, params)

-- Rolling-ball geometry: at vertical distance `dz` from a horizontal face,
-- the ball touches the side face at an inset of `r - sqrt(r^2 - (r-dz)^2)`.
local dz    = math.min(dz_top, dz_bot)
local inset = r - math.sqrt(r*r - (r - dz)^2)

return x - nx * inset, y - ny * inset, z
```

The `profileOutwardNormal` helper is pure analytic geometry on a rounded rectangle: classify the (x, y) projection into "side strip" (normal is ±X or ±Y) or "corner arc" (normal is the unit vector from the corner-arc center to (x, y)). Implemented as a local Lua function inside the warp `code`.

When `edgeRadius === 0`, Stage B is skipped entirely; the result is the slab with only XY corner fillets.

### Why the filleted-slab previews the evaluator

The warp in Stage B receives `width`, `depth`, `cornerRadius` via `params.values` because it needs to know the XY profile shape to compute the inward normal. This is _passing the construction parameters through_ — the Lua node that builds the slab knows them and forwards them to the warp it generates.

With the evaluator capability (future spec), the warp would instead inspect the slab mesh directly to find outward normals at each vertex. For known-construction cases like this slab, the passed-through-params approach is correct and simpler. The evaluator becomes load-bearing only when the upstream geometry isn't authored by the same Lua node — which is exactly the third (deferred) scene's use case.

## Testing strategy

- **`index.test.ts` per scene** following the existing showcase pattern: build the LuaDefinition, evaluate the document end-to-end through `packages/e2e`'s pipeline harness, assert a non-empty mesh with bbox bounds matching the input params (within tolerance) and a stable semantic hash for the default parameters.
- **Boundary parameter tests** (sanity, not exhaustive):
  - Chamfered box: `chamfer = 0` evaluates without throwing; `chamfer` close to `min(W,D,H)/2` doesn't collapse the geometry.
  - Filleted slab: `cornerRadius = 0` produces a sharp-cornered slab; `edgeRadius = 0` skips Stage B; both within sane bounds.
- **Seeding regression**: extend `apps/studio2/e2e/studio2.spec.ts`'s "app loads and seeds the scene library" coverage to include the two new scenes (they should appear in the document picker without errors).
- **Validator regression coverage** (free): each LuaDefinition exercises `geo.box`, `geo.union`, `geo.difference`, `geo.extrude`, `geo.offset_2d`, `geo.warp`, plus loops and conditional logic. Any future validator change that breaks these patterns will fail the showcase tests.

## Open questions

- **The evaluator follow-up.** Once these scenes are working, the natural next spec designs how Lua nodes inspect upstream mesh data. Two candidate shapes: (a) a per-warp `prepare(meshData) → values` callback (most surgical), or (b) general `inputs.foo.mesh()` / `inputs.foo.edges()` / `inputs.foo.bbox()` properties on the existing `InputRef` interface (most general, aligned with the LuaNode spec's deferred "computed properties on InputRef" item). Decision deferred until these scenes are in hand and we know what shape of data the warp really wants.
- **Productionizing the technique.** If the experiments validate broadly, a future spec could promote `chamferedBox` and `filletedSlab` (and related patterns) into a reusable LuaDefinition library accessible from the studio's add-node picker.
- **Generalization beyond box-aligned profiles.** The corner-fillet trick (`offset_2d(±r, round)`) works for any closed 2D shape; the warp's edge-fillet math assumes a slab geometry. Generalizing to swept profiles, revolutions, or hulls is harder and out of this spec's scope.
- **Whether to chamfer all 12 edges or a subset.** Scene 1 chamfers all 12 for simplicity. A future variant could expose an `edges: 'all' | 'top' | 'vertical'` enum, but that adds UI complexity for an experimental scene; deferred.
