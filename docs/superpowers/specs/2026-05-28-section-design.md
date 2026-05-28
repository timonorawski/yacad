# `section` node design

**Status**: design approved, awaiting implementation plan
**Date**: 2026-05-28
**Scope**: Add a `section` node — the 3D→2D bridge — completing the inverse of `extrude`/`revolve`. Cast an arbitrary plane through a 3D solid and get the resulting `CrossSection`. Smallest CAD-meaningful node-type addition since Phase 2.

## Goals

- Enable section-based workflows: slice a 3D part, use the resulting 2D shape as a profile for further parametric operations (extrude, offset, boolean compose).
- Support arbitrary cut planes (not just axis-aligned) via a point-and-normal plane representation.
- Plug into the existing dual-type-system machinery — no new abstractions, no new artifact kinds. Reuse the Phase 2 `crossSection` artifact.
- Preserve every prior invariant: structured cache keys, deterministic evaluation, canonical hashing, per-node failure isolation for expandable nodes.

## Non-goals (deferred — track in ROADMAP.md)

- **`project` (silhouette projection).** Different semantic from `section` — `project` looks through the solid along an axis and returns the outline. Useful for top/side-view drawings; deferred because section covers the more-common "cross-section as a profile" workflow with one operation.
- **User-controlled output orientation** in the cut plane. After rotating the solid so `normal` becomes +Z, there's a remaining rotational freedom around the new Z axis. v1 uses the shortest-arc convention; explicit "make this edge horizontal" control is future work.
- **Section by an N-gon "punch profile"** (rather than a plane). Equivalent to `intersection(input, extrude(profile, large_height))` — composable from existing primitives.
- **Curved-surface sections** (sectioning along a parametric surface, not a plane). Far future.
- **`trimByPlane`** (Manifold has it — returns the half-space-truncated solid, not a CrossSection). Useful but separate node type; not in scope here.

## Decisions and rationale

### Naming: `section`

CAD convention. Distinct from `project` (silhouette) and from `slice` (which is overloaded with the 3D-printing-slicer software meaning). The output type is `CrossSection` — `section` reads as the verb to that noun.

_Rejected:_ `slice` (overloaded for 3D-printing audience); `cross_section` (redundant — output IS a CrossSection); `project` (means silhouette in CAD, different semantic).

### Plane representation: `{ origin: vec3, normal: vec3 }`

Most general; geometrically natural. `normal` doesn't have to be unit-length — kernel normalizes internally. Zero `normal` is rejected at build time.

_Rejected:_

- **Axis-aligned shortcut + arbitrary fallback** (discriminated union). Two validation paths, two test sets, two places where authors learn the schema. The cost of "verbose for axis-aligned" is one extra `0, 0, 1` per call — acceptable. A higher-layer Lua wrapper or studio template could provide `geo.sectionXY(z, child)` sugar without changing the underlying node-type schema.
- **Plane equation `[a, b, c, d]`** where `ax + by + cz = d`. Compact but unfriendly to author — most people don't think in plane coefficients.

The chosen representation also maps cleanly to a future WYSIWYG gesture: click an anchor point in the viewport, orbit to set the normal direction.

### Implementation: transform-and-slice

The kernel handler:

1. Build rotation Euler angles that map `normal` to `+Z` via the shortest-arc rotation (Rodrigues' formula, axis = `normal × +Z`, angle = `acos(normal · +Z)`).
2. Translate input solid so `origin` maps to `(0, 0, 0)`.
3. Rotate the translated solid by the computed Euler angles.
4. Call `Manifold.slice(0)` — returns the `CrossSection` at z=0 in the rotated frame.

_Rejected:_ a custom mesh-walker that computes triangle-plane intersections directly. More flexibility but reinvents what Manifold gives us; rotate-and-slice is determinism-preserving, well-tested, and one call into the kernel.

### Output orientation: shortest-arc convention

After the rotation, the cut-plane's X and Y axes (in the output `CrossSection`) are determined by the rotation matrix derived from `rotationToAlignWithZ(normal)`. Users don't choose them in v1.

**Edge case: `normal` anti-parallel to `+Z`** (`[0, 0, -1]`). `rotationToAlignWithZ` returns `[180, 0, 0]` (rotate 180° around X). The resulting section is mirrored relative to a `+Z` slice at the same origin — that's mathematically correct (same physical plane, "up" side flipped). Documented in the language reference.

## Architecture

### Package changes

```text
@yacad/dag              — register `section` node type via a new
                          bridge3dTo2d(type, normalizeParams) factory
                          helper (parallel to Phase 2's bridge2dTo3d).

@yacad/kernel-manifold  — new private method `evaluateSection`. New module
                          `plane.ts` with `rotationToAlignWithZ(normal): Vec3`
                          (pure, deterministic, fully unit-testable in
                          isolation from Manifold).

@yacad/cache            — no changes. crossSection artifact already exists
                          (Phase 2).

@yacad/engine           — no changes. Already routes 2D outputs through
                          the crossSection cache kind.

@yacad/render           — no changes. Already renders CrossSection
                          (flat fill + outline on XY plane).

@yacad/lua              — KERNEL_TYPE_DOCS gains a `section` entry; `geo.section`
                          falls out of the existing registry-driven wrapper
                          generation (no @yacad/lua source changes other than
                          the docs descriptor).

@yacad/studio           — example scene(s) added to the sceneLibrary.

packages/e2e/scenes/    — new composite scenes exercising section + extrude
                          and an arbitrary-plane section.
```

Total surface: one new node type, one new factory helper, one new pure-math module. Smallest CAD-meaningful addition since Phase 2.

### `section` node-type signature

```ts
// packages/dag/src/registry.ts (additions)

/** A 3D→2D bridge: exactly one 3D child, 2D output. Parallel to
 *  bridge2dTo3d (extrude/revolve). */
function bridge3dTo2d(
  type: string,
  normalizeParams: KernelNodeType['normalizeParams'],
): KernelNodeType {
  return {
    kind: 'kernel',
    type,
    output: '2d',
    checkChildren(children, path) {
      if (children.length !== 1) {
        throw new DagError(`"${type}" takes exactly one child`, path);
      }
      expectAllOfType(children, '3d', path);
    },
    normalizeParams,
  };
}

// In defs[]:
bridge3dTo2d('section', (params, path) => {
  const p = asRecord(params, path);
  const normal = vec3(p, 'normal', path);
  if (normal[0] === 0 && normal[1] === 0 && normal[2] === 0) {
    throw new DagError('"normal" must be non-zero', path);
  }
  return {
    origin: vec3(p, 'origin', path),
    normal,
  };
}),
```

### Pure-math helper

```ts
// packages/kernel-manifold/src/plane.ts
import type { Vec3 } from '@yacad/geometry';

/**
 * Euler angles [x, y, z] (degrees, applied X→Y→Z per Manifold convention)
 * that map `normal` to +Z via the shortest-arc rotation. Used by `section`
 * to align an arbitrary cut plane with the XY plane at z=0.
 *
 * Pure function — no IO, no randomness. The result is deterministic given
 * a fixed `normal`.
 */
export function rotationToAlignWithZ(normal: Vec3): Vec3;
```

Implementation:

1. Normalize `normal` to a unit vector `(nx, ny, nz)`.
2. If `nz > 1 - ε`, return `[0, 0, 0]` (identity — already aligned).
3. If `nz < -1 + ε`, return `[180, 0, 0]` (anti-parallel — 180° around X).
4. General case: rotation axis = `normal × +Z = (-ny, nx, 0)`, normalized; angle = `acos(nz)`.
5. Convert axis-angle to Euler XYZ (degrees) via the standard Rodrigues→Euler formula. Result returned in degrees to match the existing `rotate` node's convention.

`ε` is `1e-12` — guard against numerical noise at the boundary cases.

### Kernel handler

```ts
// packages/kernel-manifold/src/kernel.ts (new private method)

private evaluateSection(node: Node, childGeometries: readonly Geometry[]): KernelResult {
  const mesh = asMesh(childGeometries[0]!, node.id, 0);
  const origin = node.params['origin'] as Vec3;
  const normal = node.params['normal'] as Vec3;

  const importStart = performance.now();
  const m = this.toSolid(mesh);
  const importMs = performance.now() - importStart;

  const opStart = performance.now();
  const translated = m.translate([-origin[0], -origin[1], -origin[2]]);
  const eulerXYZ = rotationToAlignWithZ(normal);
  const rotated = translated.rotate(eulerXYZ);
  const cs = rotated.slice(0);
  const opMs = performance.now() - opStart;

  try {
    const exportStart = performance.now();
    const polygons = cs.toPolygons() as ReadonlyArray<ReadonlyArray<[number, number]>>;
    return {
      geometry: { kind: '2d', section: { polygons } },
      timings: { importMs, opMs, exportMs: performance.now() - exportStart },
    };
  } finally {
    m.delete?.();
    translated.delete?.();
    rotated.delete?.();
    cs.delete?.();
  }
}
```

WASM-cleanup hygiene matches the post-review pattern from Phase 2 (try/finally; `?.()` for safety against test mocks lacking `delete`).

### Lua docs entry

One new `KernelTypeDoc` in `packages/lua/src/geo-docs.ts`:

```ts
{
  type: 'section',
  summary: 'Cut a 3D solid with an arbitrary plane; produces the 2D cross-section at that plane.',
  outputDoc: '2D cross-section',
  params: [
    { name: 'origin', type: 'vec3', required: true,
      doc: 'A point on the cut plane.' },
    { name: 'normal', type: 'vec3', required: true,
      doc: 'Plane normal (non-zero; need not be unit length).' },
  ],
  example: 'geo.section({origin = {0, 0, 5}, normal = {0, 0, 1}}, { <3D child> })',
}
```

The drift-protection test in `geo-docs.test.ts` auto-catches if the doc entry is missing after registry update.

## Data flow

### Authoring

```json
{
  "type": "section",
  "params": {
    "origin": [0, 0, 5],
    "normal": [0, 0, 1]
  },
  "children": [
    {
      "type": "difference",
      "children": [
        { "type": "box", "params": { "size": [10, 10, 10], "center": true } },
        { "type": "sphere", "params": { "radius": 4 } }
      ]
    }
  ]
}
```

Slice the (box − sphere) at Z=5 with normal pointing up → 2D `CrossSection` of whatever remains at that height.

### Evaluation

1. `Engine.walk` reaches the `section` node. `outputType = '2d'`, so cache lookup uses `'crossSection'` artifact kind.
2. On cache miss: recursively walk the 3D child → `Geometry { kind: '3d', mesh }`.
3. Kernel calls `evaluateSection`:
   - Import child mesh to Manifold solid.
   - Compute Euler angles via `rotationToAlignWithZ(normal)`.
   - Apply `.translate(-origin)` then `.rotate(eulerXYZ)` then `.slice(0)`.
   - Export polygons to `CrossSection`.
4. Cache write under `'crossSection'` kind. Return.

### Composition examples

**Section-then-extrude** (the "use a slice as a profile" workflow):

```json
{
  "type": "extrude",
  "params": { "height": 2 },
  "children": [
    {
      "type": "section",
      "params": { "origin": [0, 0, 0], "normal": [0, 0, 1] },
      "children": [<3D part>]
    }
  ]
}
```

**Side-view drawing** (thin extrusion of a side section):

```json
{
  "type": "extrude",
  "params": { "height": 0.1 },
  "children": [
    {
      "type": "section",
      "params": { "origin": [0, 0, 0], "normal": [1, 0, 0] },
      "children": [<3D part>]
    }
  ]
}
```

**Lua-driven sectioning.** A LuaNode with `schema.output: '2d'` and one `'3d'` input emits a `section` over the input at a Lua-computed origin/normal — falls out of existing `inputs.foo` + `geo.*` machinery, no new code.

## Error handling

All errors flow through existing channels — no new classes.

**Build-time** (`DagError`, path-annotated):

- Missing `origin` or `normal` (each must be a finite `vec3`).
- Zero `normal` → `DagError("normal must be non-zero", path)`.
- Wrong child arity (not exactly one) or non-3D child.

**Kernel-time** (`KernelError`):

- `asMesh` mismatch on the child (runtime guard; should never fire — `buildGraph` already validated).
- Manifold internal failure on extremely degenerate input. Existing kernel error-handling path wraps it.

**Edge cases (defined behavior, not errors):**

- **Plane misses the solid entirely** → empty `CrossSection` (`polygons: []`). Same convention as `offset_2d` past inradius. Downstream `extrude` of an empty section produces an empty mesh — valid but useless result.
- **Plane tangent to a face** → Manifold returns either an empty section or a degenerate zero-area polygon based on its tolerance handling. Documented; authors can nudge `origin` by ±ε.
- **Plane through a vertex/edge** → same tolerance-driven behavior. Documented as a known edge case.
- **`normal` anti-parallel to `+Z`** → `rotationToAlignWithZ` returns `[180, 0, 0]`. Resulting section is mirrored relative to a `+Z` slice — mathematically correct (same plane, "up" side flipped). Documented.

**Determinism guarantees:**

- `canonical(params)` normalizes `origin`/`normal` to byte-stable forms. Identical authored params → identical hash → cache hit on warm path.
- `rotationToAlignWithZ` is a pure JS computation, side-effect-free.
- Manifold's `.translate`, `.rotate`, `.slice` are deterministic.

## Testing strategy

### Pure-math unit tests (`packages/kernel-manifold/src/plane.test.ts`)

- `rotationToAlignWithZ([0, 0, 1])` returns `[0, 0, 0]` (identity).
- `rotationToAlignWithZ([0, 0, -1])` returns `[180, 0, 0]` (anti-parallel).
- For each of `[1, 0, 0]`, `[0, 1, 0]`, `[1, 1, 0]`, `[1, 1, 1]/√3`: applying the resulting Euler rotation to the original normal produces `[0, 0, 1]` within `1e-9`.
- Determinism: same input → byte-identical output Euler angles.
- Property test: for 10 random unit vectors, applying the rotation to the original normal produces `[0, 0, 1]` within `1e-9`.

### Build-time tests (`packages/dag/src/build.test.ts`)

- Builds with `{ origin, normal }`; `outputType === '2d'`.
- Rejects zero normal with `/non-zero/` error.
- Rejects missing `origin` or `normal`.
- Rejects 2D child (must be 3D).
- Rejects wrong child arity (0 or ≥2 children).

### Kernel tests (`packages/kernel-manifold/src/kernel.test.ts`)

- Section a unit cube `[-1, 1]³` at `origin=[0,0,0], normal=[0,0,1]` → 2D square spanning `[-1, 1] × [-1, 1]`. Verify polygon vertex count and bounds.
- Section the same cube at `origin=[0,0,0.999], normal=[0,0,1]` → still a square (close to top face).
- Section the same cube at `origin=[0,0,2], normal=[0,0,1]` → empty `CrossSection` (plane above the solid).
- Section a sphere(r=5) at `origin=[0,0,3], normal=[0,0,1]` → circular-ish polygon with bounds `≈ ±4` (because `sqrt(25 - 9) = 4`).
- Section a cube with `normal=[1, 1, 0]` (45° diagonal plane) → rectangular cross-section.
- Section a cube with `normal=[1, 1, 1]` (body diagonal) → hexagonal cross-section.
- Determinism: same `(child, origin, normal)` → byte-identical `CrossSection.polygons` across runs.

### Engine integration tests (`packages/engine/src/engine.test.ts`)

- End-to-end: build a `section` over a difference, evaluate, assert 2D output.
- Cache: evaluate twice, second run hits the `crossSection` cache (`stats.hits === 1`).
- Composition: `extrude(section(box), height=2)` produces a 3D mesh.

### E2E scenes (`packages/e2e/scenes/composite/`)

- `composite/section-then-extrude.json` — slice (box − sphere) at Z=0 and extrude the result upward. Snapshot the resulting mesh + summary.
- `composite/diagonal-section.json` — section a box on the `[1, 1, 1]/√3` body diagonal. Snapshot captures the hexagonal output.

### Studio scene library

Two new entries in `apps/studio/src/App.svelte` matching the new E2E scenes — so they show up in the dropdown and any user can pick "Composite: section + extrude" to see the section workflow visually.

### Lua docs

`KERNEL_TYPE_DOCS` gains a `section` entry. The existing drift-protection test (`packages/lua/src/geo-docs.test.ts`) auto-fails CI if the entry is missing.

### Perf guards

**Skipped for this node.** The existing 2D cold/warm guards already cover the cache path; section's cost is one transform-and-slice — well-understood, no surprises expected. Add later if profiling reveals an issue.

## Open questions

- **Output orientation control.** Future feature; tracked in ROADMAP.md.
- **`project` (silhouette) as a sibling node type.** Tracked in ROADMAP.md.
- **Curved-surface sections.** Far future; tracked in ROADMAP.md.
- **`trimByPlane` (half-space cut, 3D output).** Different operation, separate node type; tracked in ROADMAP.md.
