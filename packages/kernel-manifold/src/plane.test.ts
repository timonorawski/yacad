import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@yacad/geometry';
import { rotationToAlignWithZ } from './plane';

/** Apply Euler XYZ rotation (degrees) to a vector. Matches Manifold's convention:
 *  rotations applied X then Y then Z. */
function applyEulerXYZ(v: Vec3, euler: Vec3): Vec3 {
  const [rx, ry, rz] = euler.map((d) => (d * Math.PI) / 180) as Vec3;
  // Rotate around X
  let x = v[0];
  let y = v[1] * Math.cos(rx) - v[2] * Math.sin(rx);
  let z = v[1] * Math.sin(rx) + v[2] * Math.cos(rx);
  // Rotate around Y
  const x1 = x * Math.cos(ry) + z * Math.sin(ry);
  const z1 = -x * Math.sin(ry) + z * Math.cos(ry);
  x = x1;
  z = z1;
  // Rotate around Z
  const x2 = x * Math.cos(rz) - y * Math.sin(rz);
  const y2 = x * Math.sin(rz) + y * Math.cos(rz);
  return [x2, y2, z];
}

function close(a: Vec3, b: Vec3, eps = 1e-9): boolean {
  return Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps && Math.abs(a[2] - b[2]) < eps;
}

describe('rotationToAlignWithZ', () => {
  it('returns [0,0,0] for already-aligned +Z', () => {
    expect(rotationToAlignWithZ([0, 0, 1])).toEqual([0, 0, 0]);
  });

  it('returns [180,0,0] for anti-parallel -Z', () => {
    expect(rotationToAlignWithZ([0, 0, -1])).toEqual([180, 0, 0]);
  });

  it('handles non-unit-length input by normalizing', () => {
    // [0, 0, 5] is +Z scaled — same direction.
    expect(rotationToAlignWithZ([0, 0, 5])).toEqual([0, 0, 0]);
  });

  it('rotates +X to +Z (applying the result moves +X onto +Z)', () => {
    const euler = rotationToAlignWithZ([1, 0, 0]);
    const rotated = applyEulerXYZ([1, 0, 0], euler);
    expect(close(rotated, [0, 0, 1])).toBe(true);
  });

  it('rotates +Y to +Z', () => {
    const euler = rotationToAlignWithZ([0, 1, 0]);
    const rotated = applyEulerXYZ([0, 1, 0], euler);
    expect(close(rotated, [0, 0, 1])).toBe(true);
  });

  it('rotates diagonal [1,1,0]/√2 to +Z', () => {
    const s = Math.SQRT1_2;
    const euler = rotationToAlignWithZ([s, s, 0]);
    const rotated = applyEulerXYZ([s, s, 0], euler);
    expect(close(rotated, [0, 0, 1])).toBe(true);
  });

  it('rotates body diagonal [1,1,1]/√3 to +Z', () => {
    const s = 1 / Math.sqrt(3);
    const euler = rotationToAlignWithZ([s, s, s]);
    const rotated = applyEulerXYZ([s, s, s], euler);
    expect(close(rotated, [0, 0, 1])).toBe(true);
  });

  it('is deterministic — same input produces byte-identical output', () => {
    const a = rotationToAlignWithZ([1, 2, 3]);
    const b = rotationToAlignWithZ([1, 2, 3]);
    expect(a).toEqual(b);
  });

  it('handles ten random unit vectors (property test)', () => {
    // Seeded pseudorandom — deterministic across runs
    let state = 0x12345678;
    const rand = () => {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      return state / 0x7fffffff;
    };
    for (let i = 0; i < 10; i++) {
      const x = rand() * 2 - 1;
      const y = rand() * 2 - 1;
      const z = rand() * 2 - 1 || 0.001; // avoid pure-XY edge case here; tested separately
      const len = Math.hypot(x, y, z);
      const normal: Vec3 = [x / len, y / len, z / len];
      const euler = rotationToAlignWithZ(normal);
      const rotated = applyEulerXYZ(normal, euler);
      expect(close(rotated, [0, 0, 1], 1e-9), `failed for normal=${normal.join(',')}`).toBe(true);
    }
  });
});
