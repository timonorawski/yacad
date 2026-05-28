import type { Mesh } from '@yacad/geometry';

/**
 * Decode a binary STL blob into an indexed Mesh, welding triangle vertices by
 * exact float32 position match. Welding here isn't "repair" — it's recovery of
 * information the STL encoding *threw away*: STLs conceptually have shared
 * vertices, but the binary format stores each triangle's three verts inline.
 * Re-indexing them by exact position is the correct inverse of STL
 * serialization, leaving genuinely-broken meshes (holes, inverted normals,
 * self-intersections) to a dedicated `repair-mesh` transform.
 *
 * Format (Wikipedia "STL (file format)"):
 *   - 80-byte header (ignored)
 *   - uint32 LE triangle count
 *   - per triangle: 12 float32 LE (3 normal + 9 vertex coords) + 2 unused bytes
 *   Total: 84 + 50 * triCount bytes
 *
 * ASCII STLs aren't supported — we recognize them by a size mismatch against
 * the binary expectation and throw a clear error rather than silently producing
 * garbage.
 *
 * Non-finite floats anywhere in the file are rejected (invariant #2: a node's
 * evaluation must be deterministic; NaN/Infinity input poisons downstream
 * compares and hashing).
 */
export function decodeBinaryStl(bytes: Uint8Array): Mesh {
  if (bytes.byteLength < 84) {
    throw new StlDecodeError(`binary STL must be at least 84 bytes (got ${bytes.byteLength})`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triCount = view.getUint32(80, true);
  const expected = 84 + 50 * triCount;
  if (bytes.byteLength !== expected) {
    throw new StlDecodeError(
      `binary STL size mismatch (got ${bytes.byteLength} bytes, expected ${expected} for ${triCount} triangles); the file may be ASCII STL, which this decoder doesn't accept`,
    );
  }

  // Weld by exact float32 position. `${x},${y},${z}` is deterministic per
  // float64 value, and float32→float64 widening is lossless, so the dedup is
  // reproducible across runs and across machines.
  const vertMap = new Map<string, number>();
  const vertList: number[] = [];
  const indices = new Uint32Array(triCount * 3);

  for (let t = 0; t < triCount; t++) {
    // Skip the 3-float face normal; we recompute normals at render time.
    const triOff = 84 + 50 * t + 12;
    for (let v = 0; v < 3; v++) {
      const off = triOff + v * 12;
      const x = view.getFloat32(off, true);
      const y = view.getFloat32(off + 4, true);
      const z = view.getFloat32(off + 8, true);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        throw new StlDecodeError(
          `triangle ${t} has a non-finite vertex coordinate at offset ${off}`,
        );
      }
      const key = `${x},${y},${z}`;
      let idx = vertMap.get(key);
      if (idx === undefined) {
        idx = vertList.length / 3;
        vertList.push(x, y, z);
        vertMap.set(key, idx);
      }
      indices[t * 3 + v] = idx;
    }
  }

  return { vertices: new Float32Array(vertList), indices };
}

export class StlDecodeError extends Error {
  override readonly name = 'StlDecodeError';
}
