# Lua Sub-DAG Inspection via Cached Expansion Docs

**Status:** Approved
**Date:** 2026-05-29
**Scope:** `@yacad/cache`, `@yacad/engine`, `@yacad/worker`, `apps/studio2`

## Problem

Lua nodes are opaque in the tree view. The `ExpandableNodeType` abstraction generates a sub-DAG at evaluation time (`engine.ts` expandable branch, lines 249–310), but the resolved `NodeDoc` is discarded after geometry is produced. Neither humans nor agents can see what the script actually built — the tree shows a Lua node as a leaf terminator.

For debugging, learning, and agentic review, seeing the expanded structure is essential: "what did this script actually build?"

## Design Decision: Cache the Expanded NodeDoc

The resolved `NodeDoc` is trivial in size compared to the mesh geometry it produces (kilobytes of JSON vs megabytes of vertex/index buffers). Rather than re-expanding on demand or carrying expansion docs in the evaluate result payload, we store them in the existing L1/L2 tiered cache alongside geometry artifacts.

This gives us:

- **Consistency:** The cached doc is exactly what was evaluated, not a re-expansion that might differ
- **Zero overhead on the hot path:** Cache write happens only on misses, alongside the geometry write
- **Lifecycle for free:** Expansion docs evict alongside geometry — same LRU, same IndexedDB persistence, same `clearCache()` behavior
- **On-demand retrieval:** Pure cache read, same pattern as `getGeometry`

### Alternatives Considered

**A. Return in `EvaluateResult`:** Bloats every postMessage with sub-DAGs the UI usually doesn't need. Rejected for overhead on the common path.

**B. Re-expand on demand via worker message:** Calls `expand()` again, which may be non-trivial for complex Lua scripts and could produce different results if the doc changed between evaluation and request. Rejected for inconsistency and redundant work.

## Cache Key Design

Expansion docs share the outer node's `semanticHash` (the expansion is fully determined by the node's identity — its type, params, and children hashes). They're discriminated by a synthetic `producedBy` entry:

```typescript
{
  semanticHash: node.hash,
  producedBy: {
    kernel: '__expansion',       // synthetic — cannot collide with real kernel names
    kernelVersion: '0',          // expansion has no kernel version
    engineVersion: ENGINE_VERSION,
    qualityTier: tier,           // match the evaluation context
  },
}
```

`engineVersion` and `qualityTier` are preserved so expansion docs invalidate alongside geometry when versions change. The `'__expansion'` kernel name is a reserved string that no real kernel will use (Manifold is `'manifold'`, future OCCT would be `'occt'`).

## New Artifact Kind: `expandedDoc`

The cache's `ArtifactKind` union gains a new member:

```typescript
type ArtifactKind = 'mesh' | 'crossSection' | 'expandedDoc';
```

The stored artifact shape:

```typescript
interface ExpandedDocArtifact {
  kind: 'expandedDoc';
  doc: NodeDoc;
}
```

The cache's `get(key, kind)` method already discriminates on artifact kind, so `expandedDoc` lookups never collide with mesh/crossSection lookups under the same semantic hash.

### Serialization for IndexedDB (L2)

`NodeDoc` is a plain JSON-serializable tree (`{ type, params, children }`). IndexedDB stores it via structured clone — no special serialization needed. This is simpler than mesh artifacts, which require `Float32Array`/`Uint32Array` handling.

## Engine Change

One site in `engine.ts`, in the expandable branch (~line 268). After `resolveInputRefs` produces the resolved `NodeDoc` and before recursing into `walk()`:

```typescript
// Cache the resolved expansion doc for later inspection.
const expansionKey = this.expansionKeyFor(node, tier);
await this.store.put(expansionKey, { kind: 'expandedDoc', doc: resolved });
```

The `expansionKeyFor` helper constructs the synthetic cache key described above.

**On outer cache hits** (line 187): The expansion doc was already cached during the prior miss that produced the geometry. No additional work needed — both artifacts are warm.

**On cache misses:** The expansion doc write happens before the recursive `walk()`, so even if evaluation fails partway through the sub-DAG, the expansion doc is available for debugging.

## Worker Protocol

New request/response pair, following the exact pattern of `getGeometry`:

```typescript
interface GetExpandedDocRequest {
  id: number;
  kind: 'getExpandedDoc';
  hash: string;
  tier?: string;
}

interface GetExpandedDocOk {
  id: number;
  kind: 'expandedDoc';
  ok: true;
  doc: NodeDoc;
}

interface GetExpandedDocErr {
  id: number;
  kind: 'expandedDoc';
  ok: false;
  error: string;
}
```

**WorkerClient method:**

```typescript
async getExpandedDoc(hash: string, tier = 'final'): Promise<NodeDoc | null>
```

**Host handler:** Constructs the synthetic expansion cache key from `hash` + tier, calls `store.get(key, 'expandedDoc')`, returns the doc or null. Pure cache read — no expansion logic, no Lua runtime involvement.

## UI: Tree View

### Expand Affordance

Lua nodes get a distinct disclosure control, visually differentiated from the normal child-toggle triangle. This communicates "this node has generated content you can inspect" rather than "this node has authored children."

When clicked:

1. Send `getExpandedDoc(node.hash)` to the worker
2. On response, render the sub-DAG tree below the Lua node
3. Cache the response in component state so re-collapsing/expanding doesn't re-fetch

### Visual Distinction for Derived Nodes

Derived (generated) nodes must never be confused with authored nodes:

- **Muted color** — lower opacity or a distinct hue (e.g., desaturated blue vs the normal foreground)
- **Italic labels** — text style signals "derived, not authored"
- **Dashed indent guide** — the vertical connector line between derived nodes uses dashes instead of solid
- **Collapse boundary** — a subtle separator between the Lua node and its derived subtree

Default state: **collapsed**. The user opts in to seeing the expansion.

### Selection

Derived nodes are selectable (clicking them drives the inspector), but selection uses a separate ID namespace or a flag to distinguish derived selections from authored selections. This prevents the mutation tools from activating.

## UI: Inspector

### Read-Only Mode

When a derived node is selected:

- Inspector renders the same param display as authored nodes
- All inputs are **disabled** — no editing
- No mutation toolbar (wrap, add child, delete, move)
- Inspector header shows a **"generated"** badge with muted styling
- A hint: "Edit the Lua source to change this node"

### Implementation

The `InspectorPane` component receives a `readonly` flag (or derives it from the selection state). When true, it disables all form inputs and hides mutation controls. This is a presentation-layer change — the inspector already renders params from a node; it just needs a mode where those params are non-interactive.

## What This Design Intentionally Excludes

- **Inner perNode exposure:** Per-node timings for sub-DAG nodes stay aggregated into the outer Lua node's `NodeEval` stats. Surfacing them individually is a follow-up if useful for performance debugging.
- **Editing derived nodes:** They are read-only projections. The Lua source is the editing surface.
- **Streaming/progressive expansion:** Single cache read after evaluation. No incremental rendering of partial sub-DAGs.
- **MCP integration:** The MCP server could expose `getExpandedDoc` for agentic inspection, but that's additive and not part of this spec.

## Invariant Compliance

- **#1 (DAG is source of truth):** Expansion docs are derived artifacts, cached like meshes. The authored `NodeDoc` remains the source of truth.
- **#2 (Determinism):** Same inputs → same expansion. The cached doc is consistent with the cached geometry.
- **#3 (Structured cache keys):** Expansion docs use the same structured key scheme, discriminated by the synthetic `'__expansion'` kernel.
- **#10 (Subtree closure):** Expansion docs only contain the subtree rooted at the expandable node. No cross-subtree references.
- **#11 (Analyzer/runtime parity):** Not applicable — no new analyzer surface.

## Test Strategy

- **Cache round-trip:** Put an expansion doc, get it back by key. Verify kind discrimination (getting `'mesh'` for the same hash returns null for `'expandedDoc'` and vice versa).
- **Engine integration:** Evaluate a Lua node, verify the expansion doc is cached. Re-evaluate (cache hit on outer node), verify expansion doc is still retrievable.
- **Worker protocol:** Send `getExpandedDoc` for a known hash after evaluation, verify the returned `NodeDoc` matches the expected expansion.
- **Cache clearing:** After `clearCache()`, verify expansion docs are gone alongside geometry.
