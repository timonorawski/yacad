# Exploratory showcase: filleted slab (offset + warp)

Tests the claim that a fully-filleted slab (rounded XY corners + rounded top/bottom Z edges) doesn't need a BREP kernel — it's a composition of `offset_2d(round)`, `extrude`, and `warp`.

## What is parametric

| Param          | Type   | Default | Effect                                                          |
| -------------- | ------ | ------- | --------------------------------------------------------------- |
| `width`        | number | 60      | Slab X dimension                                                |
| `depth`        | number | 40      | Slab Y dimension                                                |
| `height`       | number | 20      | Slab Z dimension                                                |
| `cornerRadius` | number | 8       | XY corner fillet radius (rounds the vertical edges of the slab) |
| `edgeRadius`   | number | 3       | Top/bottom Z edge fillet radius (skipped when 0)                |

## Why this exists

This is the second of two scenes in `docs/superpowers/specs/2026-05-29-fillet-chamfer-decomposition-design.md`. The chamfered-box showcase covers the pure-boolean case; this one demonstrates that the same architectural claim extends to _fillets_ — including those that require deforming the mesh surface around a known edge.

It also previews the **evaluator** capability the spec defers to a follow-up: the warp's per-vertex callback needs to know the XY profile shape (to compute the outward normal at each vertex), and today that information is passed through `params.values` because the slab is authored by the same Lua node as the warp. When the upstream geometry isn't authored by the same node (e.g., a fillet on the intersection edge of two booleaned cylinders), the warp would need to inspect the mesh — that's the evaluator.

## Construction

```
Stage A:
  rectangle(W, D)
    → offset_2d(−cornerRadius, joinType='round')
    → offset_2d(+cornerRadius, joinType='round')
    → extrude(height)
  ⟶ slab with rounded vertical edges (quarter-cylinder fillets)

Stage B (only if edgeRadius > 0):
  warp(slab, code=<rolling-ball>, values={ all dimensions + radii })
  ⟶ slab with the top and bottom Z edges rounded
```

## The warp math

For each vertex `(x, y, z)`:

1. Compute `dz` = distance to the nearest horizontal face.
2. Compute `d_xy` = signed perpendicular distance from the rounded-rectangle XY profile outline (negative inside).
3. If both `dz` and `−d_xy` are in `[0, edgeRadius]`, the vertex sits in the fillet zone. Treat `(s, t) = (dz, −d_xy)` as a 2D point and project radially from the fillet center `(r, r)` onto the fillet circle `(s−r)² + (t−r)² = r²`.
4. Translate the new `(s, t)` back to world coordinates: the change in `t` shifts the vertex inward along the profile's outward normal; the change in `s` shifts it away from the nearest horizontal face.

The outward normal at the vertex's `(x, y)` is computed analytically from the rounded-rectangle outline: straight-edge strips give axis-aligned normals; corner-arc zones give radial normals from the arc center.

## Limitations

- The warp math assumes the XY profile is the exact rounded rectangle produced by Stage A. If you swap Stage A for a different profile (e.g., a polygon → offset), the warp's outward-normal computation will be wrong.
- `cornerRadius` should be ≤ `min(width, depth) / 2`.
- `edgeRadius` should be ≤ `cornerRadius` (otherwise the corner-arc fillet zone overlaps with itself near the corners; the warp doesn't crash but the result isn't a clean rolling-ball fillet).
