# YACAD DAG Language Reference

This reference describes the JSON DAG document consumed by `buildGraph` and used by the studio editor. It covers all 22 node types shipping today: the seven Phase 0 primitives, the LuaNode (Phase 1), and the fourteen 2D-layer node types (Phase 2).

## Document shape

Every node uses this shape:

```json
{
  "type": "<node-type>",
  "params": { "...": "..." },
  "children": [{ "type": "..." }]
}
```

- `type`: required string identifying the operation.
- `params`: optional object; defaults and validation are type-specific.
- `children`: optional array of child nodes.

## Dual type system

Every node has an **output type** of either `'2d'` (a `CrossSection` — one or more closed polygons on the XY plane) or `'3d'` (a triangulated `Mesh` in 3D space). The type is checked at graph-construction time; mismatches throw a `DagError` with the path of the offending node.

The output type also picks the cache artifact kind (`crossSection` vs `mesh`), so 2D and 3D outputs of two nodes with colliding semantic hashes never share storage.

## Node type summary

| Type                                                                                                | Output           | Children          |
| --------------------------------------------------------------------------------------------------- | ---------------- | ----------------- |
| [`box`](#box) / [`sphere`](#sphere) / [`cylinder`](#cylinder)                                       | 3D               | 0                 |
| [`circle`](#circle) / [`rectangle`](#rectangle) / [`polygon`](#polygon) / [`spline`](#spline)       | 2D               | 0                 |
| [`translate`](#translate) / [`rotate`](#rotate)                                                     | 3D               | exactly 1 (3D)    |
| [`translate_2d`](#translate_2d) / [`rotate_2d`](#rotate_2d)                                         | 2D               | exactly 1 (2D)    |
| [`union`](#union) / [`difference`](#difference) / [`intersection`](#intersection) / [`hull`](#hull) | matches children | ≥1 same dimension |
| [`offset_2d`](#offset_2d)                                                                           | 2D               | exactly 1 (2D)    |
| [`refine`](#refine)                                                                                 | 3D               | exactly 1 (3D)    |
| [`extrude`](#extrude) / [`revolve`](#revolve)                                                       | 3D               | exactly 1 (2D)    |
| [`lua`](#lua)                                                                                       | per schema       | per schema        |

## 3D primitives

### `box`

```json
{
  "type": "box",
  "params": { "size": [20, 20, 20], "center": true }
}
```

- `size`: required positive vector `[x, y, z]`
- `center`: optional boolean, default `false`. When `true`, the box is centered on the origin; otherwise it occupies `[0, size]` on each axis.

### `sphere`

```json
{
  "type": "sphere",
  "params": { "radius": 10, "segments": 48 }
}
```

- `radius`: required positive number
- `segments`: optional integer ≥ 3, default `32` (latitudinal/longitudinal subdivisions)

### `cylinder`

```json
{
  "type": "cylinder",
  "params": { "height": 30, "radius": 8, "segments": 64, "center": true }
}
```

- `height`: required positive number (Z-axis extent)
- `radius`: required positive number
- `segments`: optional integer ≥ 3, default `32`
- `center`: optional boolean, default `false`. When `true`, centered on the origin; otherwise base on Z=0.

## 2D primitives

All 2D primitives produce a `CrossSection` — one or more closed simple polygons on the XY plane.

### `circle`

```json
{
  "type": "circle",
  "params": { "radius": 10, "segments": 48 }
}
```

- `radius`: required positive number
- `segments`: optional integer ≥ 3, default `32`. Number of polygon vertices approximating the circle.

### `rectangle`

```json
{
  "type": "rectangle",
  "params": { "size": [10, 20], "center": true }
}
```

- `size`: required positive vector `[x, y]`
- `center`: optional boolean, default `false`. When `true`, centered on the origin; otherwise `[0, size]`.

### `polygon`

```json
{
  "type": "polygon",
  "params": {
    "points": [
      [0, 0],
      [10, 0],
      [5, 10]
    ]
  }
}
```

- `points`: required array of `[x, y]` pairs, length ≥ 3. The polygon is automatically closed (last point connects to first). Use CCW winding for outer contours.

To author a hole, compose via `difference`:

```json
{ "type": "difference", "children": [<outer>, <inner>] }
```

### `spline`

```json
{
  "type": "spline",
  "params": {
    "points": [
      [10, 0],
      [3, 3],
      [0, 10],
      [-3, 3],
      [-10, 0],
      [-3, -3],
      [0, -10],
      [3, -3]
    ],
    "segmentsPerCurve": 12,
    "tension": 0.5
  }
}
```

- `points`: required array of control points, length ≥ 3. Closed loop — last point connects back to first.
- `segmentsPerCurve`: optional positive integer, default `16`. Tessellation density between consecutive control points.
- `tension`: optional finite number, default `0.5` (standard Catmull-Rom). Lower values produce tighter curves; higher values produce looser ones.

The curve **passes through every control point** (Catmull-Rom interpolation, not approximating).

## 3D transforms

### `translate`

```json
{
  "type": "translate",
  "params": { "offset": [15, 0, 0] },
  "children": [{ "type": "box", "params": { "size": [10, 10, 10], "center": true } }]
}
```

- `offset`: required vector `[x, y, z]` (any finite numbers)

### `rotate`

```json
{
  "type": "rotate",
  "params": { "angles": [90, 0, 0] },
  "children": [
    { "type": "cylinder", "params": { "height": 30, "radius": 6, "segments": 64, "center": true } }
  ]
}
```

- `angles`: required vector in degrees `[x, y, z]`. Rotations applied X → Y → Z (Manifold convention).

## 2D transforms

The 2D transforms are separate node types from their 3D counterparts because they take `vec2` offsets and single-axis rotation. Overloading on offset arity would be brittle.

### `translate_2d`

```json
{
  "type": "translate_2d",
  "params": { "offset": [5, 0] },
  "children": [{ "type": "circle", "params": { "radius": 1 } }]
}
```

- `offset`: required vector `[x, y]`

### `rotate_2d`

```json
{
  "type": "rotate_2d",
  "params": { "angle": 45 },
  "children": [{ "type": "rectangle", "params": { "size": [2, 1] } }]
}
```

- `angle`: required finite number (degrees, single axis = Z)

## Type-overloaded ops

These four operations accept either all-2D or all-3D children (mixed-dimension children are rejected at build time). The output type matches `children[0].outputType`.

### `union`

N-ary, ≥1 child, all same dimension.

```json
{
  "type": "union",
  "children": [
    { "type": "box", "params": { "size": [20, 20, 10], "center": true } },
    { "type": "sphere", "params": { "radius": 5 } }
  ]
}
```

Works the same way for 2D:

```json
{
  "type": "union",
  "children": [
    { "type": "circle", "params": { "radius": 5 } },
    { "type": "rectangle", "params": { "size": [4, 4], "center": true } }
  ]
}
```

### `difference`

N-ary, ≥1 child, all same dimension. Subtracts every subsequent child from the first.

```json
{
  "type": "difference",
  "children": [
    { "type": "box", "params": { "size": [30, 30, 30], "center": true } },
    { "type": "sphere", "params": { "radius": 19 } }
  ]
}
```

### `intersection`

N-ary, **≥2 children** required, all same dimension. Yields the volume common to all children.

```json
{
  "type": "intersection",
  "children": [
    { "type": "box", "params": { "size": [10, 10, 10], "center": true } },
    { "type": "sphere", "params": { "radius": 6 } }
  ]
}
```

### `hull`

N-ary, ≥1 child, all same dimension. Convex hull of the union of children.

```json
{
  "type": "hull",
  "children": [
    { "type": "circle", "params": { "radius": 1 } },
    {
      "type": "translate_2d",
      "params": { "offset": [10, 0] },
      "children": [{ "type": "circle", "params": { "radius": 1 } }]
    }
  ]
}
```

(Above produces a "stadium" 2D shape — two offset circles, hulled.)

## 2D refinement

### `offset_2d`

```json
{
  "type": "offset_2d",
  "params": { "delta": 2, "joinType": "round", "miterLimit": 2, "segments": 16 },
  "children": [{ "type": "rectangle", "params": { "size": [10, 10], "center": true } }]
}
```

- `delta`: required finite number. Positive grows the shape, negative shrinks. The primitive-fillet idiom: positive `delta` with `joinType: "round"` produces rounded corners.
- `joinType`: optional, one of `"round" | "square" | "miter"`, default `"round"`.
- `miterLimit`: optional finite number, default `2`. Caps the spike length when `joinType: "miter"`.
- `segments`: optional positive integer, default `16`. Controls roundness on circular joins.

Shrinking past the shape's inradius produces an empty `CrossSection` — downstream operations get an empty input (valid but useless result).

## 3D refinement

### `refine`

Subdivides each triangle's edges to produce a denser mesh.

```json
{
  "type": "refine",
  "params": { "n": 2 },
  "children": [{ "type": "box", "params": { "size": [1, 1, 1] } }]
}
```

Exactly **one** of these two parameters must be provided:

- `n`: positive integer. Subdivides each triangle edge into n; each triangle becomes n² triangles.
- `maxEdgeLength`: positive finite number. Refines until no edge exceeds this length.

## 2D→3D bridges

### `extrude`

Lifts a 2D region along +Z to produce a 3D solid.

```json
{
  "type": "extrude",
  "params": { "height": 10, "twist": 0, "scaleTop": [1, 1], "segments": 1 },
  "children": [{ "type": "circle", "params": { "radius": 5 } }]
}
```

- `height`: required positive number (Z-axis extent).
- `twist`: optional finite number (degrees), default `0`. Total twist applied linearly along the extrusion.
- `scaleTop`: optional vec2, default `[1, 1]`. Scale factor at the top (1, 1 = constant cross-section; <1 = taper; >1 = flare).
- `segments`: optional positive integer, default `1`. Z-axis subdivisions — relevant when twist ≠ 0 or `scaleTop` is non-uniform.

### `revolve`

Sweeps a 2D region around the chosen axis to produce a 3D solid.

```json
{
  "type": "revolve",
  "params": { "axis": "y", "segments": 64, "degrees": 360 },
  "children": [
    {
      "type": "polygon",
      "params": {
        "points": [
          [3, 0],
          [4, 5],
          [3, 10],
          [0, 10],
          [0, 0]
        ]
      }
    }
  ]
}
```

- `axis`: optional `"y"` or `"x"`, default `"y"`. The 3D axis around which the profile sweeps.
- `segments`: optional integer ≥ 3, default `32`. Number of subdivisions around the sweep.
- `degrees`: optional finite number, default `360`. Sweep arc — less than 360 produces an open-arc sweep.

The input 2D profile must lie entirely on the non-negative side of the swept axis. Translate the profile if needed before revolving.

## Lua code nodes

### `lua`

A LuaNode runs sandboxed Lua code that emits a sub-DAG of primitives. The runtime exposes a `geo.*` API generated from the kernel-node registry, so adding a kernel-backed primitive elsewhere automatically makes it available to Lua.

A Lua document carries a content-addressable `definitionHash` plus per-instance `values`:

```json
{
  "type": "lua",
  "params": {
    "definitionHash": "<sha256 of canonical LuaDefinition>",
    "values": { "teeth": 12, "radius": 5.0 }
  },
  "children": [{ "type": "box", "params": { "size": [1, 1, 1] } }]
}
```

Children are positional inputs matched against the LuaDefinition's declared `schema.inputs` by order; each appears in Lua as `inputs.<name>`.

The `LuaDefinition` (referenced by `definitionHash`) is a separate content-addressable artifact pushed to the worker via `client.putLuaDefinition(hash, definition)`:

```json
{
  "schema": {
    "inputs": [{ "name": "body", "type": "3d" }],
    "params": {
      "count": { "type": "int", "default": 3, "min": 1, "max": 16 }
    },
    "output": "3d"
  },
  "code": "local parts = {}\nfor i = 1, params.count do\n  parts[#parts + 1] = geo.translate({offset = {(i - 1) * 3, 0, 0}}, { inputs.body })\nend\nreturn geo.union({}, parts)"
}
```

- `schema.output`: `'2d'` or `'3d'`. A LuaNode with `output: '2d'` can be wrapped by `extrude` / `revolve` / 2D ops — Lua-emits-2D is a first-class composition.
- `schema.inputs`: declared positional child inputs.
- `schema.params`: typed parameter declarations (`int`, `number`, `boolean`, `string`, `vec3`) with defaults and optional `min`/`max` ranges.
- `code`: Lua 5.4 source, sandboxed. The geometry construction API (`geo.box`, `geo.union`, etc.) and `math` / `string` / `table` (pure subsets) are available; `os`, `io`, `package`, `require`, `print`, `load`, etc. are not.
- `math.random` is seeded deterministically from `definitionHash + canonical(values)` so the same instance always produces identical geometry.

The Lua code returns a sub-DAG as a `NodeDoc` table. The engine recursively evaluates that sub-DAG — caching at both the outer LuaNode level (Lua never runs on warm hits) and the inner sub-DAG nodes (shared primitives across LuaNodes hit cache).

## Validation behavior

`buildGraph` validates documents before evaluation:

- Unknown node types throw an error.
- `__`-prefixed types are reserved (engine-internal) and rejected.
- Invalid parameter types/ranges throw an error.
- Transform nodes require exactly one child of the matching dimension.
- 2D→3D bridges (`extrude`, `revolve`) require exactly one 2D child.
- `refine` requires exactly one 3D child.
- N-ary ops (`union`/`difference`/`intersection`/`hull`) require ≥minChildren of all-same-dimension; mixed-dimension children are rejected.
- Primitive nodes require zero children.
- For `lua` nodes: `definitionHash` must resolve to a loaded `LuaDefinition`, `values` must satisfy the schema, and children must match `schema.inputs` (arity + output types).

## Determinism and hashing

- Semantic node hashes are computed from `type + canonical(params) + ordered child hashes`.
- Stable canonicalization (sorted keys, normalized numbers) is critical for cache hits.
- Node `id` is authoring identity and is **not** part of the semantic hash.
- LuaNodes hash as `hash("lua", canonical({definitionHash, values}), child_hashes)` — the standard recipe, with `definitionHash` carrying the source identity.
- 2D outputs cache under `crossSection` artifact kind; 3D under `mesh`. Nodes of different output types with colliding `semanticHash` never share storage.
