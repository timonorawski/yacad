import { beforeAll, describe, expect, it } from 'vitest';
import { MemoryStore } from '@yacad/cache';
import { buildGraph } from '@yacad/dag';
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
    expect(result.stats).toEqual({ nodes: 3, hits: 0, misses: 3 });
  });

  it('short-circuits at the root on an unchanged model (warm cache)', async () => {
    const store = new MemoryStore();
    const engine = new Engine(store, kernel);
    const graph = await buildGraph(model(5));
    await engine.evaluate(graph);
    const again = await engine.evaluate(graph);
    // A root hit returns immediately without descending — one lookup, no recompute.
    expect(again.stats).toEqual({ nodes: 1, hits: 1, misses: 0 });
  });

  it('recomputes only the edited node and its ancestors (success criterion #1)', async () => {
    const store = new MemoryStore();
    const engine = new Engine(store, kernel);

    await engine.evaluate(await buildGraph(model(5)));
    const edited = await engine.evaluate(await buildGraph(model(6)));

    // box (sibling) is a hit; sphere (edited) and union (ancestor) recompute.
    expect(edited.stats).toEqual({ nodes: 3, hits: 1, misses: 2 });

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
