import { BufferAttribute, BufferGeometry, Float32BufferAttribute } from 'three';
import type { CrossSection } from '@yacad/geometry';

/** Minimal slice of the Manifold API needed for 2D triangulation. */
export interface TriangulateApi {
  triangulate(
    polygons: [number, number][] | [number, number][][],
    epsilon?: number,
  ): [number, number, number][];
}

/**
 * Build a flat (z=0) BufferGeometry from a CrossSection's polygons.
 * Triangulation uses Manifold's `triangulate` helper, which returns
 * `Vec3[]` — one `[i0, i1, i2]` per triangle, referencing vertices in
 * the flattened polygon list in order.
 */
export function crossSectionToBufferGeometry(
  cs: CrossSection,
  api: TriangulateApi,
): BufferGeometry {
  const polygons = cs.polygons as ReadonlyArray<ReadonlyArray<[number, number]>>;

  // Flatten all polygon vertices into a single vertex list (x, y, 0 per vertex).
  const verts: number[] = [];
  for (const poly of polygons) {
    for (const [x, y] of poly) {
      verts.push(x, y, 0);
    }
  }

  // Manifold's triangulate takes SimplePolygon|SimplePolygon[] and returns
  // Vec3[] where each Vec3 is [i0, i1, i2] referencing the flattened polygon
  // points in order. Cast the readonly nested arrays to the mutable form
  // Manifold's API expects.
  const triVec3 = api.triangulate(polygons as unknown as [number, number][][]);

  // Flatten [i0, i1, i2][] → Uint32Array for THREE.BufferGeometry.setIndex.
  const indices = new Uint32Array(triVec3.length * 3);
  for (let t = 0; t < triVec3.length; t++) {
    const tri = triVec3[t]!;
    indices[t * 3] = tri[0];
    indices[t * 3 + 1] = tri[1];
    indices[t * 3 + 2] = tri[2];
  }

  const geom = new BufferGeometry();
  geom.setAttribute('position', new Float32BufferAttribute(verts, 3));
  geom.setIndex(new BufferAttribute(indices, 1));
  geom.computeVertexNormals();
  return geom;
}
