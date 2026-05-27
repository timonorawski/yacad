# Scene library

Each `*.json` file under this directory is a **DAG document** — exactly what the
JSON editor in the studio app produces, and what `buildGraph` consumes. The e2e
suite (`../src/pipeline.test.ts`) discovers every scene recursively and runs it
through the full pipeline:

```
scene.json → buildGraph → Engine.evaluate (Manifold kernel + cache) → meshToBinaryStl
```

For each scene it asserts a valid binary-STL layout and determinism, and
captures a geometry **summary** (triangle/vertex counts, rounded bounding box,
STL byte length) as a Vitest snapshot in `../src/__snapshots__/`. Those
snapshots are the goldens — add a scene, run `pnpm test`, and the capture is
written automatically. Regenerate with `pnpm vitest run packages/e2e -u` after a
deliberate kernel/engine change (e.g. a `manifold-3d` version bump).

## Layout

Scenes are grouped by what they exercise: `primitives/`, `transforms/`,
`booleans/`, `composite/`. The discovery glob is recursive, so add subfolders
freely.

## Growing from other systems' corpora

Per architectural invariant #9, open-source CAD projects (OpenSCAD, JSCAD,
CadQuery, FreeCAD) are _specification documents for what the problem is_. Their
test suites and forum-documented edge cases are a rich source of cases worth
covering. Translate such cases into DAG documents here — e.g. under
`scenes/openscad/<case>.json` with a note on provenance — to build up regression
coverage. (Automated SCAD→DAG import is a later phase; until then, hand-author
the equivalent DAG.)

Only POC node types are available today: `box`, `sphere`, `cylinder`,
`translate`, `rotate`, `union`, `difference`.
