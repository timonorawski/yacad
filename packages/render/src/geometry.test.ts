import { describe, expect, it } from 'vitest';
import type { Mesh } from '@yacad/geometry';
import { meshToBufferGeometry } from './geometry';

const triangle: Mesh = {
  vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  indices: new Uint32Array([0, 1, 2]),
};

describe('meshToBufferGeometry', () => {
  it('maps positions and indices onto the BufferGeometry', () => {
    const geometry = meshToBufferGeometry(triangle);
    expect(geometry.getAttribute('position').count).toBe(3);
    expect(geometry.getIndex()?.count).toBe(3);
  });

  it('derives vertex normals', () => {
    const geometry = meshToBufferGeometry(triangle);
    const normal = geometry.getAttribute('normal');
    expect(normal).toBeTruthy();
    expect(normal.count).toBe(3);
    // XY-plane triangle → +Z normal.
    expect(normal.getZ(0)).toBeCloseTo(1, 6);
  });
});
