import { beforeAll, describe, expect, it } from 'vitest';
import { MemoryStore } from '@yacad/cache';
import { buildGraph, getNodeType, registerNodeType, type DefinitionResolver } from '@yacad/dag';
import { Engine } from '@yacad/engine';
import { meshToBinaryStl } from '@yacad/export-stl';
import { computeBBox, triangleCount, vertexCount, type Mesh } from '@yacad/geometry';
import type { EvaluateResult } from '@yacad/engine';
import { defaultHasher } from '@yacad/hash';
import { hashStlBlob, IMPORT_STL_NODE_TYPE, IMPORT_STL_TYPE } from '@yacad/import-stl';
import type { ManifoldKernel } from '@yacad/kernel-manifold';
import { getKernel } from './pipeline';

let kernel: ManifoldKernel;

beforeAll(async () => {
  kernel = await getKernel();
  // Register the decoder node type once (the registry is global and the host
  // would do this at startup; tests run without a host).
  if (!getNodeType(IMPORT_STL_TYPE)) registerNodeType(IMPORT_STL_NODE_TYPE);
});

/** Build a valid binary STL blob from a list of triangles (each = 3 [x,y,z]). */
function makeStl(triangles: readonly (readonly [number, number, number])[][]): Uint8Array {
  const size = 84 + 50 * triangles.length;
  const buf = new ArrayBuffer(size);
  const view = new DataView(buf);
  view.setUint32(80, triangles.length, true);
  let off = 84;
  for (const tri of triangles) {
    for (let k = 0; k < 3; k++) view.setFloat32(off + k * 4, 0, true); // unused normal
    off += 12;
    for (const [x, y, z] of tri) {
      view.setFloat32(off, x, true);
      view.setFloat32(off + 4, y, true);
      view.setFloat32(off + 8, z, true);
      off += 12;
    }
    view.setUint16(off, 0, true);
    off += 2;
  }
  return new Uint8Array(buf);
}

/** Simple in-memory blob store used as the engine's resolver. */
function blobResolver(map: Map<string, Uint8Array>): DefinitionResolver {
  return { get: (hash) => map.get(hash) };
}

function expectMesh(result: EvaluateResult): Mesh {
  if (result.geometry.kind !== '3d') {
    throw new Error(`expected 3d geometry, got ${result.geometry.kind}`);
  }
  return result.geometry.mesh;
}

describe('import-stl e2e', () => {
  it('decodes a binary STL through buildGraph + Engine.evaluate', async () => {
    const triangle: [number, number, number][] = [
      [0, 0, 0],
      [2, 0, 0],
      [0, 1, 0],
    ];
    const bytes = makeStl([triangle]);
    const hash = await hashStlBlob(bytes);
    const blobs = new Map([[hash, bytes]]);
    const resolver = blobResolver(blobs);

    const engine = new Engine(new MemoryStore(), kernel, { resolver });
    const root = await buildGraph(
      { type: 'import-stl', params: { blobHash: hash } },
      defaultHasher,
      undefined,
      resolver,
    );
    const result = await engine.evaluate(root);

    expect(triangleCount(expectMesh(result))).toBe(1);
    expect(vertexCount(expectMesh(result))).toBe(3); // 3 distinct positions, 1 triangle
    expect(computeBBox(expectMesh(result))).toEqual({ min: [0, 0, 0], max: [2, 1, 0] });
    expect(result.stats.misses).toBe(1);
    expect(result.stats.hits).toBe(0);
  });

  it('hits the cache on the second evaluation of the same import-stl node', async () => {
    const bytes = makeStl([
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ],
    ]);
    const hash = await hashStlBlob(bytes);
    const blobs = new Map([[hash, bytes]]);
    const resolver = blobResolver(blobs);
    const engine = new Engine(new MemoryStore(), kernel, { resolver });

    const root = await buildGraph(
      { type: 'import-stl', params: { blobHash: hash } },
      defaultHasher,
      undefined,
      resolver,
    );
    await engine.evaluate(root);
    const second = await engine.evaluate(root);

    expect(second.stats.misses).toBe(0);
    expect(second.stats.hits).toBe(1);
  });

  it('throws an evaluation error when the referenced blob is not registered', async () => {
    const resolver = blobResolver(new Map());
    const engine = new Engine(new MemoryStore(), kernel, { resolver });
    const root = await buildGraph(
      { type: 'import-stl', params: { blobHash: 'deadbeef'.repeat(8) } },
      defaultHasher,
      undefined,
      resolver,
    );
    await expect(engine.evaluate(root)).rejects.toThrow(/no blob registered/i);
  });

  it('composes an imported STL with a Manifold boolean (round-trip remix)', async () => {
    // Build a real cube via Manifold, encode as binary STL, re-import as a
    // leaf, and subtract a sphere. This proves the imported mesh re-welds
    // through Manifold's constructor cleanly enough for booleans.
    const cubeGeometry = await kernel.evaluate(
      await buildGraph({ type: 'box', params: { size: [20, 20, 20], center: true } }),
      [],
    );
    if (cubeGeometry.kind !== '3d') throw new Error('box must produce a 3d mesh');
    const cubeBytes = meshToBinaryStl(cubeGeometry.mesh);
    const hash = await hashStlBlob(cubeBytes);
    const blobs = new Map([[hash, cubeBytes]]);
    const resolver = blobResolver(blobs);
    const engine = new Engine(new MemoryStore(), kernel, { resolver });

    const doc = {
      type: 'difference',
      children: [
        { type: 'import-stl', params: { blobHash: hash } },
        { type: 'sphere', params: { radius: 12, segments: 48 } },
      ],
    };
    const root = await buildGraph(doc, defaultHasher, undefined, resolver);
    const result = await engine.evaluate(root);

    // The cube (12 tris) with a spherical bite missing should have more tris
    // than the cube alone — proving the boolean ran on the imported mesh.
    expect(triangleCount(expectMesh(result))).toBeGreaterThan(12);
    expect(computeBBox(expectMesh(result))).toEqual({ min: [-10, -10, -10], max: [10, 10, 10] });
  });
});
