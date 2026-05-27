import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute } from 'three';
import type { Mesh } from '@yacad/geometry';

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
