import { beforeAll, describe, expect, it } from 'vitest';
import { buildGraph } from '@yacad/dag';
import { computeBBox, triangleCount, type Mesh } from '@yacad/geometry';
import { ManifoldKernel } from './kernel';
import { loadManifold } from './loader';

let kernel: ManifoldKernel;

beforeAll(async () => {
  kernel = new ManifoldKernel(await loadManifold());
});

// Evaluate a leaf-or-subtree document by recursively building + evaluating it.
async function evalDoc(doc: unknown): Promise<Mesh> {
  const node = await buildGraph(doc);
  const evalNode = (n: typeof node): Mesh =>
    kernel.evaluate(
      n,
      n.children.map((c) => evalNode(c)),
    );
  return evalNode(node);
}

describe('ManifoldKernel', () => {
  it('reports kernel identity for provenance', () => {
    expect(kernel.name).toBe('manifold');
    expect(kernel.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  describe('primitives', () => {
    it('builds a centered box with the expected bounds', async () => {
      const mesh = await evalDoc({ type: 'box', params: { size: [10, 10, 10], center: true } });
      expect(computeBBox(mesh)).toEqual({ min: [-5, -5, -5], max: [5, 5, 5] });
    });

    it('builds a sphere of the requested radius', async () => {
      const mesh = await evalDoc({ type: 'sphere', params: { radius: 5 } });
      const bb = computeBBox(mesh)!;
      expect(bb.max[0]).toBeCloseTo(5, 5);
      expect(bb.min[0]).toBeCloseTo(-5, 5);
    });
  });

  describe('transforms', () => {
    it('translates a child', async () => {
      const mesh = await evalDoc({
        type: 'translate',
        params: { offset: [100, 0, 0] },
        children: [{ type: 'box', params: { size: [10, 10, 10], center: true } }],
      });
      const bb = computeBBox(mesh)!;
      expect(bb.min[0]).toBeCloseTo(95, 4);
      expect(bb.max[0]).toBeCloseTo(105, 4);
    });
  });

  describe('booleans', () => {
    it('difference of a box and a sphere is non-empty and differs from the box', async () => {
      const box = await evalDoc({ type: 'box', params: { size: [10, 10, 10], center: true } });
      const diff = await evalDoc({
        type: 'difference',
        children: [
          { type: 'box', params: { size: [10, 10, 10], center: true } },
          { type: 'sphere', params: { radius: 6 } },
        ],
      });
      expect(triangleCount(diff)).toBeGreaterThan(0);
      expect(diff.vertices.length).not.toBe(box.vertices.length);
    });

    it('union of two boxes is non-empty', async () => {
      const mesh = await evalDoc({
        type: 'union',
        children: [
          { type: 'box', params: { size: [10, 10, 10], center: true } },
          {
            type: 'translate',
            params: { offset: [5, 0, 0] },
            children: [{ type: 'box', params: { size: [10, 10, 10], center: true } }],
          },
        ],
      });
      expect(triangleCount(mesh)).toBeGreaterThan(0);
    });
  });

  describe('determinism (CLAUDE.md #2)', () => {
    it('produces byte-identical meshes for identical inputs', async () => {
      const node = await buildGraph({
        type: 'difference',
        children: [
          { type: 'box', params: { size: [10, 10, 10], center: true } },
          { type: 'sphere', params: { radius: 6, segments: 48 } },
        ],
      });
      const childMeshes = node.children.map((c) => kernel.evaluate(c, []));
      const a = kernel.evaluate(node, childMeshes);
      const b = kernel.evaluate(node, childMeshes);
      expect(a.vertices).toEqual(b.vertices);
      expect(a.indices).toEqual(b.indices);
    });
  });
});
