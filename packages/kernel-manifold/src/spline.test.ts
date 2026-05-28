import { describe, expect, it } from 'vitest';
import { catmullRomClosed } from './spline';

describe('catmullRomClosed', () => {
  it('with N control points and S segments-per-curve produces N*S output points', () => {
    const points = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ] as const;
    const out = catmullRomClosed(points, 4, 0.5);
    expect(out.length).toBe(16);
  });

  it('passes through every control point (interpolation property)', () => {
    const points = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ] as const;
    const out = catmullRomClosed(points, 4, 0.5);
    for (const cp of points) {
      const match = out.some(([x, y]) => Math.abs(x - cp[0]) < 1e-9 && Math.abs(y - cp[1]) < 1e-9);
      expect(match).toBe(true);
    }
  });

  it('is deterministic — same input, same output', () => {
    const points = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ] as const;
    const a = catmullRomClosed(points, 8, 0.5);
    const b = catmullRomClosed(points, 8, 0.5);
    expect(a).toEqual(b);
  });
});
