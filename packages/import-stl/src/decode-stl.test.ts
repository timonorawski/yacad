import { describe, expect, it } from 'vitest';
import { triangleCount, vertexCount } from '@yacad/geometry';
import { decodeBinaryStl, StlDecodeError } from './decode-stl';

/** Build a valid binary-STL blob from a list of triangles (each = 3 [x,y,z]). */
function makeStl(triangles: readonly (readonly [number, number, number])[][]): Uint8Array {
  const size = 84 + 50 * triangles.length;
  const buf = new ArrayBuffer(size);
  const view = new DataView(buf);
  view.setUint32(80, triangles.length, true);
  let off = 84;
  for (const tri of triangles) {
    // Face normal — irrelevant to the decoder (we recompute downstream).
    for (let k = 0; k < 3; k++) view.setFloat32(off + k * 4, 0, true);
    off += 12;
    for (const [x, y, z] of tri) {
      view.setFloat32(off, x, true);
      view.setFloat32(off + 4, y, true);
      view.setFloat32(off + 8, z, true);
      off += 12;
    }
    view.setUint16(off, 0, true); // attribute byte count
    off += 2;
  }
  return new Uint8Array(buf);
}

const triangleA: [number, number, number][] = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
];

describe('decodeBinaryStl', () => {
  it('decodes a single triangle into a triangle-soup mesh', () => {
    const mesh = decodeBinaryStl(makeStl([triangleA]));
    expect(vertexCount(mesh)).toBe(3);
    expect(triangleCount(mesh)).toBe(1);
    expect(Array.from(mesh.vertices)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2]);
  });

  it('keeps disjoint triangle vertices distinct', () => {
    const tri2: [number, number, number][] = [
      [2, 2, 2],
      [3, 2, 2],
      [2, 3, 2],
    ];
    const mesh = decodeBinaryStl(makeStl([triangleA, tri2]));
    expect(vertexCount(mesh)).toBe(6);
    expect(triangleCount(mesh)).toBe(2);
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('welds coincident positions across triangles into a shared index', () => {
    // Two triangles sharing an edge (vertices A and B). After welding the mesh
    // has 4 unique verts, not 6, and the second triangle reuses indices 0 and 1.
    const A: [number, number, number] = [0, 0, 0];
    const B: [number, number, number] = [1, 0, 0];
    const C: [number, number, number] = [0, 1, 0];
    const D: [number, number, number] = [1, 1, 0];
    const mesh = decodeBinaryStl(
      makeStl([
        [A, B, C],
        [B, A, D],
      ]),
    );
    expect(vertexCount(mesh)).toBe(4);
    expect(triangleCount(mesh)).toBe(2);
    expect(Array.from(mesh.indices)).toEqual([0, 1, 2, 1, 0, 3]);
  });

  it('rejects input shorter than the 84-byte header', () => {
    expect(() => decodeBinaryStl(new Uint8Array(50))).toThrow(StlDecodeError);
  });

  it('rejects size mismatch (likely ASCII STL or corruption)', () => {
    const buf = new ArrayBuffer(84 + 50 * 2 - 7); // 7 bytes short for 2 tris
    new DataView(buf).setUint32(80, 2, true);
    expect(() => decodeBinaryStl(new Uint8Array(buf))).toThrow(/size mismatch|ASCII/);
  });

  it('rejects non-finite coordinates (determinism invariant)', () => {
    const buf = new ArrayBuffer(84 + 50);
    const view = new DataView(buf);
    view.setUint32(80, 1, true);
    view.setFloat32(84 + 12, NaN, true); // first vertex.x = NaN
    expect(() => decodeBinaryStl(new Uint8Array(buf))).toThrow(/non-finite/);
  });
});
