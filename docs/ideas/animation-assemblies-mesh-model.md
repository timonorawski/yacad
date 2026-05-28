# Animation, assemblies, and the mesh data model

**Status:** exploratory. Not a spec, not a commitment. Captures the shape of a problem space that crosses three pending design decisions, so that when any one of them comes up for proper specification, the others are within view.

**Audience:** future-us when one of these threads moves into a real phase.

## The reframing

Today, the DAG produces a single `Geometry` artifact at its root — one `Mesh` or one `CrossSection`. Booleans collapse subtrees into unified geometry; transforms compose into a single coordinate frame; the renderer receives one mesh and draws it.

For animation, instancing, and game-asset workflows, this is the wrong end-state. A character isn't one mesh — it's a rig of meshes with hierarchical transforms. A car has four wheels that are structurally the same geometry but rotate independently. An animation frame doesn't deform every triangle in the scene; it changes a few transforms and maybe regenerates a few subtrees.

The reframing: **the DAG is a scene graph, and the cache is the instancing engine.** Subtrees stay as separate `Geometry` artifacts. Transforms compose at render time. Content addressing means identical subtrees share storage. Animation is parameter substitution at certain nodes; cache hit rate is what makes per-frame evaluation tractable.

The current "one DAG → one mesh" behavior remains valid — it's the special case where the root is a single rigid solid. The new behavior is a generalization, not a replacement.

## Three connected shifts

These three changes are coupled. None of them is independently shippable in its final form; each constrains the others. They can be sequenced (see below), but the design has to consider all three from the start.

### 1. Assemblies as a `Geometry` kind

`Geometry` is today:

```ts
type Geometry = { kind: '2d'; section: CrossSection } | { kind: '3d'; mesh: Mesh };
```

For assemblies, a third kind:

```ts
type Geometry =
  | { kind: '2d'; section: CrossSection }
  | { kind: '3d'; mesh: Mesh }
  | { kind: 'assembly'; parts: AssemblyPart[] };

interface AssemblyPart {
  transform: Mat4;
  geometry: Geometry; // recursive — assemblies of assemblies
  // Possibly: name, role, materialId, etc.
}
```

The kernel never produces assemblies directly. Assemblies come from a small set of node types whose semantic is "keep children separate, compose by transform." Everything else (booleans, refines, bridges) still operates on unified meshes and rejects assembly inputs with a typed error.

**The seam decision: explicit or implicit?**

- _Explicit:_ a new `group` (or `assembly`) node type. Authors opt in by wrapping subtrees with it. Booleans below the group still produce unified meshes; the group preserves them as separate parts. Predictable, easy to type-check, easy to test.
- _Implicit:_ booleans become lazy. A `union` returns an assembly until something downstream demands a mesh (export, refine, certain ops), at which point it collapses. More magical — the same DAG behaves differently depending on what's downstream — harder to reason about.

The explicit path is much better aligned with the architectural invariants (dual type system, errors at graph-construction time, no surprising behavior at evaluation). The implicit path is tempting because it "just works" for naive cases but pays back the savings in debuggability.

**Renderer impact.** three.js handles this naturally — every `AssemblyPart` becomes an `Object3D` with its own matrix; identical sub-geometries share the same `BufferGeometry` instance. This is what `geometryToObject3D` would walk recursively. For the kernel, nothing changes — it doesn't see assemblies.

**Export impact.** STL doesn't know about assemblies — flatten to a unified mesh on export (or refuse, with a clear message). OBJ and glTF both naturally express hierarchies and would carry assemblies through. DXF/SVG/PNG are 2D — assembly questions don't apply.

**Existing cache behavior already supports this.** A node whose semantic hash matches a prior evaluation reuses its `Mesh` artifact. Four identical wheels in an assembly = one `Mesh` artifact in cache, four `AssemblyPart` entries with different transforms.

### 2. Animation state as parameter

The mechanism is straightforward: animation state is a value, values get hashed into cache keys, identical state values produce cache hits. Determinism is preserved because the state is purely a function input — no clock, no I/O.

```ts
// Lua node parameter shape — sketch
interface AnimatedParams {
  // ...normal params...
  state: {
    tick: number; // or `time: seconds`
    params: Record<string, number | string | boolean>;
    // Other animation-system inputs: blend weights, layer mix, etc.
  };
}
```

A Lua node reads `state.tick` and `state.params` to compute its outputs (typically: the parameters it passes to a child operation, like a rotation angle). At each frame, the Lua node's hash changes only because the `state` parameter changed — every untouched subtree keeps its hash and reuses its cached `Mesh` artifact.

**The state-propagation decision: per-node parameter or ambient context?**

- _Per-node parameter:_ every animated node declares `state` as an explicit input, like any other parameter. Verbose for deeply-nested animations (state has to be threaded through layers), but transparent — you can see exactly which subtrees depend on time. Easier to test.
- _Ambient context:_ the engine threads a "frame state" object down through evaluation, available to any Lua node that wants it. Less verbose authoring, but the cache has to track _which nodes actually read it_ and include those reads in their hash inputs — otherwise pristine subtrees inherit a spuriously-changing hash and cache-poison the entire tree. The mechanism for tracking "which context fields did this node read" is non-trivial (requires either AST analysis or a wrapper around the Lua state object).

For v1, per-node parameter is the safer bet. Ambient context is a v2 ergonomic refinement once the rest of the design is settled. Note: per-node parameter requires that the author build the animation interface deliberately — they decide what's animated and what isn't. That's actually a feature, not a bug.

**Cache hit rate is the success metric.** A 60fps animation timeline with 99% hit rate per frame is the difference between "buttery scrub" and "freeze on every drag." The architecture pays off only if hit rate is high — which means the author has to structure their DAG to keep time-varying nodes localized. The studio probably wants UI to surface "which subtrees changed this frame" as a debug aid.

### 3. Mesh data model evolution

Today, `Mesh` is the minimum that boolean operations need: vertex positions and triangle indices. That's enough for printable 3D solids; it's lossy for everything else.

```ts
// Today
interface Mesh {
  vertices: Float32Array; // xyz xyz xyz...
  indices: Uint32Array; // i i i ...
}
```

For richer use, `Mesh` (or a parallel "rich mesh" type) needs to carry:

- **Per-vertex normals.** Currently the renderer computes them from face adjacency at render time. Game-asset workflows want explicit normals for sharp-edge control (think: hard-edged crease vs. smooth shade). glTF/OBJ both encode them; STL doesn't.
- **Per-vertex UV coordinates.** Texture mapping requires them. No current operation generates UVs (Manifold doesn't produce UV-mapped output); they enter only via import.
- **Per-vertex colors.** Sometimes useful for material differentiation without textures.
- **Material assignments.** Per-face or per-submesh. Implies a notion of "material" as a referenced entity (id-resolvable, like blob hashes).
- **Bone weights and bone indices.** For skinning. Per-vertex (typically 4 bones with normalized weights). Only meaningful in the context of a skeleton, which is its own concept.
- **Morph targets / blend shapes.** Per-vertex offsets keyed by target name. Adds an order-of-magnitude data volume — typically lazy-loaded.

**Representation: struct of arrays vs class.** SoA matches the GPU model (separate `BufferAttribute`s in three.js), serializes compactly, and lets you skip attributes you don't need cheaply (a mesh without UVs simply doesn't have that array). That's the right starting point. The downside is slightly more verbose construction code — every operation that produces a `Mesh` has to populate the relevant arrays.

**The compatibility problem.** Today's Manifold kernel produces meshes without normals, UVs, colors, or weights. Importers carry as much as the format provides. If `Mesh` grows to include these fields, every consumer (export, render, cache, e2e summaries) has to handle "field present" and "field absent" cases. The clean answer is to make them optional and let consumers fail with a clear error when they require a field that isn't present (e.g., "glTF export requires UV coordinates; this mesh has none").

**The throwaway-branch question.** This is the user-flagged "potentially throwaway feature branch" item: getting the mesh model right requires iteration, and the first attempt is unlikely to be the final answer. The right move is to scope a spike-and-iterate phase, not a single-shot redesign. Plausible spike target: pick one game-asset workflow (import glTF → modify → export glTF) and make the mesh data round-trip losslessly, then look at what fell out.

**The transform-vs-data question.** Bone weights are static per-vertex data; bone transforms are animation state. The mesh data model has to express the binding (which vertices follow which bones, with what weights); the animation system supplies the per-frame transforms via the assembly / parameter mechanism. So skinning sits at the _intersection_ of all three shifts: assembly hierarchy provides the bone transforms; mesh data model provides the weights; animation state provides the per-frame parameters.

## How they compose

Rigid-body first, then deformation.

**Rigid-body animation needs:** assemblies + parameterized Lua nodes. The mesh data model can stay minimal — rigid bodies don't deform per-vertex, so normals/UVs/etc. aren't required for the animation itself (just for rich-export use cases independently).

**Vertex-deformation animation needs:** the mesh data model evolution (specifically: bone weights, morph targets). The assembly + parameter machinery from rigid-body still applies, but the meshes themselves have to express their deformation bindings.

This suggests a clear sequencing:

1. **Mesh-model evolution spike** as the user already flagged — pick one round-trip workflow, evolve `Mesh` until it survives, learn from the friction. Don't ship animation work against this yet because the API is going to change.
2. **Assemblies + per-node animation parameters** — independent of the mesh model evolution. The new `Geometry` kind, the `group` node type, the Lua-state-as-parameter pattern. This is the rigid-body story end-to-end. Cache hit rate validation, studio UX for animation timelines, etc.
3. **Skinning and morph targets** — sits on top of the now-stable mesh model and the assembly+animation foundation. Probably its own phase.

The mesh-model spike unlocks rich export (glTF, OBJ with material) on its own, independent of animation. That's a useful intermediate.

## What this unlocks

- **Game-asset workflows.** Round-trip glTF/FBX as the primary output format, with materials and rigging preserved. The DAG becomes a parametric authoring layer for game assets, not just print models.
- **Free instancing.** A scene with 100 identical pillars uses 1 `Mesh` artifact + 100 `AssemblyPart` transforms. The Merkle cache gives this without any new mechanism — it's already true at the artifact level; assemblies just expose it at the scene level.
- **Scrubbable animation.** A timeline UI parameterizes the root animation state; the engine re-evaluates per frame with high cache hit rate. Same trick as today's parameter sliders, generalized.
- **Slicer dispatch with intent.** A future print-bridge layer could read assembly part names / materials and route them appropriately (e.g., a multi-material print plan).
- **Rich mesh export beyond STL.** Once `Mesh` carries normals + UVs, OBJ and glTF export become reasonable (currently deferred precisely because the data model can't represent them).
- **Sub-DAG sharing / library nodes.** An assembly part can reference a named sub-DAG. Combined with content addressing, this is the substrate for a shareable library of parts.

## Open questions / decisions deferred to spec time

- **Assembly seam mechanism.** Explicit `group` node (recommended) vs. lazy booleans. Locked in at spec time.
- **Ambient animation state or per-node parameter.** Per-node for v1; ambient as v2 if patterns emerge that justify the cost.
- **Mesh data model representation.** Struct-of-arrays is the right starting point; details of attribute presence/absence handling at consumer boundaries TBD.
- **Material as a concept.** What is a material in this system? A blob-hash-referenced descriptor? A parametric node like everything else? Cross-cuts mesh data model and the broader DAG.
- **Animation timeline UX.** Studio-side problem, not engine-side, but worth pre-thinking. Probably: a root-level "scene state" node with explicit named animatable params; the timeline scrubs through it.
- **Backward compatibility for `Mesh`.** Today's consumers expect `vertices` + `indices` only. Making fields optional vs. introducing a new type. Likely: extend `Mesh` with optional fields, validate at consumer boundaries.
- **Bone hierarchy representation.** An assembly with named bones? A separate `Skeleton` concept? Touches enough surfaces to need its own design pass when skinning is on deck.

## What this doesn't solve

- **Inverse kinematics, constraints, physics.** Those are higher-level animation systems that produce parameter values for the DAG to consume. They live above the DAG, not in it.
- **Particle systems, instanced effects.** Out of scope for parametric CAD. If this ever becomes a thing, it lives in a different subsystem.
- **Audio, video, non-geometric assets.** Game engines need these; we don't ship a game engine.
- **Procedural materials, shaders.** Materials are referenced descriptors at this layer; their compilation into GPU shader code lives in the rendering / export layer.
- **Real-time collaboration on animation timelines.** Multi-user editing is its own deferred concern; animation adds no new collaboration problem beyond what static editing already has.

## Notes for future-us

When any one of these three shifts comes up for proper specification, read the other two sections first. The design decisions interlock — picking the assembly seam mechanism without considering the animation state propagation, or specifying the mesh data model without thinking about how booleans interact with rich-attribute meshes, will produce inconsistencies that have to be unwound later.

The architectural invariants from [vision.md](../vision.md) — Merkle cache, determinism, dual type system, scope discipline — all survive this expansion. The Merkle cache becomes more valuable, not less. Determinism remains absolute. The type system gains one more variant (`assembly`) but doesn't change shape. Scope discipline still matters: this is a substantial expansion of what the system does, and each piece needs to land with the same rigor as a phase, not as opportunistic feature accretion.
