# Showcase: torus knot (warp)

Demonstrates the `warp` kernel transform. A 2D circle is revolved into a plain torus, then a Lua-defined vertex deformation wraps it around itself `p` times through the donut hole and `q` times around the donut — the standard (p, q) torus-knot construction.

Ported from Manifold's "Matlab Knot" example (Emmett Lalish).

## What is parametric

| Param              | Type   | Default | Effect                                                                 |
| ------------------ | ------ | ------- | ---------------------------------------------------------------------- |
| `p`                | int    | 1       | Times the thread passes through the donut hole (1..8)                  |
| `q`                | int    | 3       | Times the thread circles the donut (1..8)                              |
| `majorRadius`      | number | 25      | Interior radius of the imaginary donut                                 |
| `minorRadius`      | number | 10      | Cross-section radius of the imaginary donut                            |
| `threadRadius`     | number | 3.75    | Cross-section radius of the actual knot string                         |
| `circularSegments` | int    | 24      | Segments around the thread cross-section (controls polygonal fidelity) |

## Why this exists

The architecture lets `warp` carry a Lua deformation as a regular DAG parameter. Same `(code, values, child_mesh)` → same semantic hash → cache hit, so editing `p` or `q` invalidates only this node + ancestors; siblings/cousins still warm-hit.

The Lua sandbox here is configured with `random` disabled (CLAUDE.md #2 purity), so the per-vertex function must be a pure function of `(x, y, z, params.values)`.

## Construction

```
geo.translate_2d(circle)  →  geo.revolve  →  geo.warp(code=…, values=…)
```

The `revolve` segment count `m` is derived from `circularSegments * qk * majorRadius / threadRadius` so facets stay roughly square as the knot density changes.
