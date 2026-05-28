# Showcase: Parametric Castle

A Lua-driven parametric castle demonstrating that yacad can author
architectural geometry with repeating decorative detail (crenellations)
from a concise parameter set.

## Parameters (12 total)

| Name                 | Type   | Default | Notes                                         |
| -------------------- | ------ | ------- | --------------------------------------------- |
| `courtyardSize`      | number | 20      | Inner courtyard side length                   |
| `wallHeight`         | number | 8       | Height of the curtain walls                   |
| `wallThickness`      | number | 2       | Thickness of all four curtain walls           |
| `towerRadius`        | number | 3       | Radius of each corner tower                   |
| `towerHeight`        | number | 12      | Height of each corner tower                   |
| `towerSegments`      | int    | 16      | Polygon segments for tower cylinders          |
| `crenellationCount`  | int    | 6       | Number of merlons per wall side               |
| `merlonWidth`        | number | 1.2     | Width of each merlon (solid battlement block) |
| `crenellationHeight` | number | 1.5     | Height the merlons rise above the wall top    |
| `crenellationDepth`  | number | 2       | Depth (thickness) of merlon blocks            |
| `gateWidth`          | number | 3       | Width of the gate opening on the south wall   |
| `gateHeight`         | number | 5       | Height of the gate opening                    |

## Decomposition

```
castle
  ├── walls (union of 4 curtain walls)
  │     └── each wall modified by gate cutout (south wall only)
  ├── towers (union of 4 corner cylinders)
  └── battlements (union of merlons on all 4 wall tops)
```

### Curtain walls

Four box-shaped curtain walls span each side of the castle. The outer footprint
half-extent is `half = courtyardSize/2 + wallThickness`. Each wall runs the full
outer extent on its axis and `wallThickness` deep:

- **South wall** (−Y face): `size = {2*half, wallThickness, wallHeight}` at `(−half, −half, 0)` — the gate cutout is differenced from this wall.
- **North wall** (+Y face): `size = {2*half, wallThickness, wallHeight}` at `(−half, half − wallThickness, 0)`.
- **West wall** (−X face): `size = {wallThickness, 2*half, wallHeight}` at `(−half, −half, 0)`.
- **East wall** (+X face): `size = {wallThickness, 2*half, wallHeight}` at `(half − wallThickness, −half, 0)`.

### Gate

A single `geo.difference` on the south wall subtracts a box cutter centred on
the wall face:

- Cutter: `size = {gateWidth, wallThickness + 2, gateHeight}` at `(−gateWidth/2, −half − 1, 0)`.

The extra +2/+1 epsilon on the thickness axis ensures a clean boolean with no
co-planar faces.

### Corner towers

Cylinders at the four outer corners `(±half, ±half)` with height `towerHeight`
(taller than the walls for a recognisable silhouette). `towerSegments` controls
polygon quality.

### Battlements

For each of the 4 wall sides, `crenellationCount` merlon blocks are placed
evenly across the wall length. The pitch (merlon + gap spacing) is
`wall_length / crenellationCount`; each merlon occupies its centred `merlonWidth`
slice. Merlons sit on top of the wall at `z = wallHeight` and rise
`crenellationHeight` above it. Depth matches `crenellationDepth` (or
`wallThickness` if smaller to avoid floating merlons).

All merlons from all four sides are collected into a single `geo.union`, keeping
the boolean tree at depth 1.

## Estimated complexity at defaults

- 4 curtain walls (~12 tris each) + gate boolean (~24 tris) → ~72 tris
- 4 towers (16-segment cylinders, ~64 tris each) → ~256 tris
- 6 merlons × 4 sides = 24 merlon boxes (~12 tris each) → ~288 tris
- **Total: ~616–800 triangles** at defaults, well under the 30k target.

Increasing `towerSegments` to 32 roughly doubles tower triangle count (~1k total).

## Design decisions

- **Full-length curtain walls**: walls span the entire outer side including the
  corner regions, so towers naturally overlap the wall ends. No mitre-join
  arithmetic needed.
- **Single difference for the gate**: the gate cutter uses an epsilon-extended
  cutter in Y to avoid degenerate coplanar faces on the wall interior.
- **Merlons as additive geometry**: instead of subtracting crenel gaps from a
  solid parapet, we add merlon boxes on top of the wall. This avoids a
  many-operand difference and is faster for Manifold.
- **`crenellationDepth` param**: controls merlon thickness independently of
  `wallThickness`; defaults to `wallThickness` in spirit but is a separate knob
  so the merlon profile can differ from the wall.
- **4 fixed corner towers**: the brief notes "4 fixed" as the natural castle
  geometry; `towerCount` is intentionally omitted to keep the Lua code readable
  and the composition strategy explicit.
