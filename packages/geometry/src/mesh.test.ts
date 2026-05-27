import { describe, expect, it } from 'vitest';
import { computeBBox, emptyMesh, triangleCount, vertexCount, type Mesh } from './mesh';

// A unit tetrahedron-ish mesh spanning [0,2] on each axis.
const sample: Mesh = {
  vertices: new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0, 0, 0, 2]),
  indices: new Uint32Array([0, 1, 2, 0, 1, 3]),
};

describe('mesh helpers', () => {
  it('counts vertices and triangles', () => {
    expect(vertexCount(sample)).toBe(4);
    expect(triangleCount(sample)).toBe(2);
  });

  it('reports zero counts for the empty mesh', () => {
    const m = emptyMesh();
    expect(vertexCount(m)).toBe(0);
    expect(triangleCount(m)).toBe(0);
  });

  it('computes the axis-aligned bounding box', () => {
    expect(computeBBox(sample)).toEqual({ min: [0, 0, 0], max: [2, 2, 2] });
  });

  it('returns null bbox for an empty mesh', () => {
    expect(computeBBox(emptyMesh())).toBeNull();
  });

  it('handles negative coordinates', () => {
    const m: Mesh = {
      vertices: new Float32Array([-1, -2, -3, 1, 2, 3]),
      indices: new Uint32Array(),
    };
    expect(computeBBox(m)).toEqual({ min: [-1, -2, -3], max: [1, 2, 3] });
  });
});
