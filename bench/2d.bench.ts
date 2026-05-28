import { beforeAll, bench, describe } from 'vitest';
import { MemoryStore } from '@yacad/cache';
import { buildGraph, type Node } from '@yacad/dag';
import { Engine } from '@yacad/engine';
import { ManifoldKernel, loadManifold } from '@yacad/kernel-manifold';

let kernel: ManifoldKernel;
let graph: Node;
let warmStore: MemoryStore;

beforeAll(async () => {
  kernel = new ManifoldKernel(await loadManifold());
  graph = await buildGraph({
    type: 'extrude',
    params: { height: 10 },
    children: [
      {
        type: 'spline',
        params: {
          points: Array.from({ length: 8 }, (_, i) => {
            const angle = (i / 8) * 2 * Math.PI;
            return [10 * Math.cos(angle), 10 * Math.sin(angle)];
          }),
          segmentsPerCurve: 8,
        },
      },
    ],
  });
  warmStore = new MemoryStore();
  await new Engine(warmStore, kernel).evaluate(graph);
});

describe('Engine.evaluate (2D → extrude)', () => {
  bench('cold — extrude(spline(8 pts × 8 seg)) fresh cache', async () => {
    await new Engine(new MemoryStore(), kernel).evaluate(graph);
  });

  bench('warm — extrude(spline) root cache hit', async () => {
    await new Engine(warmStore, kernel).evaluate(graph);
  });
});
