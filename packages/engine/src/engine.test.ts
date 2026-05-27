import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MemoryStore } from '@yacad/cache';
import {
  buildGraph,
  registerNodeType,
  unregisterNodeType,
  NOOP_RESOLVER,
  type ExpandableNodeType,
  type InputRef,
} from '@yacad/dag';
import { ManifoldKernel, loadManifold } from '@yacad/kernel-manifold';
import { Engine } from './engine';

let kernel: ManifoldKernel;

beforeAll(async () => {
  kernel = new ManifoldKernel(await loadManifold());
});

// union[ box, sphere(radius) ] — three nodes: root, box (stable), sphere (edited).
const model = (radius: number) => ({
  type: 'union',
  children: [
    { type: 'box', params: { size: [10, 10, 10], center: true } },
    { type: 'sphere', params: { radius } },
  ],
});

// ---------------------------------------------------------------------------
// Synthetic expandable node types for engine expandable-branch tests.
// Registered/unregistered per-test to keep test isolation.
// ---------------------------------------------------------------------------

/** syn_unbox: no children → emits a 1×1×1 box; one child → passes it through via __input_ref. */
const synUnboxDef: ExpandableNodeType = {
  kind: 'expandable',
  type: 'syn_unbox',
  resolveOutput: () => '3d',
  checkChildren(_children, _params, _resolver, _path) {},
  normalizeParams: (p, _resolver, _path) => (p ?? {}) as Record<string, unknown>,
  inputNames(_params, _resolver): readonly string[] {
    return ['input0'];
  },
  async expand(_params, inputs: readonly InputRef[]) {
    if (inputs.length === 0) {
      return { type: 'box', params: { size: [1, 1, 1] } };
    }
    // Pass through the first input by name.
    return { type: '__input_ref', params: { name: inputs[0]!.name } };
  },
};

describe('Engine — expandable nodes', () => {
  afterEach(() => {
    unregisterNodeType('syn_unbox');
    unregisterNodeType('syn_count');
  });

  it('evaluates an expandable node end-to-end (no children → emits box)', async () => {
    registerNodeType(synUnboxDef);
    const store = new MemoryStore();
    const engine = new Engine(store, kernel, { resolver: NOOP_RESOLVER });
    const graph = await buildGraph({ type: 'syn_unbox' }, undefined, undefined, NOOP_RESOLVER);
    const result = await engine.evaluate(graph);
    expect(result.mesh.indices.length).toBeGreaterThan(0);
    // Sub-DAG internals must not leak into the caller's perNode.
    expect(result.perNode.length).toBe(1);
    expect(result.stats.nodes).toBe(1);
  });

  it('resolves __input_ref to the matching child by name', async () => {
    registerNodeType(synUnboxDef);
    const store = new MemoryStore();
    const engine = new Engine(store, kernel, { resolver: NOOP_RESOLVER });
    const graph = await buildGraph(
      {
        type: 'syn_unbox',
        children: [{ type: 'box', params: { size: [2, 2, 2] } }],
      },
      undefined,
      undefined,
      NOOP_RESOLVER,
    );
    const result = await engine.evaluate(graph);
    expect(result.mesh.indices.length).toBeGreaterThan(0);
  });

  it('perNode contains only the outer expandable entry, not sub-DAG internals', async () => {
    registerNodeType(synUnboxDef);
    const store = new MemoryStore();
    const engine = new Engine(store, kernel, { resolver: NOOP_RESOLVER });
    // Build with an explicit path so the outer node gets id '$'.
    const graph = await buildGraph({ type: 'syn_unbox' }, undefined, '$', NOOP_RESOLVER);
    const result = await engine.evaluate(graph);
    // Exactly one entry — the outer syn_unbox node.
    expect(result.perNode.length).toBe(1);
    expect(result.perNode[0]!.id).toBe('$');
    // The sub-DAG root emitted by expand() uses id '$' too; confirm no duplicate
    // and no entry whose id starts with '$' from the inner walk leaks through.
    const innerIds = result.perNode.filter((e) => e.id !== '$');
    expect(innerIds.length).toBe(0);
  });

  it('outer-caches expandable result (expand() not called on second eval)', async () => {
    let expandCalls = 0;
    const synCountDef: ExpandableNodeType = {
      ...synUnboxDef,
      type: 'syn_count',
      async expand(_params, _inputs) {
        expandCalls += 1;
        return { type: 'box', params: { size: [1, 1, 1] } };
      },
    };
    registerNodeType(synCountDef);

    const store = new MemoryStore();
    const engine = new Engine(store, kernel, { resolver: NOOP_RESOLVER });
    const graph = await buildGraph(
      { type: 'syn_count' },
      undefined,
      undefined,
      NOOP_RESOLVER,
    );
    await engine.evaluate(graph);
    await engine.evaluate(graph);
    expect(expandCalls).toBe(1);
  });
});

describe('Engine', () => {
  it('evaluates a model to a non-empty root mesh', async () => {
    const engine = new Engine(new MemoryStore(), kernel);
    const result = await engine.evaluate(await buildGraph(model(5)));
    expect(result.mesh.vertices.length).toBeGreaterThan(0);
    expect(result.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('misses everything on a cold cache', async () => {
    const engine = new Engine(new MemoryStore(), kernel);
    const result = await engine.evaluate(await buildGraph(model(5)));
    expect(result.stats).toMatchObject({ nodes: 3, hits: 0, misses: 3 });
  });

  it('short-circuits at the root on an unchanged model (warm cache)', async () => {
    const store = new MemoryStore();
    const engine = new Engine(store, kernel);
    const graph = await buildGraph(model(5));
    await engine.evaluate(graph);
    const again = await engine.evaluate(graph);
    // A root hit returns immediately without descending — one lookup, no recompute.
    expect(again.stats).toMatchObject({ nodes: 1, hits: 1, misses: 0 });
  });

  it('recomputes only the edited node and its ancestors (success criterion #1)', async () => {
    const store = new MemoryStore();
    const engine = new Engine(store, kernel);

    await engine.evaluate(await buildGraph(model(5)));
    const edited = await engine.evaluate(await buildGraph(model(6)));

    // box (sibling) is a hit; sphere (edited) and union (ancestor) recompute.
    expect(edited.stats).toMatchObject({ nodes: 3, hits: 1, misses: 2 });

    const byType = (id: string) => edited.perNode.find((n) => n.id === id);
    expect(byType('$/0')?.hit).toBe(true); // box, unchanged
    expect(byType('$/1')?.hit).toBe(false); // sphere, edited
    expect(byType('$')?.hit).toBe(false); // union, ancestor
  });

  it('shares cache across structurally identical subtrees in different models', async () => {
    const store = new MemoryStore();
    const engine = new Engine(store, kernel);

    // Evaluate a lone box first.
    await engine.evaluate(
      await buildGraph({ type: 'box', params: { size: [10, 10, 10], center: true } }),
    );

    // The same box embedded in a union is now a cache hit (content-addressed).
    const result = await engine.evaluate(await buildGraph(model(5)));
    const box = result.perNode.find((n) => n.id === '$/0');
    expect(box?.hit).toBe(true);
  });
});
