import type { Mesh } from '@yacad/geometry';

const HEADER_BYTES = 80;
const COUNT_BYTES = 4;
const TRIANGLE_BYTES = 50; // 12 float32 (normal + 3 verts) + 2-byte attribute

/**
 * Serialize a mesh to binary STL — the lingua franca for slicers, and the POC's
 * one export format. The DAG remains the source of truth; this is a lossy
 * derived artifact (CLAUDE.md #1).
 *
 * Per-triangle facet normals are computed from vertex winding; the trailing
 * attribute-byte-count is left zero. The 80-byte header is zeroed (and so does
 * not begin with "solid", which would falsely signal ASCII STL).
 */
export function meshToBinaryStl(mesh: Mesh): Uint8Array<ArrayBuffer> {
  const v = mesh.vertices;
  const idx = mesh.indices;
  const triangles = Math.floor(idx.length / 3);

  const buffer = new ArrayBuffer(HEADER_BYTES + COUNT_BYTES + triangles * TRIANGLE_BYTES);
  const view = new DataView(buffer);
  view.setUint32(HEADER_BYTES, triangles, true);

  let offset = HEADER_BYTES + COUNT_BYTES;
  for (let t = 0; t < triangles; t++) {
    const a = idx[t * 3]! * 3;
    const b = idx[t * 3 + 1]! * 3;
    const c = idx[t * 3 + 2]! * 3;

    const ax = v[a]!,
      ay = v[a + 1]!,
      az = v[a + 2]!;
    const bx = v[b]!,
      by = v[b + 1]!,
      bz = v[b + 2]!;
    const cx = v[c]!,
      cy = v[c + 1]!,
      cz = v[c + 2]!;

    // Face normal = normalize((b - a) × (c - a)).
    const ux = bx - ax,
      uy = by - ay,
      uz = bz - az;
    const wx = cx - ax,
      wy = cy - ay,
      wz = cz - az;
    let nx = uy * wz - uz * wy;
    let ny = uz * wx - ux * wz;
    let nz = ux * wy - uy * wx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 0) {
      nx /= len;
      ny /= len;
      nz /= len;
    }

    for (const f of [nx, ny, nz, ax, ay, az, bx, by, bz, cx, cy, cz]) {
      view.setFloat32(offset, f, true);
      offset += 4;
    }
    view.setUint16(offset, 0, true); // attribute byte count
    offset += 2;
  }

  return new Uint8Array(buffer);
}
