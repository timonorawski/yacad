# Showcase: Parametric House

A Lua-driven parametric house demonstrating that yacad can author
non-trivial architectural geometry from a concise parameter set.

## Parameters (13 total)

| Name             | Type   | Default | Notes                             |
| ---------------- | ------ | ------- | --------------------------------- |
| `width`          | number | 12      | Footprint width (X) in units      |
| `depth`          | number | 8       | Footprint depth (Y) in units      |
| `floors`         | int    | 2       | Number of storeys                 |
| `floorHeight`    | number | 3       | Height of each storey             |
| `wallThickness`  | number | 0.3     | Shell thickness                   |
| `windowsPerSide` | int    | 3       | Windows on the long (width) walls |
| `windowWidth`    | number | 1.0     | Window opening width              |
| `windowHeight`   | number | 1.2     | Window opening height             |
| `doorWidth`      | number | 1.2     | Door opening width                |
| `doorHeight`     | number | 2.2     | Door opening height               |
| `roofPitch`      | number | 35      | Roof ridge angle in degrees       |
| `roofOverhang`   | number | 0.4     | Eave overhang on all four sides   |
| `segments`       | int    | 1       | Unused placeholder; reserved      |

## Decomposition

```
house
  ├── shell (walls)        difference(outer_box, inner_box, door_cutter, window_cutters)
  └── roof                 translate(extrude(gable_triangle, depth + 2*overhang))
```

### Walls

The shell is built with a single `geo.difference` call whose first operand is
the solid outer box and remaining operands are:

- **inner box** — excavates the interior (floor-to-ceiling hollow)
- **door cutter** — one box centred on the front face (Y = 0)
- **window cutters** — all per-floor, per-side window boxes unioned into one
  operand. This keeps the boolean chain at depth 1 rather than O(N) depth,
  which is critical for Manifold performance.

### Roof

A gable (triangular prism) built by:

1. Computing the ridge height from `roofPitch` (degrees) and `width/2`.
2. Creating a `geo.polygon` with the triangular cross-section.
3. `geo.extrude` along the ridge direction (depth + 2×overhang).
4. Translating to sit on top of the wall box with the correct overhang.

The roof does **not** subtract from the walls — it sits on top as a separate
solid. This avoids a slow boolean while keeping the silhouette correct.

## Estimated complexity at defaults

- Walls shell: 12 + 12 (inner box removed) + door + ~12 windows → O(40) faces
  before Manifold triangulation → ~400–800 triangles.
- Roof prism: ~10 triangles.
- Total: **~500–900 triangles** at defaults, well under the 20k target.

## Design decisions

- **One big difference** rather than chained differences: Manifold's boolean
  cost scales with chain depth. Collecting all cutters into a single
  `geo.difference({}, {walls, all_cutters...})` call halves the tree depth.
- **Roof as a separate solid**: avoids the expensive roof-subtraction boolean;
  produces a visually correct silhouette.
- **`wallThickness` default 0.3**: relative to `width = 12` this is ~2.5%,
  thin but printable. Users can increase for structural geometry.
- **`windowsPerSide`** controls windows on both long (width) walls; the short
  (depth) walls always get one window per floor for simplicity.
- **`segments` param** reserved at 1 — a placeholder for future curved-arch
  window variants without breaking the param schema.
  </content>
  </invoke>
