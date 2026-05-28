import { beforeAll, describe, expect, it } from 'vitest';
import { Accessor, Document, WebIO } from '@gltf-transform/core';
import { decodeGlb, GltfDecodeError } from './decode-gltf';

/**
 * Build a minimal in-memory glb: one mesh, one triangle primitive at the given
 * matrix on a single node in the default scene. Returns the binary blob.
 */
async function buildSingleTriangleGlb(
  positions: Float32Array,
  indices: Uint32Array | undefined,
  matrix?: [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ],
): Promise<Uint8Array> {
  const doc = new Document();
  const buf = doc.createBuffer();
  const pos = doc.createAccessor().setArray(positions).setType(Accessor.Type.VEC3).setBuffer(buf);
  const prim = doc.createPrimitive().setAttribute('POSITION', pos).setMode(4); // TRIANGLES
  if (indices) {
    const idx = doc.createAccessor().setArray(indices).setType(Accessor.Type.SCALAR).setBuffer(buf);
    prim.setIndices(idx);
  }
  const mesh = doc.createMesh().addPrimitive(prim);
  const node = doc.createNode().setMesh(mesh);
  if (matrix) node.setMatrix(matrix);
  const scene = doc.createScene().addChild(node);
  doc.getRoot().setDefaultScene(scene);
  return new WebIO().writeBinary(doc);
}

describe('decodeGlb', () => {
  let glbBytes: Uint8Array;

  beforeAll(async () => {
    glbBytes = await buildSingleTriangleGlb(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      new Uint32Array([0, 1, 2]),
    );
  });

  it('decodes a single indexed triangle primitive', async () => {
    const mesh = await decodeGlb(glbBytes);
    expect(mesh.vertices).toEqual(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
    expect(mesh.indices).toEqual(new Uint32Array([0, 1, 2]));
  });

  it('synthesizes indices for non-indexed primitives', async () => {
    const noIdx = await buildSingleTriangleGlb(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      undefined,
    );
    const mesh = await decodeGlb(noIdx);
    expect(mesh.indices).toEqual(new Uint32Array([0, 1, 2]));
  });

  it('bakes node world transform into vertex positions', async () => {
    // Identity-rotation, translate by (10, 20, 30). Column-major mat4:
    // m[12..14] = translation.
    const translated = await buildSingleTriangleGlb(
      new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      new Uint32Array([0, 1, 2]),
      [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1],
    );
    const mesh = await decodeGlb(translated);
    expect(Array.from(mesh.vertices)).toEqual([10, 20, 30, 11, 20, 30, 10, 21, 30]);
  });

  it('rejects non-glb input', async () => {
    await expect(decodeGlb(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).rejects.toThrow(
      GltfDecodeError,
    );
  });

  it('rejects primitives with non-TRIANGLES mode', async () => {
    const doc = new Document();
    const buf = doc.createBuffer();
    const pos = doc
      .createAccessor()
      .setArray(new Float32Array([0, 0, 0, 1, 0, 0]))
      .setType(Accessor.Type.VEC3)
      .setBuffer(buf);
    const prim = doc.createPrimitive().setAttribute('POSITION', pos).setMode(1); // LINES
    const mesh = doc.createMesh().addPrimitive(prim);
    const node = doc.createNode().setMesh(mesh);
    const scene = doc.createScene().addChild(node);
    doc.getRoot().setDefaultScene(scene);
    const linesGlb = await new WebIO().writeBinary(doc);
    await expect(decodeGlb(linesGlb)).rejects.toThrow(/mode 1 not supported/);
  });

  it('rejects empty scenes (no mesh primitives)', async () => {
    const doc = new Document();
    const scene = doc.createScene().addChild(doc.createNode());
    doc.getRoot().setDefaultScene(scene);
    const emptyGlb = await new WebIO().writeBinary(doc);
    await expect(decodeGlb(emptyGlb)).rejects.toThrow(/no mesh primitives/);
  });

  it('merges multiple meshes in the default scene into one combined mesh', async () => {
    const doc = new Document();
    const buf = doc.createBuffer();
    const makeNode = (offset: number) => {
      const pos = doc
        .createAccessor()
        .setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]))
        .setType(Accessor.Type.VEC3)
        .setBuffer(buf);
      const idx = doc
        .createAccessor()
        .setArray(new Uint32Array([0, 1, 2]))
        .setType(Accessor.Type.SCALAR)
        .setBuffer(buf);
      const prim = doc.createPrimitive().setAttribute('POSITION', pos).setIndices(idx).setMode(4);
      const mesh = doc.createMesh().addPrimitive(prim);
      const node = doc.createNode().setMesh(mesh);
      node.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, offset, 0, 0, 1]);
      return node;
    };
    const scene = doc.createScene().addChild(makeNode(0)).addChild(makeNode(5));
    doc.getRoot().setDefaultScene(scene);
    const multi = await new WebIO().writeBinary(doc);

    const mesh = await decodeGlb(multi);
    expect(mesh.vertices.length).toBe(9 * 2);
    expect(mesh.indices.length).toBe(3 * 2);
    // Both transforms must be represented; iteration order isn't load-bearing.
    const xs = new Set<number>();
    for (let i = 0; i < mesh.vertices.length; i += 3) xs.add(mesh.vertices[i]!);
    expect(xs).toContain(0);
    expect(xs).toContain(5);
  });
});
