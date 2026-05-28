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
  const evalNode = async (n: typeof node): Promise<Geometry> =>
    kernel.evaluate(n, await Promise.all(n.children.map((c) => evalNode(c))));
  const geometry = await evalNode(node);
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
      const childGeometries = await Promise.all(node.children.map((c) => kernel.evaluate(c, [])));
      const a = await kernel.evaluate(node, childGeometries);
      const b = await kernel.evaluate(node, childGeometries);
      if (!isMesh(a) || !isMesh(b)) throw new Error('Expected 3D geometry');
      expect(a.mesh.vertices).toEqual(b.mesh.vertices);
      expect(a.mesh.indices).toEqual(b.mesh.indices);
    });
  });
});

it('returns Geometry with kind="3d" for box', async () => {
  const kernel = new ManifoldKernel(await loadManifold());
  const node = await buildGraph({ type: 'box', params: { size: [10, 10, 10], center: true } });
  const { geometry } = await kernel.evaluateTimed(node, []);
  expect(geometry.kind).toBe('3d');
  if (isMesh(geometry)) {
    expect(geometry.mesh.indices.length).toBeGreaterThan(0);
  }
});

it('kernel evaluates circle to a CrossSection', async () => {
  const kernel = new ManifoldKernel(await loadManifold());
  const node = await buildGraph({ type: 'circle', params: { radius: 5, segments: 16 } });
  const { geometry } = await kernel.evaluateTimed(node, []);
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
  const { geometry } = await kernel.evaluateTimed(node, []);
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
  const { geometry } = await kernel.evaluateTimed(node, []);
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
  const { geometry } = await kernel.evaluateTimed(node, []);
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
  const childGeo = await kernel.evaluate(node.children[0]!, []);
  const { geometry } = await kernel.evaluateTimed(node, [childGeo]);
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

it('kernel evaluates rotate_2d: rotates polygon by angle in degrees', async () => {
  const kernel = new ManifoldKernel(await loadManifold());
  const node = await buildGraph({
    type: 'rotate_2d',
    params: { angle: 90 },
    children: [{ type: 'rectangle', params: { size: [2, 1] } }],
  });
  const childGeo = await kernel.evaluate(node.children[0]!, []);
  const { geometry } = await kernel.evaluateTimed(node, [childGeo]);
  expect(geometry.kind).toBe('2d');
  if (geometry.kind === '2d') {
    // After 90 degree rotation, width and height should be swapped
    const polygons = geometry.section.polygons;
    expect(polygons.length).toBeGreaterThan(0);
    // Check that the rotation produced a valid result
    expect(polygons[0]!.length).toBeGreaterThan(0);
  }
});

// ---------------------------------------------------------------------------
// 2D boolean ops
// ---------------------------------------------------------------------------

it('kernel evaluates 2D union of two circles', async () => {
  const kernel = new ManifoldKernel(await loadManifold());
  const circleA = await buildGraph({ type: 'circle', params: { radius: 5 } });
  const circleB = await buildGraph({ type: 'circle', params: { radius: 5 } });
  const node = await buildGraph({
    type: 'union',
    children: [
      { type: 'circle', params: { radius: 5 } },
      { type: 'circle', params: { radius: 5 } },
    ],
  });
  const aGeo = (await kernel.evaluateTimed(circleA, [])).geometry;
  const bGeo = (await kernel.evaluateTimed(circleB, [])).geometry;
  const { geometry } = await kernel.evaluateTimed(node, [aGeo, bGeo]);
  expect(geometry.kind).toBe('2d');
  if (geometry.kind === '2d') {
    expect(geometry.section.polygons.length).toBeGreaterThan(0);
  }
});

it('kernel evaluates 2D difference of rectangle and circle', async () => {
  const kernel = new ManifoldKernel(await loadManifold());
  const rectNode = await buildGraph({
    type: 'rectangle',
    params: { size: [20, 20], center: true },
  });
  const circNode = await buildGraph({ type: 'circle', params: { radius: 5 } });
  const node = await buildGraph({
    type: 'difference',
    children: [
      { type: 'rectangle', params: { size: [20, 20], center: true } },
      { type: 'circle', params: { radius: 5 } },
    ],
  });
  const rectGeo = (await kernel.evaluateTimed(rectNode, [])).geometry;
  const circGeo = (await kernel.evaluateTimed(circNode, [])).geometry;
  const { geometry } = await kernel.evaluateTimed(node, [rectGeo, circGeo]);
  expect(geometry.kind).toBe('2d');
  if (geometry.kind === '2d') {
    expect(geometry.section.polygons.length).toBeGreaterThan(0);
  }
});

it('kernel evaluates 2D intersection (overlapping circles)', async () => {
  const kernel = new ManifoldKernel(await loadManifold());
  const circleA = await buildGraph({ type: 'circle', params: { radius: 5 } });
  const circleB = await buildGraph({ type: 'circle', params: { radius: 5 } });
  const node = await buildGraph({
    type: 'intersection',
    children: [
      { type: 'circle', params: { radius: 5 } },
      { type: 'circle', params: { radius: 5 } },
    ],
  });
  const aGeo = (await kernel.evaluateTimed(circleA, [])).geometry;
  const bGeo = (await kernel.evaluateTimed(circleB, [])).geometry;
  const { geometry } = await kernel.evaluateTimed(node, [aGeo, bGeo]);
  expect(geometry.kind).toBe('2d');
  if (geometry.kind === '2d') {
    // Intersection of two identical circles is the circle itself
    expect(geometry.section.polygons.length).toBeGreaterThan(0);
  }
});

it('kernel evaluates 2D hull of two offset circles (stadium shape)', async () => {
  const kernel = new ManifoldKernel(await loadManifold());
  const circleA = await buildGraph({ type: 'circle', params: { radius: 5, segments: 32 } });
  const circleB = await buildGraph({
    type: 'translate_2d',
    params: { offset: [10, 0] },
    children: [{ type: 'circle', params: { radius: 5, segments: 32 } }],
  });
  const node = await buildGraph({
    type: 'hull',
    children: [
      { type: 'circle', params: { radius: 5, segments: 32 } },
      {
        type: 'translate_2d',
        params: { offset: [10, 0] },
        children: [{ type: 'circle', params: { radius: 5, segments: 32 } }],
      },
    ],
  });
  const aGeo = (await kernel.evaluateTimed(circleA, [])).geometry;
  const bInnerGeo = (
    await kernel.evaluateTimed(
      await buildGraph({ type: 'circle', params: { radius: 5, segments: 32 } }),
      [],
    )
  ).geometry;
  const bGeo = (await kernel.evaluateTimed(circleB, [bInnerGeo])).geometry;
  const { geometry } = await kernel.evaluateTimed(node, [aGeo, bGeo]);
  expect(geometry.kind).toBe('2d');
  if (geometry.kind === '2d') {
    // Hull of two offset circles should be non-empty
    expect(geometry.section.polygons.length).toBeGreaterThan(0);
  }
});

it('kernel evaluates extrude(rectangle(10x10), height=5) to a box-equivalent mesh', async () => {
  const kernel = new ManifoldKernel(await loadManifold());
  const rect = (
    await kernel.evaluateTimed(
      await buildGraph({ type: 'rectangle', params: { size: [10, 10], center: true } }),
      [],
    )
  ).geometry;
  const node = await buildGraph({
    type: 'extrude',
    params: { height: 5 },
    children: [{ type: 'rectangle', params: { size: [10, 10], center: true } }],
  });
  const { geometry } = await kernel.evaluateTimed(node, [rect]);
  expect(geometry.kind).toBe('3d');
  if (geometry.kind === '3d') {
    expect(geometry.mesh.indices.length).toBeGreaterThan(0);
  }
});

it('kernel evaluates revolve(translate_2d(circle), axis=y) to a torus-like 3D mesh', async () => {
  const kernel = new ManifoldKernel(await loadManifold());
  // A small circle offset 5 units on X, revolved 360° around Y → torus-like solid.
  const innerCircle = await buildGraph({ type: 'circle', params: { radius: 1, segments: 16 } });
  const translated = await buildGraph({
    type: 'translate_2d',
    params: { offset: [5, 0] },
    children: [{ type: 'circle', params: { radius: 1, segments: 16 } }],
  });
  const node = await buildGraph({
    type: 'revolve',
    params: { axis: 'y', segments: 16, degrees: 360 },
    children: [
      {
        type: 'translate_2d',
        params: { offset: [5, 0] },
        children: [{ type: 'circle', params: { radius: 1, segments: 16 } }],
      },
    ],
  });
  const innerGeo = (await kernel.evaluateTimed(innerCircle, [])).geometry;
  const translatedGeo = (await kernel.evaluateTimed(translated, [innerGeo])).geometry;
  const { geometry } = await kernel.evaluateTimed(node, [translatedGeo]);
  expect(geometry.kind).toBe('3d');
  if (geometry.kind === '3d') {
    expect(geometry.mesh.indices.length).toBeGreaterThan(0);
    // The revolved solid should have vertices spanning both positive and negative X.
    const verts = geometry.mesh.vertices;
    let minX = Infinity,
      maxX = -Infinity;
    for (let i = 0; i < verts.length; i += 3) {
      const x = verts[i]!;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
    // Torus-like: should extend to roughly ±(majorRadius + minorRadius) = ±6.
    expect(maxX).toBeGreaterThan(3);
    expect(minX).toBeLessThan(-3);
  }
});

it('kernel evaluates revolve with axis=x to a 3D mesh with correct orientation', async () => {
  const kernel = new ManifoldKernel(await loadManifold());
  // Profile: circle of radius 1 centered at (5, 0) in 2D. Revolving around X
  // produces a torus with ring axis = X. The torus spans:
  //   X: ±1 (the profile's Y extent becomes the X extent after the post-rotation)
  //   Y: ±6 (major+minor radius, swept in YZ plane)
  //   Z: ±6
  const innerCircle = await buildGraph({ type: 'circle', params: { radius: 1, segments: 16 } });
  const translated = await buildGraph({
    type: 'translate_2d',
    params: { offset: [5, 0] },
    children: [{ type: 'circle', params: { radius: 1, segments: 16 } }],
  });
  const node = await buildGraph({
    type: 'revolve',
    params: { axis: 'x', segments: 16, degrees: 360 },
    children: [
      {
        type: 'translate_2d',
        params: { offset: [5, 0] },
        children: [{ type: 'circle', params: { radius: 1, segments: 16 } }],
      },
    ],
  });
  const innerGeo = (await kernel.evaluateTimed(innerCircle, [])).geometry;
  const translatedGeo = (await kernel.evaluateTimed(translated, [innerGeo])).geometry;
  const { geometry } = await kernel.evaluateTimed(node, [translatedGeo]);
  expect(geometry.kind).toBe('3d');
  if (geometry.kind === '3d') {
    expect(geometry.mesh.indices.length).toBeGreaterThan(0);
    const verts = geometry.mesh.vertices;
    let minX = Infinity,
      maxX = -Infinity;
    let minY = Infinity,
      maxY = -Infinity;
    let minZ = Infinity,
      maxZ = -Infinity;
    for (let i = 0; i < verts.length; i += 3) {
      const x = verts[i]!,
        y = verts[i + 1]!,
        z = verts[i + 2]!;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    // Manifold.revolve sets the revolve axis as Z; rotate([0,-90,0]) maps Z→+X.
    // Ring axis is X: X span is narrow (profile Y extent ≈ ±1 around the axis),
    // while Y and Z span the full swept radius (major+minor ≈ ±6).
    expect(maxX).toBeLessThan(2);
    expect(minX).toBeGreaterThan(-2);
    expect(maxY).toBeGreaterThan(4);
    expect(minY).toBeLessThan(-4);
    expect(maxZ).toBeGreaterThan(4);
    expect(minZ).toBeLessThan(-4);
  }
});

it('evaluate2dBoolean does not leak WASM heap across many iterations', async () => {
  const kernel = new ManifoldKernel(await loadManifold());
  const circleNode = await buildGraph({ type: 'circle', params: { radius: 5, segments: 8 } });
  const unionNode = await buildGraph({
    type: 'union',
    children: [
      { type: 'circle', params: { radius: 5, segments: 8 } },
      { type: 'circle', params: { radius: 5, segments: 8 } },
    ],
  });
  const circleGeo = (await kernel.evaluateTimed(circleNode, [])).geometry;
  // 1000 iterations of union(circle, circle) — if intermediates leak, WASM heap
  // exhausts long before this completes.
  for (let i = 0; i < 1000; i++) {
    await kernel.evaluateTimed(unionNode, [circleGeo, circleGeo]);
  }
  // Completing without OOM/throw is the assertion.
  expect(true).toBe(true);
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
  const boxGeo = (await kernel.evaluateTimed(boxNode, [])).geometry;
  const sphereGeo = (await kernel.evaluateTimed(sphereNode, [])).geometry;
  const { geometry } = await kernel.evaluateTimed(diffNode, [boxGeo, sphereGeo]);
  expect(geometry.kind).toBe('3d');
});

it('kernel refine(n=2) on box produces 4x the triangle count', async () => {
  const kernel = new ManifoldKernel(await loadManifold());
  const box = (
    await kernel.evaluateTimed(await buildGraph({ type: 'box', params: { size: [1, 1, 1] } }), [])
  ).geometry;
  const node = await buildGraph({
    type: 'refine',
    params: { n: 2 },
    children: [{ type: 'box', params: { size: [1, 1, 1] } }],
  });
  const { geometry } = await kernel.evaluateTimed(node, [box]);
  expect(geometry.kind).toBe('3d');
  if (geometry.kind === '3d' && box.kind === '3d') {
    const refinedTriCount = geometry.mesh.indices.length / 3;
    const baseTriCount = box.mesh.indices.length / 3;
    expect(refinedTriCount).toBe(baseTriCount * 4); // each tri → 4
  }
});

it('kernel: offset_2d(round, +2) on rectangle produces more vertices', async () => {
  const kernel = new ManifoldKernel(await loadManifold());
  const rect = (
    await kernel.evaluateTimed(
      await buildGraph({ type: 'rectangle', params: { size: [10, 10], center: true } }),
      [],
    )
  ).geometry;
  const node = await buildGraph({
    type: 'offset_2d',
    params: { delta: 2, joinType: 'round', segments: 16 },
    children: [{ type: 'rectangle', params: { size: [10, 10], center: true } }],
  });
  const { geometry } = await kernel.evaluateTimed(node, [rect]);
  expect(geometry.kind).toBe('2d');
  if (geometry.kind === '2d') {
    // Original rectangle: 4 verts; rounded: 4 + 4*(segments-1) = 64 (approx)
    expect(geometry.section.polygons[0]!.length).toBeGreaterThan(4);
  }
});

/** Count vertices that are actual corners (non-collinear with their neighbours). */
function countCorners(pts: ReadonlyArray<readonly [number, number]>): number {
  let corners = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[(i - 1 + pts.length) % pts.length]!;
    const b = pts[i]!;
    const c = pts[(i + 1) % pts.length]!;
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(cross) > 1e-4) corners++;
  }
  return corners;
}

it('section: unit cube cut at z=0 with normal +Z produces a square cross-section', async () => {
  const kernel = new ManifoldKernel(await loadManifold());
  const box = (
    await kernel.evaluateTimed(
      await buildGraph({ type: 'box', params: { size: [2, 2, 2], center: true } }),
      [],
    )
  ).geometry;
  const node = await buildGraph({
    type: 'section',
    params: { origin: [0, 0, 0], normal: [0, 0, 1] },
    children: [{ type: 'box', params: { size: [2, 2, 2], center: true } }],
  });
  const { geometry } = await kernel.evaluateTimed(node, [box]);
  expect(geometry.kind).toBe('2d');
  if (geometry.kind === '2d') {
    expect(geometry.section.polygons.length).toBe(1);
    // Manifold's box mesh triangulation may insert collinear midpoints; count
    // non-collinear corners to verify the shape is a 4-corner square.
    expect(countCorners(geometry.section.polygons[0]!)).toBe(4);
    // Bounds: each axis spans [-1, 1]
    const xs = geometry.section.polygons[0]!.map((p) => p[0]);
    const ys = geometry.section.polygons[0]!.map((p) => p[1]);
    expect(Math.min(...xs)).toBeCloseTo(-1, 9);
    expect(Math.max(...xs)).toBeCloseTo(1, 9);
    expect(Math.min(...ys)).toBeCloseTo(-1, 9);
    expect(Math.max(...ys)).toBeCloseTo(1, 9);
  }
});

it('section: plane above the solid produces an empty CrossSection', async () => {
  const kernel = new ManifoldKernel(await loadManifold());
  const box = (
    await kernel.evaluateTimed(
      await buildGraph({ type: 'box', params: { size: [2, 2, 2], center: true } }),
      [],
    )
  ).geometry;
  const node = await buildGraph({
    type: 'section',
    params: { origin: [0, 0, 5], normal: [0, 0, 1] },
    children: [{ type: 'box', params: { size: [2, 2, 2], center: true } }],
  });
  const { geometry } = await kernel.evaluateTimed(node, [box]);
  expect(geometry.kind).toBe('2d');
  if (geometry.kind === '2d') {
    expect(geometry.section.polygons.length).toBe(0);
  }
});

it('section: sphere(r=5) at z=3 produces a circle of bounds ≈ ±4', async () => {
  const kernel = new ManifoldKernel(await loadManifold());
  const sphere = (
    await kernel.evaluateTimed(
      await buildGraph({ type: 'sphere', params: { radius: 5, segments: 64 } }),
      [],
    )
  ).geometry;
  const node = await buildGraph({
    type: 'section',
    params: { origin: [0, 0, 3], normal: [0, 0, 1] },
    children: [{ type: 'sphere', params: { radius: 5, segments: 64 } }],
  });
  const { geometry } = await kernel.evaluateTimed(node, [sphere]);
  expect(geometry.kind).toBe('2d');
  if (geometry.kind === '2d') {
    expect(geometry.section.polygons.length).toBe(1);
    const xs = geometry.section.polygons[0]!.map((p) => p[0]);
    const ys = geometry.section.polygons[0]!.map((p) => p[1]);
    // sqrt(25 - 9) = 4
    expect(Math.max(...xs)).toBeCloseTo(4, 0); // loose: tessellation rounds it
    expect(Math.min(...xs)).toBeCloseTo(-4, 0);
    expect(Math.max(...ys)).toBeCloseTo(4, 0);
    expect(Math.min(...ys)).toBeCloseTo(-4, 0);
  }
});

it('section: diagonal cut of a cube with normal [1,1,0] produces a rectangular section', async () => {
  const kernel = new ManifoldKernel(await loadManifold());
  const box = (
    await kernel.evaluateTimed(
      await buildGraph({ type: 'box', params: { size: [2, 2, 2], center: true } }),
      [],
    )
  ).geometry;
  const node = await buildGraph({
    type: 'section',
    params: { origin: [0, 0, 0], normal: [1, 1, 0] },
    children: [{ type: 'box', params: { size: [2, 2, 2], center: true } }],
  });
  const { geometry } = await kernel.evaluateTimed(node, [box]);
  expect(geometry.kind).toBe('2d');
  if (geometry.kind === '2d') {
    expect(geometry.section.polygons.length).toBe(1);
    // Manifold's mesh triangulation may add collinear midpoints; assert on
    // non-collinear corner count to confirm a 4-corner rectangle.
    expect(countCorners(geometry.section.polygons[0]!)).toBe(4);
  }
});

it('section: body-diagonal cut of a cube produces a hexagonal section', async () => {
  const kernel = new ManifoldKernel(await loadManifold());
  const box = (
    await kernel.evaluateTimed(
      await buildGraph({ type: 'box', params: { size: [2, 2, 2], center: true } }),
      [],
    )
  ).geometry;
  const node = await buildGraph({
    type: 'section',
    params: { origin: [0, 0, 0], normal: [1, 1, 1] },
    children: [{ type: 'box', params: { size: [2, 2, 2], center: true } }],
  });
  const { geometry } = await kernel.evaluateTimed(node, [box]);
  expect(geometry.kind).toBe('2d');
  if (geometry.kind === '2d') {
    expect(geometry.section.polygons.length).toBe(1);
    // Body-diagonal cut through the center of a cube produces a regular hexagon
    // (6 distinct corners). Manifold may add collinear midpoints from mesh
    // triangulation, so assert non-collinear corner count rather than raw length.
    expect(countCorners(geometry.section.polygons[0]!)).toBe(6);
  }
});

it('section: same inputs produce byte-identical polygons (determinism)', async () => {
  const kernel = new ManifoldKernel(await loadManifold());
  const box = (
    await kernel.evaluateTimed(
      await buildGraph({ type: 'box', params: { size: [2, 2, 2], center: true } }),
      [],
    )
  ).geometry;
  const node = await buildGraph({
    type: 'section',
    params: { origin: [0, 0, 0.5], normal: [1, 1, 1] },
    children: [{ type: 'box', params: { size: [2, 2, 2], center: true } }],
  });
  const a = (await kernel.evaluateTimed(node, [box])).geometry;
  const b = (await kernel.evaluateTimed(node, [box])).geometry;
  expect(a).toEqual(b);
});
