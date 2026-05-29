---
topic: future-explorations
tags:
- ideas
- exploration
- future
- running-list
- lua
- composition
- modularity
- status-tracking
files:
- packages/lua
- packages/dag/src/expand.ts
- docs/vision.md
- apps/studio2/src/ui/ViewportPane.svelte
- apps/studio2/src/ui/TreeNode.svelte
- apps/studio2/src/ui/InspectorPane.svelte
- packages/render/src/viewport.ts
- apps/mcp
created: '2026-05-29T12:46:53.705081Z'
updated: '2026-05-29T14:59:45.184870Z'
---

## Future Explorations

A running list of concepts and ideas to explore. Each entry captures the idea, why it's interesting, and any initial thoughts on approach. Entries marked **SHIPPED** or **PARTIALLY SHIPPED** describe what landed and what remains.

---

### Lua Node Sub-DAG Inspection in Tree View — SHIPPED

**Status:** Fully implemented and merged to main.

**What shipped:**

- Engine caches the expanded `NodeDoc` as an `expandedDoc` artifact in the content-addressable cache, keyed by the Lua node's semantic hash with a synthetic `__expansion` kernel provenance key
- `WorkerClient` exposes `getExpandedDoc(hash, tier)` to fetch cached expansions from the main thread
- `TreeNode.svelte` detects expandable nodes post-evaluation, fetches their expanded sub-DAG, and renders derived children with visual distinction (muted color, italic labels, dashed indent lines)
- `InspectorPane.svelte` shows read-only inspectors for derived nodes (detected via `/__expanded/` in the selected path) — all mutation controls disabled, "Generated node" badge displayed
- Worker protocol includes `getExpandedDoc` request/response messages
- Disclosure triangle on Lua nodes expands/collapses the generated sub-DAG; default state is collapsed

**Related commits:** Sub-DAG inspection implementation plan (6 tasks), all landed.

---

### Isolated Node Inspection Mode — SHIPPED (MVP)

**Status:** Core MVP shipped as "Focus mode" in the viewport toolbar.

**What shipped:**

- **Focus/Unfocus button** in `ViewportPane.svelte` toolbar — when a node is selected, click "Focus" (or press **F** key) to render only that node's cached geometry, stripped of parent transforms
- Implementation: looks up `cache[selectedNode.hash]` via `WorkerClient.getGeometry()` and renders it in isolation instead of the root geometry
- Exits automatically on selection change, or manually via "Unfocus" button / F key
- Works for both authored nodes and derived (expanded sub-DAG) nodes

**What remains (future iterations):**

- **Context slider** — progressive levels from fully isolated to fully composed (show with immediate parent transform, or full ancestor chain)
- **Pairs with boolean wireframe idea** — isolation mode shows the node's output; wireframe mode would show the node's inputs
- **Zoom-to-fit on focus** — auto-frame the isolated geometry when entering focus mode

---

### CAD Viewport Navigation Controls — PARTIALLY SHIPPED

**Status:** Viewport toolbar with core controls shipped. Some items remain.

**What shipped:**

- **Display mode toggle** — solid/wireframe/solid+wireframe modes in viewport toolbar
- **Camera presets** — Front, Back, Left, Right, Top, Bottom, Isometric one-click views
- **Axis labels** — AxesHelper with text sprites showing kernel convention (X red, Y blue, Z green/up)
- **Coordinate transform** — Z-up→Y-up swizzle `(x, y, z) → (x, z, -y)` applied consistently across 3D mesh, 2D fill, 2D outline, and bbox paths
- **Focus/Unfocus** (see Isolated Node Inspection Mode above)

**What remains:**

- **Zoom to extents** (home button) — fit entire scene in viewport
- **Zoom to selected** — fit selected node's bounding box
- **Explicit zoom +/- buttons** — accessibility for trackpad users
- **Orthographic camera mode** — camera presets currently use perspective; true CAD orthographic views would be more precise

---

### MCP Server — From Prototype to Workflow Tool — PARTIALLY SHIPPED

**Status:** MCP server exists with core CRUD + mutation + export tools. Documentation and discoverability gaps remain.

**What shipped:**

- `apps/mcp` — MCP server with document library CRUD, DAG reading, mutations (`setParam`, `addChild`, `removeAt`, `wrapWith`, `moveChild`, `replaceAt`, `unwrap`), Lua definition management (`addLuaDefinition`, `validateLuaCode`), exports (STL/SVG/DXF/PNG), cache control, viewer URL management
- Bundled with esbuild for Node compatibility

**What remains:**

- **Lua reference via MCP** — expose `geo.*` API surface, sandbox globals, available environment. Agents have no way to discover what's available in the Lua sandbox
- **Language reference via MCP** — per-node-type docs (params, children, type constraints). `paramSchema` exists but isn't exposed through MCP tool descriptions
- **Examples via MCP** — sample Lua definitions, common patterns, queryable showcase examples
- **Example workflows** — step-by-step multi-tool authoring guides for agents
- **Parameter enumeration** — `getParamSchema` tool or richer tool descriptions so agents know what params a `box` accepts

---

### Lua Children as Addressable Module Library

**Status:** Not started — exploration/ideation only.

**Core idea:** Today, declared children of Lua nodes are DAG nodes that get rendered. What if they were instead **addressable modules** that the Lua script can compose and script around — not direct geometry for the renderer?

**Example:** A "castle" Lua node declares children like `battlement`, `tower`, `crenellation`. These aren't geometry leaves — they're **assembly definitions** that the Lua script references by name, places, repeats, and parameterizes. The child declarations become a named library of composable parts.

**Why it matters:**

- Turns Lua nodes from "code that generates a fixed sub-DAG" into "code that orchestrates a library of sub-assemblies"
- Makes the Lua authoring model closer to how people think about parametric design: named parts composed into wholes
- Children become the modular API surface — swap a `tower` implementation and the castle updates
- Natural fit for the existing Merkle architecture: each child module still has its own hash, so caching works per-module

**Tension with current design:**

- Today `ExpandableNodeType` children are part of the expanded sub-DAG that the engine walks. This would change the semantics of what "child" means for Lua nodes
- Need to think about how this interacts with invariant #10 (subtree closure) — modules would need to be within the node's subtree
- The `inputRef` / input-introspection design exploration in the vision may already point toward this

**Possible resolution — schema extension for non-evaluated subtrees:**

- Rather than overloading `children`, introduce a schema-level distinction: some declared subtree slots are **module declarations** that aren't evaluated directly as DAG children
- The engine skips them during normal tree-walk; the Lua script pulls them in explicitly when composing its output sub-DAG
- This preserves the existing child semantics (children = geometry the engine evaluates) while adding a new concept (modules = addressable templates the script composes with)
- Open question: how does this interact with hashing? Module declarations are still part of the node's identity (they affect what the Lua script produces), so they'd need to contribute to the semantic hash even though the engine doesn't walk them directly

**Related:** `docs/vision.md` (expandable nodes, input introspection), `@yacad/lua`, `@yacad/dag` (ExpandableNodeType)

---

### Wireframe Visualization for Boolean Operations

**Status:** Not started — exploration/ideation only.

**Core idea:** Boolean nodes are hard to understand because you can only see the result — the interactions between children are invisible. Show **wireframes of the direct children** when the node is selected in editing mode.

**Why it matters:**

- `difference(A, B)` hides B entirely (subtracted). `intersection(A, B)` loses everything outside the overlap. `union(A, B)` merges boundaries. In all cases the spatial relationship between inputs is lost in the output
- Wireframe overlays of the children would show how the inputs relate spatially — the "before" alongside the "after"

**Design sketch:**

- When any boolean node is selected, render its direct children as translucent wireframes alongside the solid result
- Could extend to any node type where child geometry isn't directly visible in the output
- The renderer already has the child meshes (they're cached) — this is a presentation-layer change, not an engine change
- Could be a toggle or automatic on selection

**Related:** `@yacad/render`, `apps/studio2` (selection-driven viewport behavior)

---

### Semantic Intent Metadata on Nodes

**Status:** Not started — exploration/ideation only.

**Core idea:** Nodes should carry **semantic metadata** describing what they contribute to the whole — not just structural position in the DAG, but _intent_.

**Why it matters:**

- The DAG provides structural ownership (what's a child of what), but not _why_ a node exists
- A `translate` node might be "positioning the handle" or "creating clearance for assembly" — structurally identical, semantically different
- **Critical for agentic authoring:** when an AI agent builds or modifies a model, every node it creates should declare its purpose
- Could enable intent-aware diffing: "this change modified the handle clearance" vs "this change modified a translate node"

**Design considerations:**

- Could be a `meta` or `intent` field on `Node` — free-form or structured?
- Should it affect the hash? Probably not (same geometry regardless of intent) — but then it's the first piece of node data that's explicitly hash-excluded
- Natural fit for the social/remix layer from the vision: when browsing shared models, intent metadata makes them self-documenting

**Related:** `@yacad/dag` (Node model), `docs/vision.md` (social layer, remix tracking), agentic authoring workflows

---

### Mobile Layout — Renderer with Slide-Over Sheets

**Status:** Not started — exploration/ideation only.

**Core idea:** Replace rigid three-pane layout with a **renderer-first layout** where tree and inspector are dismissable slide-over sheets — **everywhere, not just mobile**.

**Key insight — same model, different defaults:**

- Desktop: sheets default **open** (behaves like current three-pane layout)
- Mobile: sheets default **closed** (full-screen viewport with toggle buttons)
- Same component model either way — just different initial state and breakpoint-driven defaults

**MVP approach — click expanders, not gestures:**

- Always-present **click/tap expander buttons** (tab icons pinned to screen edge) to toggle sheets open/closed
- Eliminates gesture conflict problem (orbit/pan/zoom vs swipe-to-reveal) completely
- Viewport stays full-size underneath, sheets overlay

**Related:** `apps/studio2` (layout shell), responsive design

---

### WYSIWYG Direct Manipulation MVP

**Status:** Not started — exploration/ideation only.

**Core idea:** Click-to-select, drag-to-move/resize in the 3D viewport — the foundational interaction model for visual CAD editing.

**Interaction model:**

- **Select:** click-intersect on mesh to select the producing node. Raycasting → mesh → lookup which DAG node produced it
- **Drill into assemblies:** double-click to enter a group/assembly's scope (same focused mode as isolation mode)
- **Resize:** corner-drag on bounding box handles. Mutate the rendered mesh directly during drag (scale the three.js object), bypassing kernel re-evaluation until mouse release. On release, compute the actual param delta and commit it to the DAG
- **Move:** axis-constrained drag handles (translate gizmo). Same pattern — mutate rendered position during drag, commit `translate` param change on release

**Design considerations:**

- The "mutate mesh during drag, commit on release" pattern is critical for responsiveness — kernel evaluation can take 10-100ms+, too slow for 60fps drag feedback
- Different node types have different manipulation affordances (box has resize handles; translate has axis arrows; rotate has arc handles)
- Pairs with isolation mode for drill-into, and with the sheet layout where the viewport is always the primary surface

**Related:** `@yacad/render` (raycasting, gizmos), `@yacad/mutations` (param changes), `apps/studio2` (viewport interaction layer)