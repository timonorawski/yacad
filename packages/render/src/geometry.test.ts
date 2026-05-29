import { describe, expect, it } from 'vitest';
import type { Mesh } from '@yacad/geometry';
import { meshToBufferGeometry } from './geometry';
import { crossSectionToBufferGeometry } from './cross-section-mesh';

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
    // Kernel XY-plane triangle → after Z-up→Y-up swizzle, lies on the XZ
    // plane (three.js Y=0). Normal points along +Y in three.js.
    expect(normal.getY(0)).toBeCloseTo(1, 6);
  });
});

describe('crossSectionToBufferGeometry', () => {
  it('builds a BufferGeometry for a simple quad', async () => {
    const { loadManifold } = await import('@yacad/kernel-manifold');
    const api = await loadManifold();
    const cs = {
      polygons: [
        [
          [0, 0] as [number, number],
          [10, 0] as [number, number],
          [10, 10] as [number, number],
          [0, 10] as [number, number],
        ],
      ],
    };
    const buf = crossSectionToBufferGeometry(cs, api);
    expect(buf.getAttribute('position').count).toBe(4);
    expect(buf.getIndex()?.count).toBe(6); // 2 triangles × 3 indices
  });
});
