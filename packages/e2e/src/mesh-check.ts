import type { Mesh } from '@yacad/geometry';

/**
 * Count undirected edges not shared by exactly two triangles.
 *
 * Manifold emits an indexed, vertex-welded mesh, so a watertight 2-manifold
 * solid has every edge referenced by exactly two triangles; any other count
 * signals a hole, a non-manifold edge, or degenerate output. Returns 0 for a
 * clean closed mesh — a strong correctness signal for the torture cases.
 */
export function nonManifoldEdges(mesh: Mesh): number {
  const counts = new Map<string, number>();
  const idx = mesh.indices;
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const tri = [idx[t]!, idx[t + 1]!, idx[t + 2]!];
    for (let e = 0; e < 3; e++) {
      const u = tri[e]!;
      const v = tri[(e + 1) % 3]!;
      const key = u < v ? `${u}:${v}` : `${v}:${u}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let bad = 0;
  for (const c of counts.values()) if (c !== 2) bad++;
  return bad;
}

/** A mesh is watertight (closed, edge-manifold) when it has no bad edges. */
export function isWatertight(mesh: Mesh): boolean {
  return nonManifoldEdges(mesh) === 0;
}
