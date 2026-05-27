import { describe, expect, it } from 'vitest';
import type { Mesh } from '@yacad/geometry';
import { meshToBinaryStl } from './stl';

// A single triangle in the XY plane; its normal should point along +Z.
const triangle: Mesh = {
  vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  indices: new Uint32Array([0, 1, 2]),
};

describe('meshToBinaryStl', () => {
  it('produces the exact binary layout (84 + 50*tris bytes)', () => {
    const stl = meshToBinaryStl(triangle);
    expect(stl.byteLength).toBe(84 + 50);
  });

  it('writes the triangle count at offset 80', () => {
    const stl = meshToBinaryStl(triangle);
    const view = new DataView(stl.buffer);
    expect(view.getUint32(80, true)).toBe(1);
  });

  it('does not begin with the ASCII "solid" marker', () => {
    const stl = meshToBinaryStl(triangle);
    const head = new TextDecoder().decode(stl.subarray(0, 5));
    expect(head).not.toBe('solid');
  });

  it('computes a unit +Z facet normal for CCW winding', () => {
    const stl = meshToBinaryStl(triangle);
    const view = new DataView(stl.buffer);
    // Normal is the first 3 float32 of the triangle record at offset 84.
    expect(view.getFloat32(84, true)).toBeCloseTo(0, 6);
    expect(view.getFloat32(88, true)).toBeCloseTo(0, 6);
    expect(view.getFloat32(92, true)).toBeCloseTo(1, 6);
  });

  it('round-trips the first vertex position', () => {
    const moved: Mesh = {
      vertices: new Float32Array([5, 6, 7, 6, 6, 7, 5, 7, 7]),
      indices: new Uint32Array([0, 1, 2]),
    };
    const view = new DataView(meshToBinaryStl(moved).buffer);
    // First vertex starts after the 3-float normal: offset 84 + 12.
    expect(view.getFloat32(96, true)).toBeCloseTo(5, 6);
    expect(view.getFloat32(100, true)).toBeCloseTo(6, 6);
    expect(view.getFloat32(104, true)).toBeCloseTo(7, 6);
  });
});
