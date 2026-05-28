import type { Vec3 } from '@yacad/geometry';

/**
 * Euler angles [x, y, z] (degrees, applied X→Y→Z per Manifold convention)
 * that map `normal` to +Z via the shortest-arc rotation. Used by `section`
 * to align an arbitrary cut plane with the XY plane at z=0.
 *
 * Pure function — no IO, no randomness. Deterministic for any fixed normal.
 */
export function rotationToAlignWithZ(normal: Vec3): Vec3 {
  const len = Math.hypot(normal[0], normal[1], normal[2]);
  const nx = normal[0] / len;
  const ny = normal[1] / len;
  const nz = normal[2] / len;

  const EPS = 1e-12;

  // Already aligned (+Z) — identity
  if (nz > 1 - EPS) return [0, 0, 0];

  // Anti-parallel (-Z) — rotate 180° around X (any perpendicular axis works;
  // X is the canonical choice and matches the test convention).
  if (nz < -1 + EPS) return [180, 0, 0];

  // General case: shortest-arc rotation.
  // Axis = normal × +Z = (ny, -nx, 0); normalized.
  // [nx,ny,nz] × [0,0,1] = [ny*1-nz*0, nz*0-nx*1, nx*0-ny*0] = [ny, -nx, 0]
  // Angle = acos(nz).
  const angle = Math.acos(nz);
  const axisLen = Math.hypot(nx, ny); // axisLen = sqrt(ny² + nx²) since z-component is 0
  const ux = ny / axisLen;
  const uy = -nx / axisLen;
  // uz = 0; the axis lies in the XY plane

  return axisAngleToEulerXYZ(ux, uy, 0, angle);
}

/**
 * Convert axis-angle (unit axis (ux,uy,uz), angle in radians) to Euler XYZ
 * (degrees) matching Manifold's convention (rotations applied X then Y then Z).
 *
 * Builds the rotation matrix via Rodrigues, then extracts XYZ Euler angles.
 */
function axisAngleToEulerXYZ(ux: number, uy: number, uz: number, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;

  // Rodrigues' formula: row-major rotation matrix
  const m00 = t * ux * ux + c;
  const m01 = t * ux * uy - s * uz;
  const m02 = t * ux * uz + s * uy;
  const m10 = t * ux * uy + s * uz;
  const m11 = t * uy * uy + c;
  const m12 = t * uy * uz - s * ux;
  const m20 = t * ux * uz - s * uy;
  const m21 = t * uy * uz + s * ux;
  const m22 = t * uz * uz + c;

  // Extract XYZ Euler angles (assuming rotation R = Rz · Ry · Rx applied to a
  // column vector — Manifold rotates X first, then Y, then Z, so the combined
  // matrix is R = Rz · Ry · Rx).
  //
  // For R = Rz · Ry · Rx:
  //   r02 =  sin(ry)
  //   r12 = -sin(rx) · cos(ry)
  //   r22 =  cos(rx) · cos(ry)
  //   r00 =  cos(ry) · cos(rz)
  //   r01 = -cos(ry) · sin(rz)
  //
  // Solve for rx, ry, rz.

  const EPS = 1e-9;
  let rx: number;
  let ry: number;
  let rz: number;

  if (Math.abs(m02) < 1 - EPS) {
    ry = Math.asin(m02);
    rx = Math.atan2(-m12, m22);
    rz = Math.atan2(-m01, m00);
  } else {
    // Gimbal lock: ry = ±π/2. Pick rz = 0 and solve.
    ry = m02 > 0 ? Math.PI / 2 : -Math.PI / 2;
    rz = 0;
    rx = Math.atan2(m10, m11);
  }

  const toDeg = (r: number): number => (r * 180) / Math.PI;
  return [toDeg(rx), toDeg(ry), toDeg(rz)];
}
