# Showcase: parametric tree (glTF leaves)

Demonstrates **Lua-driven procedural geometry + imported mesh assets** working together in yacad. A recursive Lua script grows a branching tree from cylinders; imported glTF leaf meshes attach at every branch tip.

## What is parametric

| Param         | Type   | Default         | Effect                                                          |
| ------------- | ------ | --------------- | --------------------------------------------------------------- |
| `depth`       | int    | 4               | Recursion levels above the leaf branches                        |
| `splits`      | int    | 3               | Sub-branches per branch                                         |
| `trunkLength` | number | 18              | Length of the root trunk (mm)                                   |
| `trunkRadius` | number | 1.1             | Radius of the root trunk (mm)                                   |
| `lengthTaper` | number | 0.68            | Child branch length = parent × this factor                      |
| `radiusTaper` | number | 0.60            | Child branch radius = parent × this factor                      |
| `branchAngle` | number | 28              | Degrees from parent axis each sub-branch bends                  |
| `phyllotaxis` | number | 137.5           | Degrees between successive sub-branches around the parent axis  |
| `leafScale`   | number | 0.35            | Leaf size relative to the tip branch's length                   |
| `wobble`      | number | 0               | 0 = fully symmetric (max cache reuse); >0 = seeded perturbation |
| `seed`        | int    | 1               | PRNG seed for deterministic wobble                              |
| `leafHash`    | string | (set by seeder) | Content hash of the leaf glTF blob                              |

Total: **12 params** (11 geometry/behavior + 1 blob reference).

## Why these defaults

- **`depth: 4`, `splits: 3`** — produces 3⁴ = 81 leaf tips; recognisable canopy silhouette without ballooning complexity.
- **`phyllotaxis: 137.5`** — the golden angle. Sub-branches spiral naturally without clustering; same pattern nature uses for pinecone scales and sunflower seeds.
- **`wobble: 0` as default** — every branch at a given depth is structurally identical, so content-addressing deduplicates aggressively. 81 leaf tips reuse 4 unique subtree evaluations (one per depth level) rather than evaluating 81 unique DAG paths. Changing `wobble → 0.5` exercises the cache invalidation path and makes the tree look organic.
- **`leafScale: 0.35`** — leaves are ~35% of the tip-branch length; plausible relative size.

## Leaf glTF

The leaf is a programmatic 2.5 D shape built with `@gltf-transform/core`:

- A tapered oval profile (pointed at one end, rounded at the other) approximated by 10 vertices
- Two triangulated caps (front and back face) giving a flat double-sided look
- No texture, no material — `import-gltf` strips those; geometry only
- Authored at ~4 × 2 mm so default `leafScale` produces reasonable proportions

The seeder computes the leaf's SHA-256 hash and passes it as the `leafHash` param value. The Lua script references it via `params.leafHash` in every `geo.import_gltf({ blobHash = params.leafHash })` call.

## Triangle count estimate (default params)

| Component             | Per-instance | Instances | Total     |
| --------------------- | ------------ | --------- | --------- |
| Cylinders (depth 0–4) | ~16–64 tris  | ~121      | ~2000     |
| Leaf glTF             | ~16 tris     | 81        | ~1300     |
| **Total**             |              |           | **~3300** |

Well under the 10 k triangle target. The `union` flattening in the engine merges all geometry per depth level, so the final mesh is compact.

## Trade-offs

- **No uniform scale.** yacad has no scale node; the leaf is authored at the target size. `leafScale` param controls the glTF selection — future work could switch between several pre-authored sizes, or yacad could add a `scale` transform node.
- **Single leaf shape for all tips.** All 81 tips share the same `import-gltf` node (same `blobHash`), which is one cache miss amortised across the whole tree. Variety would require N different glTF blobs.
- **Wobble uses a script-level PRNG**, not `math.random`. This ensures reproducibility independent of how Wasmoon seeds Lua's built-in RNG.
