# Exploratory showcase: chamfered box (boolean decomposition)

Tests the claim that a chamfered cuboid doesn't need a BREP kernel — it's just `difference(box, union(wedges))`, one right-triangular prism per edge, twelve in total.

## What is parametric

| Param     | Type   | Default | Effect                              |
| --------- | ------ | ------- | ----------------------------------- |
| `width`   | number | 50      | Box X dimension                     |
| `depth`   | number | 50      | Box Y dimension                     |
| `height`  | number | 50      | Box Z dimension                     |
| `chamfer` | number | 5       | Leg length of the wedge (per face)  |

## Why this exists

`docs/superpowers/specs/2026-05-29-fillet-chamfer-decomposition-design.md` argues that fillet and chamfer reduce to compositions of existing Manifold-backed ops for any shape whose edges are known at authoring time. A box is the cleanest test case: its 12 edges are deterministic from the dimensions, so a Lua node can build the wedge geometry analytically with no mesh introspection.

If the technique generalizes, the OCCT integration story shifts from "needed for fillets" to "needed only when filleting arbitrary derived edges from imported meshes or kernel-produced intersections" — which is the follow-up the spec defers to the **evaluator** phase.

## Construction

```
difference(
  box(W, D, H),
  union(
    -- 4 wedges along the vertical edges (Z-aligned)
    -- 4 wedges along the X-aligned top/bottom edges
    -- 4 wedges along the Y-aligned top/bottom edges
  )
)
```

Each wedge is built as a 2D right triangle (legs `chamfer` on each side, right angle at the origin) extruded along Z with `center=true`, then rotated so the prism axis aligns with the edge axis, then translated to the edge midpoint. See `index.ts` for the per-edge triangle corner sets — they're pre-rotated so a single rotate-then-translate places each wedge correctly.

## Limitations

- All 12 edges are chamfered uniformly. No way to chamfer a subset (e.g., only the top edges).
- The chamfer is a flat 45° bevel. A non-45° chamfer would require asymmetric leg lengths.
- `chamfer` must be less than `min(width, depth, height) / 2` to keep the geometry sane.
