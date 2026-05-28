import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh as ThreeMesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  type Object3D,
  Uint32BufferAttribute,
} from 'three';
import type { CrossSection, Geometry, Mesh } from '@yacad/geometry';
import { crossSectionToBufferGeometry, type TriangulateApi } from './cross-section-mesh';

/**
 * Convert an engine mesh into a three.js BufferGeometry. Vertex normals are
 * derived here (the engine ships positions + indices only). Pure — no WebGL
 * context required, which keeps it unit-testable.
 */
export function meshToBufferGeometry(mesh: Mesh): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(mesh.vertices, 3));
  geometry.setIndex(new Uint32BufferAttribute(mesh.indices, 1));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Dispatch on `Geometry.kind`:
 * - 3D → a Mesh with the default PBR material.
 * - 2D → a Group containing a semi-transparent fill Mesh + polygon outlines.
 *
 * The Manifold API is required only for the 2D path (triangulation).
 */
export function geometryToObject3D(geometry: Geometry, api: TriangulateApi): Object3D {
  if (geometry.kind === '3d') {
    const buf = meshToBufferGeometry(geometry.mesh);
    const mat = new MeshStandardMaterial({ color: 0x4f9dde, metalness: 0.1, roughness: 0.6 });
    return new ThreeMesh(buf, mat);
  }
  // 2D: fill + outline group
  const buf = crossSectionToBufferGeometry(geometry.section, api);
  const fill = new ThreeMesh(
    buf,
    new MeshBasicMaterial({ color: 0x88aacc, transparent: true, opacity: 0.4, side: DoubleSide }),
  );
  const outline = buildOutline(geometry.section);
  const group = new Group();
  group.add(fill, outline);
  return group;
}

/** Build a closed-loop Line per polygon for the 2D outline. */
function buildOutline(cs: CrossSection): Object3D {
  const group = new Group();
  for (const polygon of cs.polygons) {
    if (polygon.length === 0) continue;
    // polygon.length + 1 vertices to close the loop
    const positions = new Float32Array((polygon.length + 1) * 3);
    for (let i = 0; i < polygon.length; i++) {
      positions[i * 3] = polygon[i]![0];
      positions[i * 3 + 1] = polygon[i]![1];
      positions[i * 3 + 2] = 0;
    }
    // Close the loop by repeating the first vertex.
    positions[polygon.length * 3] = polygon[0]![0];
    positions[polygon.length * 3 + 1] = polygon[0]![1];
    positions[polygon.length * 3 + 2] = 0;
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(positions, 3));
    group.add(new Line(geom, new LineBasicMaterial({ color: 0x000000 })));
  }
  return group;
}
