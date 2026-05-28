# Roadmap

Tracks features deferred from prior phases, sized roughly and grouped by capability. Items here have been considered, explicitly out-of-scope for the phase that surfaced them, and worth doing — but not yet prioritized.

Format per item: **one-line summary** — _surfaced by_ phase/spec — sketch of approach when known.

## Shipped phases

- **Phase 0 (POC)** — Merkle DAG + Manifold kernel + worker + studio + 7 primitives.
- **Phase 1 (LuaNode)** — Sandboxed Lua code nodes with `ExpandableNodeType` abstraction. See [specs/2026-05-27-luanode-design.md](superpowers/specs/2026-05-27-luanode-design.md).
- **Phase 2 (2D layer)** — 14 new node types: 2D primitives, transforms, ops, bridges, refinement. See [specs/2026-05-27-2d-layer-design.md](superpowers/specs/2026-05-27-2d-layer-design.md).
- **Section node** — 3D→2D bridge (arbitrary-plane slicing). See [specs/2026-05-28-section-design.md](superpowers/specs/2026-05-28-section-design.md).
- **2D vector exports** — DXF/SVG/PNG exporters for any 2D-root scene. See [specs/2026-05-28-2d-vector-exports-design.md](superpowers/specs/2026-05-28-2d-vector-exports-design.md).

## Deferred — 2D / 3D geometry

- **`project` (silhouette)** — _surfaced by section spec._ Project a 3D solid onto an axis to get its outline. Manifold has `Manifold.project()` (projects onto XY); arbitrary direction = rotate + project. Sibling to `section` but distinct semantic (silhouette through-and-through, not planar intersection).
- **`trimByPlane` (half-space cut)** — _surfaced by section spec._ Manifold has it: `trimByPlane(normal, originOffset): Manifold`. Cuts a solid with a plane, keeping one half. Useful for sectioning + extruding back to solid in one step.
- **Smooth / smoothByNormals / smoothOut** — _surfaced by 2D layer spec._ Mesh smoothing (3D refinement). Manifold's `smooth` family. No new capability class, just refinement of buildable shapes.
- **Minkowski sum / difference** — _surfaced by 2D layer spec._ Not in Manifold 3.5.0 natively; needs emulation via extrude+union for prismatic cases or escape to OCCT for general 3D.
- **`warp` (Lua-callback driven)** — _surfaced by 2D layer spec._ Per-vertex coordinate transformation via a Lua callback (hashable, sandboxable). Architecturally: a kernel-backed node taking a 3D (or 2D) child + Lua source string in params, runs the source per-vertex inside `WasmoonLuaRuntime`. Requires performance work for per-vertex Lua dispatch.
- **Holes in `polygon`** — _surfaced by 2D layer spec._ Currently you compose holes via `difference(outer, inner)` — works correctly. A native multi-contour polygon would be marginally more efficient but adds schema complexity.
- **Open `path_2d` type + sweep operations** — _surfaced by 2D layer spec._ New geometry kind in the type system (`'path_2d'` distinct from `'2d'`-as-closed-region). Enables sweep-along-path. Substantial design surface.
- **`extrude` with Lua-callback profile** — _surfaced by 2D layer spec._ Lua-driven scaling/twist function along the extrusion. Pairs with `warp` (same Lua-callback infrastructure).
- **User-controlled section output orientation** — _surfaced by section spec._ Currently shortest-arc rotation determines the output 2D X/Y axes. Future: explicit `up: vec3` or `rotateInPlane: number` param.
- **Curved-surface sections** — _surfaced by section spec._ Section along a parametric surface, not a plane. Far future.

## Deferred — kernel / engine

- **BREP fillets (real edge rounding)** — _surfaced by vision._ Manifold can't do true BREP fillets; this is the explicit OCCT.js escape hatch (spec invariant #7). OCCT integration is a phase of its own.
- **CPU / wall-clock budgets on `expand`** — _surfaced by LuaNode spec._ A wall-clock budget per expandable-node expansion. Lives on `ExpandableNodeType`, not in the Lua runtime specifically — applies uniformly.
- **AST validation of Lua code against schema** — _surfaced by LuaNode spec._ Static check that Lua source references only declared `params.<name>` and `inputs.<name>`. Currently surfaces as runtime errors.

## Deferred — import / export

- **2D vector import** (DXF / SVG in) — _surfaced by 2D vector exports spec._ Round-trips the export path: drop a DXF on the studio, get a `CrossSection` you can extrude/transform/compose. Uses the existing `'decoder'` NodeTypeDef pattern from Phase 2.5 but produces 2D output. Probably ships as a sibling phase once a user/use-case surfaces.
- **DWG support** — _surfaced by external-formats discussion._ Proprietary AutoCAD binary. DXF covers ~95% of share-CAD-files workflows; DWG → DXF conversion is standard upstream. Defer indefinitely until specific user demand.
- **Multi-layer DXF organization** — _surfaced by 2D vector exports spec._ Assign different layer names per polygon based on user-supplied metadata or polygon role (outer / hole / engrave / cut). Adds a per-polygon classification problem that's its own design.
- **SVG annotations** — _surfaced by 2D vector exports spec._ Dimension labels, scale bars, technical-drawing decoration. Future feature; needs its own design pass.
- **3D mesh export beyond STL** (OBJ, glTF) — _surfaced by external-formats discussion._ Sequenced AFTER the mesh data model evolves to carry normals/UVs/materials; shipping today against the current minimal `Mesh` would bake lossy interfaces.
- **3MF export** — _surfaced by external-formats discussion._ Slicer-direction format; belongs with the future print-bridge layer (build-plate arrangement + slicer config), not engine I/O.
- **Mesh data model evolution** (normals, UVs, vertex colors, material assignments) — _surfaced by external-formats discussion._ Substantial cross-cutting change preparing for game-asset workflows. User flagged as "potentially throwaway feature branch" — expect spike-and-iterate. Should land before rich mesh I/O. Conceptual write-up: [ideas/animation-assemblies-mesh-model.md](ideas/animation-assemblies-mesh-model.md).
- **Animation / rigging** (skinning data, bone hierarchies) — _surfaced by external-formats discussion._ Beyond rigid-body; needs the mesh data model evolution first (bone weights, morph targets). Rigid-body animation (assemblies + parameterized Lua nodes) is independently shippable. Conceptual write-up: [ideas/animation-assemblies-mesh-model.md](ideas/animation-assemblies-mesh-model.md).
- **Assemblies as a `Geometry` kind** — _surfaced by animation discussion._ A new `Geometry` variant `{ kind: 'assembly', parts: [{ transform, geometry }] }` that preserves subtrees as separate `Mesh` artifacts rather than booleaning them down. Foundation for animation, instancing, scene-graph workflows, and richer export. Conceptual write-up: [ideas/animation-assemblies-mesh-model.md](ideas/animation-assemblies-mesh-model.md).

## Deferred — UX / authoring

- **Library / sharing of LuaDefinitions** — _surfaced by LuaNode spec._ Content addressing already gives deduplication and remote-sharing primitives for free; an explicit library UI / search is deferred until usage patterns inform it.
- **Computed properties on `InputRef` (bbox, etc.)** — _surfaced by LuaNode spec._ `inputs.foo.outputType()` exists synchronously. Future: `inputs.foo.bbox()` (cached artifact per spec §VFS / Object Store) for bbox-driven Lua layout.
- **WYSIWYG editor** — _surfaced by vision._ The whole tree view + viewport selection + parameter inspector. Largest unbuilt piece.
- **WYSIWYG section gesture** — _surfaced by section spec._ Click an anchor in the viewport, orbit to set the normal direction — generates a `section` node parametrically.

## Deferred — import / export / ecosystem

- **STL import** (as opaque leaf nodes) — _surfaced by vision._ Phase 1 of the roadmap mentions basic STL import. Useful for legacy models with no parametric source.
- **OpenSCAD import** — _surfaced by vision._ Phase 2 of the roadmap. SCAD AST → DAG translation.
- **FreeCAD (FCStd) import** — _surfaced by vision._ Phase 3 of the roadmap.
- **STEP import / export (via OCCT)** — _surfaced by vision._ Phase 3 of the roadmap. Bound to OCCT integration.
- **3MF export** — _surfaced by vision._ Phase 3 of the roadmap.
- **Print bridge (slicer + Klipper dispatch)** — _surfaced by vision._ Phase 3 of the roadmap.

## Deferred — intelligence / agentic

- **STL → parametric reconstruction** — _surfaced by vision._ Phase 4 of the roadmap. LLM-driven.
- **SCAD refactoring agent** — _surfaced by vision._ Phase 4 of the roadmap.
- **Parameter axis suggestion** — _surfaced by vision._ Phase 4 of the roadmap.

## Deferred — scale

- **Remote cache tier (cross-user sharing)** — _surfaced by vision._ Phase 5. The `ObjectStore` interface already accommodates this.
- **Print farm dispatcher** — _surfaced by vision._ Phase 5.
- **Closed-ecosystem printer integrations (Bambu, Prusa Connect)** — _surfaced by vision._ Phase 5.
- **Collaboration (multi-user editing)** — _surfaced by vision._ Phase 5.

## How this document is maintained

- When a spec calls something "deferred to Phase N" or "future work" or "out of scope," add it here in the same commit as the spec lands.
- When a phase ships, move its items from "Deferred" to "Shipped phases" (top of file).
- One-line summary preferred; link to a more detailed design doc when one exists.
- Don't let this file become a wishlist — only items that have been considered and explicitly punted from a real phase belong here. Pure ideation lives in [docs/ideas/](ideas/) or directly in chat with the user.
