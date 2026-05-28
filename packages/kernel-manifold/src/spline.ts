import type { Vec2 } from '@yacad/geometry';

/**
 * Closed Catmull-Rom interpolation. Given N control points and S segments per
 * curve, returns N*S output points along the curve. The curve passes through
 * every control point (interpolating, not approximating).
 *
 * Tension 0.5 is the "standard" Catmull-Rom. Lower values make tighter curves.
 *
 * Pure function — same inputs always produce same outputs (cache-key safe).
 */
export function catmullRomClosed(
  points: ReadonlyArray<readonly [number, number]>,
  segmentsPerCurve: number,
  tension: number,
): Vec2[] {
  const n = points.length;
  const out: Vec2[] = [];
  const t = 1 - tension; // standard formulation uses `t` as the inverse
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n]!;
    const p1 = points[i]!;
    const p2 = points[(i + 1) % n]!;
    const p3 = points[(i + 2) % n]!;
    for (let s = 0; s < segmentsPerCurve; s++) {
      const u = s / segmentsPerCurve;
      const u2 = u * u;
      const u3 = u2 * u;
      // Catmull-Rom basis (matrix form with tension)
      const b0 = -t * u3 + 2 * t * u2 - t * u;
      const b1 = (2 - t) * u3 + (t - 3) * u2 + 1;
      const b2 = (t - 2) * u3 + (3 - 2 * t) * u2 + t * u;
      const b3 = t * u3 - t * u2;
      const x = b0 * p0[0] + b1 * p1[0] + b2 * p2[0] + b3 * p3[0];
      const y = b0 * p0[1] + b1 * p1[1] + b2 * p2[1] + b3 * p3[1];
      out.push([x, y]);
    }
  }
  return out;
}
