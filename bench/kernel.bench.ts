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
import { type Mesh } from '@yacad/geometry';
import { ManifoldKernel, loadManifold } from '@yacad/kernel-manifold';

let kernel: ManifoldKernel;
let boxNode: Node;
let diffNode: Node;
let boxMesh: Mesh;
let sphereMesh: Mesh;

beforeAll(async () => {
  kernel = new ManifoldKernel(await loadManifold());

  boxNode = await buildGraph({ type: 'box', params: { size: [10, 10, 10], center: true } });
  boxMesh = kernel.evaluate(boxNode, []);

  const sphereNode = await buildGraph({ type: 'sphere', params: { radius: 6, segments: 32 } });
  sphereMesh = kernel.evaluate(sphereNode, []);

  diffNode = await buildGraph({
    type: 'difference',
    children: [
      { type: 'box', params: { size: [10, 10, 10], center: true } },
      { type: 'sphere', params: { radius: 6, segments: 32 } },
    ],
  });
});

describe('ManifoldKernel.evaluate', () => {
  bench('primitive — box', () => {
    kernel.evaluate(boxNode, []);
  });

  bench('boolean — difference(box, sphere)', () => {
    kernel.evaluate(diffNode, [boxMesh, sphereMesh]);
  });
});
