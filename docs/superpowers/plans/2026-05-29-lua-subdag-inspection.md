# Lua Sub-DAG Inspection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cache the resolved `NodeDoc` for Lua nodes alongside geometry, serve it on demand via worker protocol, and display it in the tree view with read-only inspectors.

**Architecture:** New `expandedDoc` artifact kind in the cache. Engine stores expansion docs on miss. Worker protocol gains `getExpandedDoc` (same pattern as `getGeometry`). Tree view fetches expansion on user click, renders derived nodes with visual distinction and read-only inspectors.

**Tech Stack:** TypeScript, Vitest, Svelte 5

**Spec:** `docs/superpowers/specs/2026-05-29-lua-subdag-inspection-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `packages/cache/src/types.ts` | Add `ExpandedDocArtifact`, extend `ArtifactKind` and `Artifact` unions |
| Modify | `packages/cache/src/store.test.ts` | Round-trip test for `expandedDoc` artifact kind |
| Modify | `packages/engine/src/engine.ts` | Cache expansion doc in expandable branch |
| Modify | `packages/engine/src/engine.test.ts` | Verify expansion doc is cached after Lua evaluation |
| Modify | `packages/worker/src/protocol.ts` | `GetExpandedDocRequest` / response types |
| Modify | `packages/worker/src/host.ts` | `handleGetExpandedDoc` handler |
| Modify | `packages/worker/src/client.ts` | `getExpandedDoc()` method |
| Modify | `packages/worker/src/index.ts` | Re-export new protocol types |
| Modify | `apps/studio2/src/ui/TreeNode.svelte` | Expansion affordance for Lua nodes, derived node rendering |
| Modify | `apps/studio2/src/ui/InspectorPane.svelte` | Read-only mode for derived nodes |
| Modify | `apps/studio2/src/ui/inspectors/KernelInspector.svelte` | Accept `readonly` prop |
| Modify | `apps/studio2/src/app.css` | Styles for derived nodes |
| Modify | `apps/studio2/src/App.svelte` | Thread `client` to TreePane for expansion fetches |

---

### Task 1: Add `expandedDoc` Artifact Kind to Cache

**Files:**
- Modify: `packages/cache/src/types.ts`
- Test: `packages/cache/src/store.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/cache/src/store.test.ts`:

```typescript
import { storageKey, type CacheKey, type MeshArtifact, type ExpandedDocArtifact } from './types';

// Add after the existing mesh() helper:
function expandedDoc(): ExpandedDocArtifact {
  return {
    kind: 'expandedDoc',
    doc: {
      type: 'union',
      params: {},
      children: [
        { type: 'box', params: { size: [10, 10, 10] } },
        { type: 'sphere', params: { radius: 5 } },
      ],
    },
  };
}
```

Add a new `describe` block after the existing `MemoryStore` tests:

```typescript
describe('expandedDoc artifact kind', () => {
  it('round-trips through MemoryStore', async () => {
    const store = new MemoryStore();
    const k = key('lua-abc');
    await store.put(k, expandedDoc());
    const got = await store.get(k, 'expandedDoc');
    expect(got).toEqual(expandedDoc());
  });

  it('does not collide with mesh under the same semantic hash', async () => {
    const store = new MemoryStore();
    const k = key('same-hash');
    await store.put(k, mesh(1));
    await store.put(k, expandedDoc());
    const gotMesh = await store.get(k, 'mesh');
    const gotDoc = await store.get(k, 'expandedDoc');
    expect(gotMesh).toEqual(mesh(1));
    expect(gotDoc).toEqual(expandedDoc());
  });

  it('storageKey separates expandedDoc from mesh', () => {
    const k = key('h');
    expect(storageKey(k, 'expandedDoc')).not.toBe(storageKey(k, 'mesh'));
    expect(storageKey(k, 'expandedDoc')).toContain('h:expandedDoc:');
  });

  it('clears alongside other artifacts', async () => {
    const store = new MemoryStore();
    await store.put(key('a'), expandedDoc());
    await store.clear();
    expect(await store.has(key('a'), 'expandedDoc')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/cache/src/store.test.ts`
Expected: FAIL — `ExpandedDocArtifact` type does not exist yet.

- [ ] **Step 3: Add types to cache package**

In `packages/cache/src/types.ts`, add the structural placeholder and extend the unions:

```typescript
/**
 * Structural placeholder for an expanded sub-DAG document. The real `NodeDoc`
 * from @yacad/dag is structurally assignable. We keep @yacad/cache free of
 * @yacad/dag imports so the dep graph stays acyclic (same pattern as
 * LuaDefinitionLike and CrossSectionLike).
 */
export interface NodeDocLike {
  readonly type: string;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly children?: readonly NodeDocLike[];
}

export interface ExpandedDocArtifact {
  readonly kind: 'expandedDoc';
  readonly doc: NodeDocLike;
}
```

Update `ArtifactKind`:

```typescript
export type ArtifactKind = 'mesh' | 'bbox' | 'luaDefinition' | 'crossSection' | 'expandedDoc';
```

Update `Artifact`:

```typescript
export type Artifact = MeshArtifact | BBoxArtifact | LuaDefinitionArtifact | CrossSectionArtifact | ExpandedDocArtifact;
```

- [ ] **Step 4: Verify the export in `packages/cache/src/index.ts`**

Add `ExpandedDocArtifact` and `NodeDocLike` to the type exports if not already covered by the existing wildcard/barrel export.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run packages/cache/src/store.test.ts`
Expected: PASS — all new and existing tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/cache/src/types.ts packages/cache/src/index.ts packages/cache/src/store.test.ts
git commit -m "feat(cache): add expandedDoc artifact kind for Lua sub-DAG inspection"
```

---

### Task 2: Cache Expansion Doc in Engine

**Files:**
- Modify: `packages/engine/src/engine.ts`
- Test: `packages/engine/src/engine.test.ts`

**Context:** The engine test file already has a Lua/expandable node test setup. Read `packages/engine/src/engine.test.ts` to find the existing expandable-node tests and follow their patterns (fake `ExpandableNodeType`, fake resolver, etc). The test needs to verify that after evaluating a document containing a Lua node, an `expandedDoc` artifact is present in the cache under the synthetic `__expansion` key.

- [ ] **Step 1: Write the failing test**

Add to `packages/engine/src/engine.test.ts`, in or after the existing expandable-node test suite. Import `ExpandedDocArtifact` from `@yacad/cache` at the top of the file alongside the existing cache imports:

```typescript
it('caches the resolved expansion doc for expandable nodes', async () => {
  // Use the existing test setup for expandable nodes (fake ExpandableNodeType, etc).
  // After engine.evaluate(root, 'final'):
  const expansionKey: CacheKey = {
    semanticHash: /* the Lua node's hash from the evaluated root */,
    producedBy: {
      kernel: '__expansion',
      kernelVersion: '0',
      engineVersion: ENGINE_VERSION,
      qualityTier: 'final',
    },
  };
  const artifact = await store.get(expansionKey, 'expandedDoc');
  expect(artifact).toBeDefined();
  expect(artifact!.kind).toBe('expandedDoc');
  // Verify the doc structure matches what expand() returns (after input-ref resolution).
  expect((artifact as ExpandedDocArtifact).doc.type).toBe(/* root type of the expected sub-DAG */);
});
```

Adapt the test to use whichever fake expandable setup already exists in the test file. The key assertion: `store.get(expansionKey, 'expandedDoc')` returns the resolved `NodeDoc`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/engine/src/engine.test.ts -t "caches the resolved expansion doc"`
Expected: FAIL — the engine doesn't store expansion docs yet.

- [ ] **Step 3: Add `expansionKeyFor` helper and cache write to engine**

In `packages/engine/src/engine.ts`, add a private helper to the `Engine` class:

```typescript
private expansionKeyFor(node: Node, qualityTier: string): CacheKey {
  return {
    semanticHash: node.hash,
    producedBy: {
      kernel: '__expansion',
      kernelVersion: '0',
      engineVersion: this.engineVersion,
      qualityTier,
    },
  };
}
```

In the expandable branch of `walk()`, after `resolveInputRefs` produces `resolved` and before the `buildGraph` + recursive walk, add:

```typescript
// Cache the resolved expansion doc for later inspection.
await this.store.put(
  this.expansionKeyFor(node, tier),
  { kind: 'expandedDoc', doc: resolved },
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/engine/src/engine.test.ts`
Expected: PASS — all tests green including the new one.

- [ ] **Step 5: Verify expansion doc survives outer cache hit**

Add a second test:

```typescript
it('expansion doc is available even on outer cache hit', async () => {
  // Evaluate twice. Second call hits the outer cache (geometry is warm).
  // Verify the expansion doc is still retrievable.
  await engine.evaluate(root, 'final');
  const result2 = await engine.evaluate(root, 'final');
  expect(result2.perNode[/* lua node index */].hit).toBe(true);
  const artifact = await store.get(expansionKey, 'expandedDoc');
  expect(artifact).toBeDefined();
});
```

Run: `pnpm vitest run packages/engine/src/engine.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/engine/src/engine.ts packages/engine/src/engine.test.ts
git commit -m "feat(engine): cache resolved expansion doc for expandable nodes"
```

---

### Task 3: Worker Protocol — `getExpandedDoc` Message

**Files:**
- Modify: `packages/worker/src/protocol.ts`
- Modify: `packages/worker/src/host.ts`
- Modify: `packages/worker/src/client.ts`
- Modify: `packages/worker/src/index.ts`

**Context:** This follows the exact pattern of the existing `getGeometry` message. Read `packages/worker/src/host.ts` function `handleGetGeometry` and `packages/worker/src/client.ts` method `getGeometry()` as templates.

- [ ] **Step 1: Add protocol types**

In `packages/worker/src/protocol.ts`:

```typescript
export interface GetExpandedDocRequest {
  readonly id: number;
  readonly kind: 'getExpandedDoc';
  readonly hash: string;
  readonly tier?: string;
}

export interface GetExpandedDocOk {
  readonly id: number;
  readonly kind: 'expandedDoc';
  readonly ok: true;
  readonly doc: NodeDoc;
}

export interface GetExpandedDocErr {
  readonly id: number;
  readonly kind: 'expandedDoc';
  readonly ok: false;
  readonly error: string;
}
```

Add `GetExpandedDocRequest` to the `WorkerRequest` union. Add `GetExpandedDocOk | GetExpandedDocErr` to the `WorkerResponse` union.

Import `NodeDoc` from `@yacad/dag` at the top of the file (it's already a dependency of the worker package).

- [ ] **Step 2: Add host handler**

In `packages/worker/src/host.ts`, add after the `handleGetGeometry` function:

```typescript
async function handleGetExpandedDoc(
  scope: WorkerScope,
  backend: Promise<Backend> | undefined,
  req: GetExpandedDocRequest,
): Promise<void> {
  if (!backend) {
    scope.postMessage({ id: req.id, kind: 'expandedDoc', ok: false, error: 'engine not initialized' });
    return;
  }
  try {
    const { store } = await backend;
    const tier = req.tier ?? 'final';
    const key: CacheKey = {
      semanticHash: req.hash,
      producedBy: {
        kernel: '__expansion',
        kernelVersion: '0',
        engineVersion: ENGINE_VERSION,
        qualityTier: tier,
      },
    };
    const artifact = await store.get(key, 'expandedDoc');
    if (artifact && artifact.kind === 'expandedDoc') {
      scope.postMessage({ id: req.id, kind: 'expandedDoc', ok: true, doc: artifact.doc });
      return;
    }
    scope.postMessage({
      id: req.id,
      kind: 'expandedDoc',
      ok: false,
      error: `no cached expansion doc for hash ${req.hash}`,
    });
  } catch (err) {
    scope.postMessage({
      id: req.id,
      kind: 'expandedDoc',
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
```

Add the dispatch case in `scope.onmessage`, before the `evaluate` case:

```typescript
if (req.kind === 'getExpandedDoc') {
  void handleGetExpandedDoc(scope, backend, req);
  return;
}
```

Import the new types: `GetExpandedDocRequest` from `./protocol`, and `CacheKey` from `@yacad/cache`, and `ENGINE_VERSION` from `@yacad/engine` (already imported).

- [ ] **Step 3: Add client method**

In `packages/worker/src/client.ts`, add after the `getGeometry` method:

```typescript
/**
 * Look up a cached expansion doc by its semantic hash. Returns the resolved
 * NodeDoc if found, or `null` if nothing is cached. Pure cache read.
 */
async getExpandedDoc(hash: string, tier = 'final'): Promise<import('@yacad/dag').NodeDoc | null> {
  const res = await this.send({ id: 0, kind: 'getExpandedDoc', hash, tier });
  const g = res as { ok: boolean; doc?: unknown };
  if (g.ok) return (g as { ok: true; doc: import('@yacad/dag').NodeDoc }).doc;
  return null;
}
```

- [ ] **Step 4: Export new types from worker package**

In `packages/worker/src/index.ts`, add to the protocol re-exports:

```typescript
export type { GetExpandedDocOk, GetExpandedDocErr } from './protocol';
```

- [ ] **Step 5: Build and test**

Run: `pnpm build && pnpm test`
Expected: PASS — full build and all 728+ tests green.

- [ ] **Step 6: Commit**

```bash
git add packages/worker/src/protocol.ts packages/worker/src/host.ts packages/worker/src/client.ts packages/worker/src/index.ts
git commit -m "feat(worker): add getExpandedDoc protocol message for Lua sub-DAG inspection"
```

---

### Task 4: Tree View — Expansion Affordance and Derived Node Rendering

**Files:**
- Modify: `apps/studio2/src/ui/TreeNode.svelte`
- Modify: `apps/studio2/src/ui/TreePane.svelte`
- Modify: `apps/studio2/src/App.svelte`
- Modify: `apps/studio2/src/app.css`

**Context:** Read `apps/studio2/src/ui/TreeNode.svelte` and `apps/studio2/src/ui/TreePane.svelte` before starting. `TreeNode` is a recursive component. The tree currently renders Lua nodes as leaves (no expand for sub-DAG). The `viewerMode` prop is already threaded through to disable editing — the `readonly` concept for derived nodes is analogous.

This task is UI-only and cannot be unit-tested with Vitest (it's Svelte component wiring). Verify with `pnpm --filter @yacad/studio2 check` (svelte-check) and visual inspection via `pnpm dev`.

- [ ] **Step 1: Thread `client` into TreePane**

In `apps/studio2/src/App.svelte`, pass `client` to `TreePane`:

```svelte
<TreePane {session} {selection} {outputTypes} onExport={exportNode} {viewerMode} {client} />
```

In `apps/studio2/src/ui/TreePane.svelte`, add `client` to the Props interface:

```typescript
import type { WorkerClient } from '@yacad/worker';

interface Props {
  session: SessionState;
  selection: SelectionState;
  outputTypes: Map<string, '2d' | '3d'>;
  onExport: (path: string, format: ExportFormat) => Promise<void>;
  viewerMode: boolean;
  client?: WorkerClient;
}
```

Pass it through to `TreeNode`:

```svelte
<TreeNode doc={session.doc} path="$" {selection} {outputTypes} onExport={onExport} {viewerMode} {client} />
```

- [ ] **Step 2: Add expansion state and fetch to TreeNode**

In `apps/studio2/src/ui/TreeNode.svelte`, add to Props:

```typescript
import type { WorkerClient } from '@yacad/worker';
import type { NodeDoc } from '@yacad/dag';

interface Props {
  // ... existing props
  client?: WorkerClient;
  derived?: boolean;        // true when this node is part of an expanded sub-DAG
  perNode?: readonly import('@yacad/engine').NodeEval[];  // for hash lookup
}
```

Add expansion state:

```typescript
let expansionOpen = $state(false);
let expansionDoc = $state<NodeDoc | null>(null);
let expansionLoading = $state(false);

// Determine if this node is expandable (type === 'lua')
const isExpandable = $derived(doc.type === 'lua');

async function toggleExpansion() {
  if (expansionOpen) {
    expansionOpen = false;
    return;
  }
  if (!client || !perNode) return;
  // Find this node's hash from perNode
  const entry = perNode.find((n) => n.id === path);
  if (!entry) return;
  expansionLoading = true;
  const fetched = await client.getExpandedDoc(entry.hash);
  expansionLoading = false;
  if (fetched) {
    expansionDoc = fetched;
    expansionOpen = true;
  }
}
```

- [ ] **Step 3: Render expansion affordance and derived children**

In the TreeNode template, add after the existing children rendering block:

```svelte
{#if isExpandable && !derived}
  <button
    class="expansion-toggle"
    onclick={toggleExpansion}
    title={expansionOpen ? 'Hide generated sub-DAG' : 'Show generated sub-DAG'}
  >{expansionLoading ? '…' : expansionOpen ? '▾' : '◆'}</button>
{/if}
```

After the existing `{#if expanded}` children block, add:

```svelte
{#if expansionOpen && expansionDoc}
  <div class="tree-children derived-subtree">
    {#each expansionDoc.children ?? [] as child, i}
      <svelte:self
        doc={child}
        path="{path}/__expanded/{i}"
        {selection}
        {outputTypes}
        onExport={() => {}}
        viewerMode={true}
        derived={true}
        {client}
        {perNode}
      />
    {/each}
  </div>
{/if}
```

For derived nodes, add class modifiers to the row:

```svelte
<div class="tree-row" class:selected class:derived>
```

- [ ] **Step 4: Thread `perNode` from App through TreePane to TreeNode**

In `apps/studio2/src/App.svelte`, pass `perNode` to `TreePane`:

```svelte
<TreePane {session} {selection} {outputTypes} onExport={exportNode} {viewerMode} {client} perNode={evalOutcome?.perNode} />
```

Thread it through `TreePane.svelte` to `TreeNode.svelte` (add to both Props interfaces).

- [ ] **Step 5: Add derived node styles**

In `apps/studio2/src/app.css`:

```css
/* Derived (generated) nodes in expanded Lua sub-DAGs */
.tree-row.derived {
  opacity: 0.7;
  font-style: italic;
}
.tree-row.derived .row-label {
  color: var(--accent);
  opacity: 0.8;
}
.derived-subtree {
  border-left: 1px dashed var(--panel-border);
  margin-left: 1.2rem;
  padding-left: 0.3rem;
}
.expansion-toggle {
  background: transparent;
  border: none;
  color: var(--accent);
  cursor: pointer;
  font-size: 0.8rem;
  padding: 0.1rem 0.25rem;
  opacity: 0.7;
}
.expansion-toggle:hover {
  opacity: 1;
}
```

- [ ] **Step 6: Verify**

Run: `pnpm --filter @yacad/studio2 check`
Expected: 0 errors.

Run: `pnpm build && pnpm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/studio2/src/App.svelte apps/studio2/src/ui/TreePane.svelte apps/studio2/src/ui/TreeNode.svelte apps/studio2/src/app.css
git commit -m "feat(studio2): tree view expansion affordance for Lua sub-DAG inspection"
```

---

### Task 5: Inspector — Read-Only Mode for Derived Nodes

**Files:**
- Modify: `apps/studio2/src/ui/InspectorPane.svelte`
- Modify: `apps/studio2/src/ui/inspectors/KernelInspector.svelte`
- Modify: `apps/studio2/src/app.css`

**Context:** Read `apps/studio2/src/ui/InspectorPane.svelte` before starting. It already has `viewerMode` which disables some editing. The `readonly` concept for derived nodes is similar but distinct: `viewerMode` means the entire session is read-only (MCP viewer); `derived` means this specific node is generated and shouldn't be edited even in a normal session. The simplest approach: treat derived nodes with `viewerMode=true` on the inspector, plus add the "generated" badge.

- [ ] **Step 1: Detect derived selection in InspectorPane**

In `apps/studio2/src/ui/InspectorPane.svelte`, derive whether the selected node is derived:

```typescript
const isDerived = $derived(
  selection?.selectedId?.includes('/__expanded/') ?? false
);
```

When rendering the inspector, pass `viewerMode={viewerMode || isDerived}` to disable all editing for derived nodes.

- [ ] **Step 2: Add "generated" badge**

In the InspectorPane template, above the inspector component, add:

```svelte
{#if isDerived}
  <div class="derived-badge">Generated node — edit Lua source to change</div>
{/if}
```

- [ ] **Step 3: Add badge styles**

In `apps/studio2/src/app.css`:

```css
.derived-badge {
  background: rgba(122, 162, 247, 0.15);
  color: var(--accent);
  font-size: 0.8rem;
  padding: 0.3rem 0.6rem;
  border-radius: 3px;
  margin-bottom: 0.5rem;
  text-align: center;
}
```

- [ ] **Step 4: Verify**

Run: `pnpm --filter @yacad/studio2 check`
Expected: 0 errors.

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/studio2/src/ui/InspectorPane.svelte apps/studio2/src/ui/inspectors/KernelInspector.svelte apps/studio2/src/app.css
git commit -m "feat(studio2): read-only inspector for derived nodes in Lua sub-DAG"
```

---

### Task 6: Format, Full Build, and Final Verification

**Files:** All modified files.

- [ ] **Step 1: Format**

Run: `pnpm format`

- [ ] **Step 2: Full build + type check + tests**

Run: `pnpm build && pnpm test && pnpm --filter @yacad/studio2 check`
Expected: All pass, 0 errors.

- [ ] **Step 3: Commit any formatting changes**

```bash
git add -u
git commit -m "chore: format"
```

(Skip if `pnpm format` made no changes.)

- [ ] **Step 4: Production build**

Run: `pnpm build:app`
Expected: Bundles successfully.
