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
 * Swizzle kernel Z-up coordinates to three.js Y-up: (x, y, z) → (x, z, -y).
 * This preserves right-handedness: kernel X×Y=Z maps to viewport X×Z=(-Y).
 */
export function kernelToViewport(x: number, y: number, z: number): [number, number, number] {
  return [x, z, -y];
}

/**
 * Convert an engine mesh into a three.js BufferGeometry. Applies the Z-up→Y-up
 * coordinate transform and derives vertex normals. Pure — no WebGL context
 * required, which keeps it unit-testable.
 */
export function meshToBufferGeometry(mesh: Mesh): BufferGeometry {
  // Swizzle vertices from kernel Z-up to three.js Y-up in-place on a copy.
  const src = mesh.vertices;
  const dst = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 3) {
    dst[i] = src[i]!; // x → x
    dst[i + 1] = src[i + 2]!; // z → y
    dst[i + 2] = -src[i + 1]!; // -y → z
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(dst, 3));
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

/** Build a closed-loop Line per polygon for the 2D outline (Z-up→Y-up). */
function buildOutline(cs: CrossSection): Object3D {
  const group = new Group();
  for (const polygon of cs.polygons) {
    if (polygon.length === 0) continue;
    // polygon.length + 1 vertices to close the loop
    const positions = new Float32Array((polygon.length + 1) * 3);
    for (let i = 0; i < polygon.length; i++) {
      // 2D kernel (x, y) on XY plane → three.js (x, 0, -y) on XZ plane
      positions[i * 3] = polygon[i]![0];
      positions[i * 3 + 1] = 0;
      positions[i * 3 + 2] = -polygon[i]![1];
    }
    // Close the loop by repeating the first vertex.
    positions[polygon.length * 3] = polygon[0]![0];
    positions[polygon.length * 3 + 1] = 0;
    positions[polygon.length * 3 + 2] = -polygon[0]![1];
    const geom = new BufferGeometry();
    geom.setAttribute('position', new BufferAttribute(positions, 3));
    group.add(new Line(geom, new LineBasicMaterial({ color: 0x000000 })));
  }
  return group;
}
