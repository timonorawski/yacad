/**
 * Benchmarks for @yacad/kernel-manifold — WASM geometry evaluation.
 * The kernel is loaded ONCE at module scope (beforeAll equivalent) because
 * WASM instantiation is slow (~200 ms) and must not pollute per-iteration cost.
 *
 * Covers:
 *   • primitive: box (cheapest WASM op)
 *   • boolean: difference(box, sphere) — expensive kernel op
 */
import { beforeAll, bench, describe } from 'vitest';
import { buildGraph, type Node } from '@yacad/dag';
import { type Geometry } from '@yacad/geometry';
import { ManifoldKernel, loadManifold } from '@yacad/kernel-manifold';

let kernel: ManifoldKernel;
let boxNode: Node;
let diffNode: Node;
// The boolean bench feeds its children's already-evaluated geometries, which
// is what the engine passes the kernel — Geometry, not raw Mesh.
let boxGeo: Geometry;
let sphereGeo: Geometry;

beforeAll(async () => {
  kernel = new ManifoldKernel(await loadManifold());

  boxNode = await buildGraph({ type: 'box', params: { size: [10, 10, 10], center: true } });
  boxGeo = await kernel.evaluate(boxNode, []);

  const sphereNode = await buildGraph({ type: 'sphere', params: { radius: 6, segments: 32 } });
  sphereGeo = await kernel.evaluate(sphereNode, []);

  diffNode = await buildGraph({
    type: 'difference',
    children: [
      { type: 'box', params: { size: [10, 10, 10], center: true } },
      { type: 'sphere', params: { radius: 6, segments: 32 } },
    ],
  });
});

describe('ManifoldKernel.evaluate', () => {
  bench('primitive — box', async () => {
    await kernel.evaluate(boxNode, []);
  });

  bench('boolean — difference(box, sphere)', async () => {
    await kernel.evaluate(diffNode, [boxGeo, sphereGeo]);
  });
});
