/** A point or vector in 3D space. */
export type Vec3 = readonly [number, number, number];

/**
 * A triangle mesh: the derived, cacheable artifact produced by evaluating a DAG
 * node. Vertices are flat XYZ triples; indices reference vertices three at a
 * time to form triangles. Typed arrays keep meshes transferable across the
 * worker boundary without a structured-clone copy.
 */
export interface Mesh {
  readonly vertices: Float32Array;
  readonly indices: Uint32Array;
}

/** An axis-aligned bounding box. */
export interface BBox {
  readonly min: Vec3;
  readonly max: Vec3;
}

/** The canonical empty mesh. */
export function emptyMesh(): Mesh {
  return { vertices: new Float32Array(0), indices: new Uint32Array(0) };
}

export function vertexCount(mesh: Mesh): number {
  return mesh.vertices.length / 3;
}

export function triangleCount(mesh: Mesh): number {
  return mesh.indices.length / 3;
}

/** Compute the axis-aligned bounding box of a mesh; null for an empty mesh. */
export function computeBBox(mesh: Mesh): BBox | null {
  const { vertices } = mesh;
  if (vertices.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < vertices.length; i += 3) {
    const x = vertices[i]!;
    const y = vertices[i + 1]!;
    const z = vertices[i + 2]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}
