/**
 * Benchmarks for @yacad/engine — the core incremental-recompute bet.
 *
 * The critical comparison is COLD vs WARM evaluation of the same model:
 *   • cold: fresh MemoryStore, every node must be evaluated by the kernel.
 *   • warm: same store with all nodes already cached, engine short-circuits at
 *           the root (1 lookup, 0 kernel calls).
 *
 * The cold-vs-warm speedup ratio is the architectural validation metric the
 * POC was built to demonstrate. If it degrades, something broke in the cache
 * or hash pipeline.
 *
 * WASM loaded ONCE at module scope — see kernel.bench.ts for rationale.
 */
import { beforeAll, bench, describe } from 'vitest';
import { MemoryStore } from '@yacad/cache';
import { buildGraph, type Node } from '@yacad/dag';
import { ManifoldKernel, loadManifold } from '@yacad/kernel-manifold';
import { Engine } from '@yacad/engine';

let kernel: ManifoldKernel;
let graph: Node;

// Pre-warmed store: the root mesh is already cached.
let warmStore: MemoryStore;

beforeAll(async () => {
  kernel = new ManifoldKernel(await loadManifold());

  graph = await buildGraph({
    type: 'difference',
    children: [
      { type: 'box', params: { size: [30, 30, 30], center: true } },
      { type: 'sphere', params: { radius: 19, segments: 48 } },
    ],
  });

  // Warm up once so the warm bench never computes geometry.
  warmStore = new MemoryStore();
  await new Engine(warmStore, kernel).evaluate(graph);
});

describe('Engine.evaluate', () => {
  bench('cold — difference(box, sphere) fresh cache', async () => {
    // Each iteration needs its own store so there are no cross-iteration hits.
    await new Engine(new MemoryStore(), kernel).evaluate(graph);
  });

  bench('warm — difference(box, sphere) root cache hit', async () => {
    // warmStore already has the root mesh; the engine returns it in one lookup.
    await new Engine(warmStore, kernel).evaluate(graph);
  });
});
