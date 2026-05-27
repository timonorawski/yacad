# Parametric 3D Printing Platform — System Design & Philosophy

## Vision

A 3D printing platform built around the conviction that **the parametric model is the artifact**, not the STL. The current ecosystem treats triangulated meshes as the lingua franca, with parametric source as an optional bonus when authors bother to share it. This inverts the relationship: parametric models are the source of truth, meshes are a lossy export format, and the entire user experience — authoring, sharing, customizing, slicing — operates on parametric representations.

The product sits at the intersection of three things that don't currently coexist:

- **Tinkercad's accessibility** — direct manipulation, immediate feedback, no language to learn before producing first results
- **OpenSCAD/CadQuery's power** — full parametric expressiveness with code as an escape hatch
- **Thingiverse's social layer** — shareable, remixable, browseable library of community models

The hard problem the existing tools have solved partially or badly:

- **Thingiverse/Printables**: social, but STL-centric, remixing is essentially impossible at the model level
- **Tinkercad**: accessible, but limited in expressiveness and lacks meaningful sharing/remixing
- **OpenSCAD**: powerful, but hostile UX, no visual editing, slow recompilation
- **Fusion 360 / Onshape**: powerful and well-architected, but priced/positioned for engineering rather than the 3D printing community, closed ecosystems

Nothing covers all three corners. That's the gap.

## Core Architectural Insight

The unifying abstraction is a **content-addressable Merkle DAG of parametric operations**.

Each node in the DAG represents a parametric operation (a primitive, a transformation, a boolean, a procedural generator). Each node has a deterministic hash computed from its type, its parameters, and the ordered hashes of its children. This hash uniquely identifies the _semantic_ geometry the node produces, independent of the implementation that computes it.

This single abstraction provides, essentially for free:

- **Caching**: the hash is the cache key. Rendered meshes, bounding boxes, mass properties, preview thumbnails all key off the same hash.
- **Incremental recomputation**: changing a parameter changes one node's hash, which propagates up through ancestors but leaves siblings and cousins untouched. Only the changed subtree recomputes.
- **Sharing across users**: hashes are content-addressable. If user A's cached mesh and user B's about-to-be-computed mesh have the same hash, A's result is reusable by B.
- **Diff, merge, version control**: structural comparison of parametric models is hash comparison of DAGs.
- **Provenance and remix tracking**: a customized model's hash includes the original's as a subtree hash. The remix graph emerges from hash relationships.
- **Determinism guarantees**: deterministic node evaluation + Merkle hashing = reproducible builds for geometry.

This is the same pattern that underlies Git, IPFS, Bazel, and Nix. None of the open parametric CAD projects have applied it; doing so is the architectural lever.

## Philosophy and Design Principles

### Parametric source is the truth; meshes are derived artifacts

The DAG is canonical. Meshes are cached computational results that can always be regenerated from the DAG. The system never relies on meshes as primary data and never asks users to manipulate them directly. Mesh editing is out of scope; users edit parameters and structure.

### Multiple authoring surfaces, one internal representation

The DAG is not the user-facing format. Users author through:

- A visual node graph / direct-manipulation editor (the WYSIWYG layer)
- One or more textual projections (Lua-embedded DSL, possibly others)
- Imported parametric formats (FreeCAD documents, STEP, OpenSCAD source)

All of these are _views_ onto the same underlying DAG. Round-tripping happens through the DAG, not directly between authoring surfaces.

### Code is a first-class node type, not a separate mode

Following Houdini's model rather than OpenSCAD's: code blocks are DAG nodes with declared inputs, outputs, and parameters. The system doesn't try to round-trip arbitrary code into visual representation; instead, code nodes are opaque computational units that compose with visual nodes through the DAG. This avoids the unsolvable "reverse engineer visual structure from arbitrary code" problem.

### Determinism is non-negotiable

Every node's output must be deterministic given its inputs. This is what makes the Merkle DAG work — non-determinism poisons the cache. Sandboxed code execution, seeded RNG, no clock access, no filesystem, no network from within node evaluation.

### Scope discipline matters more than feature breadth

Most parametric CAD complexity comes from supporting operations 3D printing users rarely need (complex surface lofts, draft analysis, mold parting lines, large assemblies). Scoping to "what 3D printable models actually need" yields a much simpler architecture. Exotic operations are out of scope for the platform; users needing them import from / export to professional CAD.

### Open source projects are specification documents, not architectural references

FreeCAD, OpenSCAD, JSCAD, CadQuery, LuaCAD, and similar projects encode decades of hard-won problem-domain knowledge in their test suites, forum discussions, and issue trackers. They are invaluable as documentation of _what the problem actually is_. They are mostly poor references for _how to architect a solution_, because they evolved from personal projects rather than being designed with full understanding of the problem space. The project leverages them for problem enumeration and test validation while designing implementation fresh.

### Escape hatches exist and are honest

When the visual layer can't represent something, the system says so and provides a code escape hatch rather than pretending. When agent-reconstructed parametric models are best-guess rather than authoritative, the UI surfaces that. When kernel choice affects what operations are possible (Manifold can't do real BREP fillets), the system is honest about the tradeoff rather than hiding it.

## System Architecture

### Layered overview

```
┌─────────────────────────────────────────────────┐
│  Authoring Surfaces                             │
│  - WYSIWYG editor                               │
│  - Code editor (Lua escape hatch)               │
│  - Import: FCStd, STEP, SCAD, STL               │
│  - Export: STL, 3MF, STEP, FCStd                │
├─────────────────────────────────────────────────┤
│  Document Model                                 │
│  - Parametric DAG                               │
│  - Merkle hashing                               │
│  - Serialization (JSON canonical form)          │
│  - Diff / merge / version operations            │
├─────────────────────────────────────────────────┤
│  VFS / Cache Layer                              │
│  - Content-addressable object store             │
│  - Multi-tier: memory → IndexedDB → remote      │
│  - Versioned cache entries with compat metadata │
│  - Async-uniform interface                      │
├─────────────────────────────────────────────────┤
│  Evaluation Engine                              │
│  - DAG walker                                   │
│  - Lua sandbox (deterministic execution)        │
│  - Geometry kernel orchestration                │
│  - LOD / quality tier management                │
├─────────────────────────────────────────────────┤
│  Geometry Kernels                               │
│  - Manifold (primary, fast, mesh-based)         │
│  - OCCT.js (escape hatch for BREP operations)   │
├─────────────────────────────────────────────────┤
│  Renderer                                       │
│  - three.js viewport                            │
│  - Progressive rendering (placeholders → final) │
│  - LOD switching                                │
├─────────────────────────────────────────────────┤
│  Output / Print Bridge (future)                 │
│  - Slicer daemon protocol                       │
│  - Print farm dispatcher                        │
└─────────────────────────────────────────────────┘
```

### Document Model

The DAG is the source of truth for everything. Structure:

**Node** = `{ id, type, params, children, hash }`

- `id`: stable identity within the document (UUID or similar). Used for direct manipulation (the editor needs stable references to nodes across edits) and not part of the hash.
- `type`: identifier for the node operation (e.g., `"box"`, `"union"`, `"lua_transform"`).
- `params`: type-specific parameter object. Canonically serialized for hashing.
- `children`: ordered list of child nodes. Order matters for non-commutative operations (difference).
- `hash`: computed `blake3(type, canonical(params), child_hashes...)`. Cached on the node; invalidated when params or children change.

The DAG is acyclic by construction (children cannot reference ancestors). References between nodes outside the parent-child relationship are not supported in v1; if needed later (for shared sub-models / instances), they become a separate concept layered on top.

**Canonical parameter serialization** is critical for hash stability. Two semantically identical parameter sets must produce byte-identical canonical forms. Use sorted-key JSON with normalized number formatting (no trailing zeros, consistent decimal representation). Test this exhaustively — it's one of the few places where subtle bugs silently degrade cache hit rates.

**Type system at node boundaries**: dual-typed (2D shapes vs 3D solids). Operations are typed: `extrude` takes 2D returns 3D, boolean operations take two 3D return 3D, etc. Catches errors at graph construction time. The Lua node escape hatch can declare its input/output types.

### Cache Key Structure

Cache keys are structured, not flat:

```
{
  semantic_hash: blake3(node_type, params, child_hashes),
  produced_by: {
    kernel: "manifold" | "occt",
    kernel_version: "x.y.z",
    engine_version: "x.y.z",
    quality_tier: "preview" | "final" | ...
  }
}
```

The `semantic_hash` identifies the geometry. The `produced_by` is provenance metadata. The cache accessor signature is:

```
get(semantic_hash, compatibility_predicate) -> CachedArtifact | null
```

Default predicate: exact version match. Future predicates: declared compatibility relations, kernel-specific preferences, quality tier selection.

This separation lets the cache accumulate multiple valid artifacts under the same semantic hash (preview and final mesh, Manifold and OCCT versions, etc.) and lets the accessor pick the right one based on context. It also handles kernel upgrades gracefully — old cached artifacts remain queryable for tools/contexts that need them.

### VFS / Object Store

Single uniform async interface. Consumers don't know which tier serves their request.

```
interface ObjectStore {
  get(hash, predicate?) -> Promise<Artifact | null>
  put(hash, artifact) -> Promise<void>
  has(hash, predicate?) -> Promise<boolean>
  delete(hash) -> Promise<void>
}
```

Tier implementations behind the same interface:

- **L1: In-memory Map**. Hot objects. Bounded by configurable memory budget. LRU eviction.
- **L2: IndexedDB**. Persistent across sessions. Large capacity. Binary-safe.
- **L3: Remote (future)**. CDN-backed, content-addressable. Enables cross-user cache sharing.

Object types stored:

- Node descriptors (small, JSON)
- Rendered meshes (large, binary — ArrayBuffer of vertex/index data)
- Bounding boxes (tiny)
- Preview thumbnails (medium, binary)
- BREP representations (when OCCT is involved)

Each type stored under a sub-key derived from the semantic hash: `{hash}:mesh`, `{hash}:bbox`, `{hash}:thumb`. Allows differential eviction (cheap-to-recompute artifacts evicted more aggressively).

Eviction policy v1: LRU with pinning of currently-active model's hashes. No garbage collection; rely on bounded cache size. GC of unreachable hashes is a later optimization.

### Evaluation Engine

DAG evaluation is lazy and memoized through the cache.

Walking a node:

1. Compute the node's hash from type + params + child hashes.
2. Query the cache for an artifact matching the hash and current context (kernel, version, quality tier).
3. If hit: return the cached artifact.
4. If miss: recursively evaluate children, then compute the node's output via the appropriate kernel, store in cache, return.

Evaluation happens in a worker (off the main thread). The main thread interacts with evaluation through a promise-based interface; the renderer can request artifacts and update progressively as they resolve.

**Lua sandbox**: Lua VM running in the worker with a restricted standard library. Exposed APIs:

- Pure math operations
- Geometry construction primitives (creating sub-nodes programmatically)
- Parameter access

Not exposed:

- I/O (filesystem, network)
- Clock / time
- Unseeded RNG (seeded RNG OK if seed is a node parameter)
- Coroutines that interact with external state

LuaNode hash includes a hash of the source code. Changing the source invalidates the cache for that node and its ancestors, which is correct.

### Geometry Kernels

**Manifold** is the primary kernel. Mesh-based, fast, clean WASM, handles boolean operations well. Used for the common case: primitives, transformations, booleans, basic operations.

**OCCT.js** is the escape hatch for BREP operations (real fillets, lofts, sweeps, NURBS surfaces). Used selectively, per-node. Larger WASM bundle, slower, but capable of operations Manifold can't do.

The kernel choice is per-node, declared by node type. A `fillet_brep` node uses OCCT; a `fillet_mesh` (mesh-level fillet approximation) uses Manifold. The cache stores per-kernel artifacts; the accessor picks based on what the consumer needs.

Conversion between kernel representations (Manifold mesh ↔ OCCT BREP) is a defined operation with its own node types. Lossy in the BREP-to-mesh direction; impossible in general for mesh-to-BREP, though for primitives generated by Manifold from known parameters, the equivalent BREP can be generated directly from those parameters via OCCT.

### Renderer

three.js viewport rendering the evaluated DAG.

**Progressive rendering**: the renderer walks the DAG, requesting meshes from the cache for each visible node. Cache hits render immediately. Cache misses kick off evaluation and render a placeholder (wireframe of bounding box, or last known mesh, or stale parent mesh). As evaluation completes, placeholders are replaced with real meshes.

**LOD**: two quality tiers initially — `preview` (low-poly, fast to compute) and `final` (full resolution). During interactive editing, request preview. After edit completes (idle for ~500ms), request final and swap in. Both are cacheable under the same semantic hash with different `quality_tier` in `produced_by`.

**Direct manipulation**: clicking geometry in the viewport selects the corresponding DAG node. The node's stable `id` is the link between rendered geometry and DAG structure. Parameter handles (gizmos for translate, rotate, scale; sliders for numeric params) are rendered based on the selected node's parameter schema.

### Authoring Surfaces

**WYSIWYG editor**: tree view of the DAG on one side, viewport on the other. Direct manipulation in the viewport edits parameters of the selected node. Tree view supports structural edits (add/remove/reorder children, wrap selection in a transform, etc.). Parameter inspector panel shows the selected node's parameters as appropriate UI controls (number inputs, sliders, vectors, color pickers, etc.) derived from the parameter schema.

**Code escape hatch (LuaNode)**: a node type that runs user-written Lua. Lua has access to a geometry construction API (creating sub-nodes), pure computation, and the node's parameters. The Lua source is part of the node's hash. Editing happens in an embedded Monaco editor or similar. Errors surface clearly in the UI.

**Textual projection (longer-term)**: the entire DAG serializable to / parseable from a Lua-embedded DSL. Users who prefer code can edit the whole model as text. The DSL is a thin wrapper around the same primitives the visual editor uses; round-trips through the DAG losslessly.

### Import / Export

**Import**:

- **STL**: imports as a leaf node containing the mesh. Not parametric; can't be customized beyond transforms. Provides a path for legacy models with the understanding that full parametric customization requires reconstruction.
- **OpenSCAD**: parse SCAD to AST, translate to DAG. Most SCAD constructs map cleanly; modules become parameterized sub-DAGs.
- **FreeCAD (FCStd)**: parse the FreeCAD document model, translate features to DAG nodes. Inherits FreeCAD's parametric models when possible.
- **STEP**: import via OCCT, represent as BREP leaf nodes. Limited parametric editing but full geometry fidelity.

**Export**:

- **STL** / **3MF**: evaluate DAG to mesh, write out. Standard 3D printing formats.
- **STEP**: requires OCCT in the evaluation path. Possible for OCCT-routed nodes; mesh-only nodes can't export STEP losslessly.
- **FCStd**: write DAG as FreeCAD document where mappings exist; LuaNodes and Manifold-specific operations may not round-trip.
- **Self (JSON DAG)**: canonical serialization. Always lossless.

### Agentic Remix and Refactoring (future)

Two related capabilities:

**STL-to-parametric reconstruction**: given an STL with no source, an LLM-driven agent attempts to identify parametric structure (this is a bracket with mounting holes; these dimensions are the customizable parameters) and produce a parametric DAG that approximates the original. Confidence-scored. Surfaced to users as "reconstructed; parameters are best-guess."

**SCAD refactoring**: given OpenSCAD source (or imported DAG from messy SCAD), an agent restructures it into clean parameterized modules. Identifies hardcoded magic numbers that should be parameters, separates geometry from configuration, applies consistent naming. Output is parametric-DAG-friendly source that the WYSIWYG editor can introspect.

**Parameter axis suggestion**: given a model that's already parameterized but minimally, an agent proposes additional parameters that would make it more flexible. "This wall thickness is hardcoded; based on usage patterns of similar models, users typically want to customize it."

These features build on the core architecture but don't drive its design. They're applications of LLM tooling layered on top of a parametric platform that exists with or without them.

### Print Bridge (future)

A local daemon (or cloud service) that wraps slicing and print dispatch. Protocol:

```
POST /print {
  model_hash: <semantic_hash>,
  mesh: <STL or 3MF bytes>,
  parameters: {
    material, layer_height, infill, supports, ...
  },
  printer: <target printer id>
}
```

Initial implementation wraps PrusaSlicer / OrcaSlicer CLI for slicing and Klipper/Moonraker for dispatch. Closed-ecosystem printers (Bambu, Prusa Connect) handled via their APIs where available, marked as second-class until they support open protocols.

The bridge is content-aware: the model hash travels with the print job, enabling future features like usage analytics ("this model has been printed N times"), version tracking ("you've already printed an earlier version of this model"), and shared print profiles ("users printing this model typically use these settings").

## Implementation Roadmap

### Phase 0: Proof of Concept (weekend project)

Validates the core architectural bet: does the Merkle DAG with VFS-backed caching produce the responsive editing experience the design depends on?

Scope:

- Manifold WASM running in a Web Worker
- DAG data structure with blake3 hashing (or SHA-256 via SubtleCrypto if blake3 setup is a hassle for the POC)
- Object store with L1 (Map) + L2 (IndexedDB), async-uniform interface
- Cache key structure with `{semantic_hash, produced_by}` even if `produced_by` is minimal
- ~6 primitive node types: `box`, `sphere`, `cylinder`, `translate`, `rotate`, `union`, `difference`
- Trivial UI: JSON editor for the DAG on one side, three.js viewport on the other
- STL export

Out of scope for POC:

- Lua / code nodes
- WYSIWYG editor
- Import from other formats
- Slicer bridge
- Persistence beyond the cache
- Anything OCCT-related

Success criteria:

- Editing a parameter triggers recomputation only of the changed subtree and its ancestors (verified by cache hit rate instrumentation)
- Editing feels responsive (sub-100ms for typical operations on small models)
- Reloading the page warm-starts from IndexedDB cache
- Architecture is sound enough to build the rest on top

### Phase 1: Foundation

Builds out the foundation into something usable.

- Full set of primitive node types (per the scope discipline list — ~20 nodes)
- LuaNode with sandboxed execution
- Basic WYSIWYG editor: tree view, viewport selection, parameter inspector
- LOD / quality tier system
- Document save/load (canonical JSON serialization)
- STL export, basic STL import (as opaque leaf nodes)
- Direct manipulation gizmos for transforms

### Phase 2: Authoring and Library

- Full WYSIWYG with structural edits, copy/paste, undo/redo
- Code editor for LuaNode with proper editing experience
- Textual DSL projection (full document as Lua-embedded code)
- Local library / save-to-cloud
- OpenSCAD import
- Sharing / public library MVP

### Phase 3: Ecosystem Integration

- FreeCAD document import
- STEP import/export via OCCT
- OCCT.js as second kernel for BREP operations
- 3MF export
- Print bridge MVP (PrusaSlicer + Klipper)

### Phase 4: Intelligence Layer

- Agentic STL-to-parametric reconstruction
- SCAD refactoring agent
- Parameter axis suggestion
- Remix graph and provenance tracking

### Phase 5: Scale

- Remote cache tier (cross-user cache sharing)
- Print farm dispatcher
- Closed-ecosystem printer integrations
- Collaboration features (multi-user editing on shared models)

## Open Questions Carried Forward

These are decisions deliberately deferred until evidence accumulates.

**Hashing function**: blake3 for speed; SHA-256 acceptable for POC. Likely blake3 long-term.

**Compatibility relation between kernel versions**: starts as exact-match; relaxed as compat declarations accumulate. The architecture supports this without restructuring.

**Lua vs JavaScript vs Python for code nodes**: Lua is the current preference (small, embeddable, fast, sandboxing-friendly). Multiple languages possible long-term since the DAG is the truth and language is a binding.

**N-ary vs binary boolean operations**: n-ary at API level, binary under the hood. Cache at both levels.

**LOD strategy**: two tiers initially (preview, final). May expand to continuous LOD or view-dependent LOD later.

**Cache GC**: deferred until cache size becomes a problem. LRU + bounded size is sufficient until then.

**Shared sub-models / instances**: not in v1. The DAG is a tree, not a DAG with shared subtrees, in the user-facing model. Internal cache deduplication via content addressing handles the "same subtree appears in multiple places" case efficiently anyway.

**Constraint solver**: out of scope. The system is parametric (parameters drive geometry) but not constraint-based (geometric relationships drive parameters). Constraint solving is a substantial additional system that 3D printing use cases largely don't need.

## Decisions Made and Why

A summary of the load-bearing decisions for future reference:

1. **Parametric DAG as source of truth, mesh as derived artifact** — inverts the current ecosystem's STL-centric model; everything downstream follows from this.

2. **Merkle hashing of the DAG** — provides caching, incremental recomputation, sharing, and provenance as a single mechanism.

3. **VFS abstraction over multi-tier cache** — uniform async interface lets the system evolve from in-browser POC to distributed cache without restructuring consumers.

4. **Structured cache keys (semantic_hash + produced_by)** — separates "what is this geometry" from "which implementation produced it"; enables graceful handling of kernel upgrades, multiple kernels, multiple quality tiers under one semantic identity.

5. **Manifold as primary kernel** — fast, mesh-based, sufficient for 95% of 3D printing use cases; OCCT.js as escape hatch for the rest.

6. **Lua as escape-hatch language** — small, embeddable, sandbox-friendly, fast enough for node evaluation; the language is a binding to the DAG, not the source of truth.

7. **Code as a node type, not a separate mode** — avoids the unsolvable round-trip-arbitrary-code-to-visual-representation problem.

8. **Determinism as a hard invariant** — required for the Merkle DAG to work; constrains code node sandbox design.

9. **Dual type system (2D shapes vs 3D solids)** — catches errors at graph construction, matches what users intuitively expect.

10. **Open source CAD projects as specification documents, not architectural references** — leverage their test corpora and forum-documented edge cases; design fresh from current understanding.

11. **3D printing scope discipline** — explicitly out of scope: complex surface modeling, large assemblies, constraint solving, mold/draft analysis. This is what keeps the architecture tractable.

12. **Multiple authoring surfaces, one DAG** — visual editor, code, imports, all converge on the DAG; round-tripping happens through the DAG, not between surfaces.
