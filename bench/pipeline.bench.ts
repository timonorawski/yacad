/**
 * End-to-end pipeline benchmark: doc → DAG → engine → mesh → STL.
 *
 * Uses the canonical box-minus-sphere scene (30×30×30 box, sphere r=19,
 * segments=48) which matches packages/e2e/scenes/booleans/box-minus-sphere.json.
 * Each iteration gets a fresh MemoryStore (cold) to measure total pipeline cost.
 *
 * Imports runScene from its source file directly (the e2e package has no
 * index.ts and is not in the vitest alias map).
 *
 * WASM is loaded via runScene's module-scope singleton — consistent with how
 * the e2e tests and the studio app work.
 */
import { bench, describe } from 'vitest';
import { MemoryStore } from '@yacad/cache';
import { buildGraph } from '@yacad/dag';
import { Engine } from '@yacad/engine';
import { meshToBinaryStl } from '@yacad/export-stl';
import { loadManifold, ManifoldKernel } from '@yacad/kernel-manifold';
import { beforeAll } from 'vitest';

let kernel: ManifoldKernel;

beforeAll(async () => {
  kernel = new ManifoldKernel(await loadManifold());
});

async function runScene(doc: unknown): Promise<void> {
  const engine = new Engine(new MemoryStore(), kernel);
  const result = await engine.evaluate(await buildGraph(doc));
  if (result.geometry.kind === '3d') {
    meshToBinaryStl(result.geometry.mesh);
  }
}

// Representative scene: a moderate boolean with 48-segment sphere.
const boxMinusSphere = {
  type: 'difference',
  children: [
    { type: 'box', params: { size: [30, 30, 30], center: true } },
    { type: 'sphere', params: { radius: 19, segments: 48 } },
  ],
};

// Simpler scene for a lower-bound reference.
const simpleBox = {
  type: 'box',
  params: { size: [10, 10, 10], center: true },
};

describe('runScene pipeline (cold cache, doc → STL)', () => {
  bench('simple box', async () => {
    await runScene(simpleBox);
  });

  bench('difference(box, sphere) — representative scene', async () => {
    await runScene(boxMinusSphere);
  });
});
