import type { Mesh } from '@yacad/geometry';

/**
 * Decode a Wavefront OBJ text blob into an indexed Mesh — positions and faces
 * only. OBJ already has shared-vertex indexing, so we don't need STL-style
 * positional welding: we re-emit `v` lines verbatim as the vertex buffer and
 * remap `f` indices to 0-based.
 *
 * Materials (`mtllib`, `usemtl`), normals (`vn`), texture coords (`vt`),
 * smoothing groups (`s`), and object/group labels (`o`, `g`) are silently
 * ignored. n-gon faces are fan-triangulated (v0, vi, vi+1) — fine for convex
 * faces, which is the overwhelming majority of game-asset OBJs.
 *
 * Negative face indices (relative, OBJ §"Referencing other elements") are
 * resolved against the count of `v` lines seen so far, per spec.
 *
 * Non-finite coordinates, malformed lines, and zero-or-negative indices throw
 * an ObjDecodeError. Invariant #2 (determinism): no fall-through to garbage.
 */
export function decodeObj(bytes: Uint8Array): Mesh {
  const text = TEXT_DECODER.decode(bytes);
  const positions: number[] = [];
  const indices: number[] = [];

  // OBJ is line-oriented; comments start with `#`. Handle CRLF + LF.
  let lineNo = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    lineNo++;
    // Strip inline comments (everything after the first `#`).
    const hash = rawLine.indexOf('#');
    const line = (hash >= 0 ? rawLine.slice(0, hash) : rawLine).trim();
    if (line.length === 0) continue;

    // Tokenize on whitespace runs.
    const parts = line.split(/\s+/);
    const head = parts[0];

    if (head === 'v') {
      // v x y z [w] — w is optional homogeneous coord we don't use.
      if (parts.length < 4) {
        throw new ObjDecodeError(`line ${lineNo}: "v" needs at least 3 coordinates`);
      }
      const x = Number(parts[1]);
      const y = Number(parts[2]);
      const z = Number(parts[3]);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        throw new ObjDecodeError(`line ${lineNo}: non-finite vertex coordinate`);
      }
      positions.push(x, y, z);
    } else if (head === 'f') {
      // f v1[/vt1[/vn1]] v2[/vt2[/vn2]] v3[/vt3[/vn3]] ...
      // We only care about the first slash-separated field on each vertex.
      const face: number[] = [];
      for (let i = 1; i < parts.length; i++) {
        const slashIdx = parts[i]!.indexOf('/');
        const raw = slashIdx >= 0 ? parts[i]!.slice(0, slashIdx) : parts[i]!;
        const idx = parseInt(raw, 10);
        if (!Number.isFinite(idx) || idx === 0) {
          throw new ObjDecodeError(`line ${lineNo}: invalid face index "${parts[i]}"`);
        }
        // OBJ uses 1-based indices; negative is relative-from-end.
        const vertCount = positions.length / 3;
        const zeroBased = idx > 0 ? idx - 1 : vertCount + idx;
        if (zeroBased < 0 || zeroBased >= vertCount) {
          throw new ObjDecodeError(
            `line ${lineNo}: face references vertex ${idx} but only ${vertCount} declared so far`,
          );
        }
        face.push(zeroBased);
      }
      if (face.length < 3) {
        throw new ObjDecodeError(`line ${lineNo}: face needs at least 3 vertices`);
      }
      // Fan triangulation from face[0]. Convex faces produce correct topology;
      // concave faces may self-intersect, but Manifold's constructor would
      // reject those anyway and surface the issue downstream.
      for (let i = 1; i < face.length - 1; i++) {
        indices.push(face[0]!, face[i]!, face[i + 1]!);
      }
    }
    // Everything else (vn, vt, s, g, o, mtllib, usemtl, ...) is silently dropped.
  }

  if (positions.length === 0) {
    throw new ObjDecodeError('OBJ file has no "v" (vertex) lines');
  }
  if (indices.length === 0) {
    throw new ObjDecodeError('OBJ file has no "f" (face) lines');
  }

  return {
    vertices: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}

const TEXT_DECODER = new TextDecoder('utf-8', { fatal: false });

export class ObjDecodeError extends Error {
  override readonly name = 'ObjDecodeError';
}
