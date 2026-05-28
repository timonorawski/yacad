import { beforeAll, describe, expect, it } from 'vitest';
import { buildGraph } from '@yacad/dag';
import { computeBBox, isMesh, triangleCount, type Geometry, type Mesh } from '@yacad/geometry';
import { ManifoldKernel } from './kernel';
import { loadManifold } from './loader';

let kernel: ManifoldKernel;

beforeAll(async () => {
  kernel = new ManifoldKernel(await loadManifold());
});

// Evaluate a leaf-or-subtree document by recursively building + evaluating it.
async function evalDoc(doc: unknown): Promise<Mesh> {
  const node = await buildGraph(doc);
  const evalNode = (n: typeof node): Geometry =>
    kernel.evaluate(
      n,
      n.children.map((c) => evalNode(c)),
    );
  const geometry = evalNode(node);
  if (!isMesh(geometry)) throw new Error('Expected 3D geometry');
  return geometry.mesh;
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
      const childGeometries = node.children.map((c) => kernel.evaluate(c, []));
      const a = kernel.evaluate(node, childGeometries);
      const b = kernel.evaluate(node, childGeometries);
      if (!isMesh(a) || !isMesh(b)) throw new Error('Expected 3D geometry');
      expect(a.mesh.vertices).toEqual(b.mesh.vertices);
      expect(a.mesh.indices).toEqual(b.mesh.indices);
    });
  });
});

it('returns Geometry with kind="3d" for box', async () => {
  const kernel = new ManifoldKernel(await loadManifold());
  const node = await buildGraph({ type: 'box', params: { size: [10, 10, 10], center: true } });
  const { geometry } = kernel.evaluateTimed(node, []);
  expect(geometry.kind).toBe('3d');
  if (isMesh(geometry)) {
    expect(geometry.mesh.indices.length).toBeGreaterThan(0);
  }
});

it('kernel evaluates circle to a CrossSection', async () => {
  const kernel = new ManifoldKernel(await loadManifold());
  const node = await buildGraph({ type: 'circle', params: { radius: 5, segments: 16 } });
  const { geometry } = kernel.evaluateTimed(node, []);
  expect(geometry.kind).toBe('2d');
  if (geometry.kind === '2d') {
    expect(geometry.section.polygons.length).toBe(1);
    expect(geometry.section.polygons[0]!.length).toBe(16); // 16 segments => 16 vertices
  }
});

it('kernel evaluates rectangle to a 4-vertex CrossSection', async () => {
  const kernel = new ManifoldKernel(await loadManifold());
  const node = await buildGraph({
    type: 'rectangle',
    params: { size: [10, 20], center: true },
  });
  const { geometry } = kernel.evaluateTimed(node, []);
  expect(geometry.kind).toBe('2d');
  if (geometry.kind === '2d') {
    expect(geometry.section.polygons[0]!.length).toBe(4);
  }
});

it('kernel evaluates polygon to a CrossSection with the supplied points', async () => {
  const kernel = new ManifoldKernel(await loadManifold());
  const node = await buildGraph({
    type: 'polygon',
    params: {
      points: [
        [0, 0],
        [10, 0],
        [5, 10],
      ],
    },
  });
  const { geometry } = kernel.evaluateTimed(node, []);
  expect(geometry.kind).toBe('2d');
  if (geometry.kind === '2d') {
    expect(geometry.section.polygons[0]!.length).toBe(3);
  }
});

it('kernel evaluates spline to a tessellated CrossSection', async () => {
  const kernel = new ManifoldKernel(await loadManifold());
  const node = await buildGraph({
    type: 'spline',
    params: {
      points: [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      segmentsPerCurve: 8,
    },
  });
  const { geometry } = kernel.evaluateTimed(node, []);
  expect(geometry.kind).toBe('2d');
  if (geometry.kind === '2d') {
    // 4 control points × 8 segments = 32 tessellated points
    expect(geometry.section.polygons[0]!.length).toBe(32);
  }
});

it('kernel evaluates translate_2d: shifts polygon centroid by offset', async () => {
  const kernel = new ManifoldKernel(await loadManifold());
  const node = await buildGraph({
    type: 'translate_2d',
    params: { offset: [10, 20] },
    children: [{ type: 'circle', params: { radius: 1, segments: 4 } }],
  });
  const childGeo = kernel.evaluate(node.children[0]!, []);
  const { geometry } = kernel.evaluateTimed(node, [childGeo]);
  expect(geometry.kind).toBe('2d');
  if (geometry.kind === '2d') {
    // Centroid of all vertices should be close to the offset (10, 20)
    const pts = geometry.section.polygons[0]!;
    expect(pts.length).toBeGreaterThan(0);
    const sumX = pts.reduce((s, p) => s + p[0]!, 0);
    const sumY = pts.reduce((s, p) => s + p[1]!, 0);
    expect(sumX / pts.length).toBeCloseTo(10, 5);
    expect(sumY / pts.length).toBeCloseTo(20, 5);
  }
});

it('evaluateTimed propagates child Geometry to handler', async () => {
  const kernel = new ManifoldKernel(await loadManifold());
  const boxNode = await buildGraph({
    type: 'box',
    params: { size: [10, 10, 10], center: true },
  });
  const sphereNode = await buildGraph({
    type: 'sphere',
    params: { radius: 6, segments: 32 },
  });
  const diffNode = await buildGraph({
    type: 'difference',
    children: [
      { type: 'box', params: { size: [10, 10, 10], center: true } },
      { type: 'sphere', params: { radius: 6, segments: 32 } },
    ],
  });
  const boxGeo = kernel.evaluateTimed(boxNode, []).geometry;
  const sphereGeo = kernel.evaluateTimed(sphereNode, []).geometry;
  const { geometry } = kernel.evaluateTimed(diffNode, [boxGeo, sphereGeo]);
  expect(geometry.kind).toBe('3d');
});
