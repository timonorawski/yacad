import { describe, expect, it } from 'vitest';
import { isMesh, isCrossSection, type Geometry } from './geometry';

describe('Geometry helpers', () => {
  it('isMesh narrows 3D geometries', () => {
    const g: Geometry = {
      kind: '3d',
      mesh: { vertices: new Float32Array(), indices: new Uint32Array() },
    };
    expect(isMesh(g)).toBe(true);
    expect(isCrossSection(g)).toBe(false);
  });

  it('isCrossSection narrows 2D geometries', () => {
    const g: Geometry = { kind: '2d', section: { polygons: [] } };
    expect(isCrossSection(g)).toBe(true);
    expect(isMesh(g)).toBe(false);
  });
});
