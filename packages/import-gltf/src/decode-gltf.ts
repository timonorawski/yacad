import { WebIO, type Node as GltfNode } from '@gltf-transform/core';
import type { Mesh } from '@yacad/geometry';

/**
 * Decode a binary glTF (.glb) blob into an indexed Mesh by flattening the
 * default scene: every mesh primitive's positions are transformed by its
 * owning node's world matrix and concatenated into one buffer, with indices
 * offset to match. Materials, animations, skins, textures, morph targets, and
 * non-default scenes are silently dropped — this is the "remix this asset"
 * import path, not a full glTF round-trip.
 *
 * Supported:
 *   - `.glb` (binary glTF) containers
 *   - `TRIANGLES` primitives (mode 4)
 *   - Indexed and non-indexed primitives (non-indexed → 0..N indices)
 *   - Node hierarchy with arbitrary trs / matrix transforms
 *
 * Rejected (throw GltfDecodeError):
 *   - `.gltf` (JSON+external bins) — load and embed before passing here
 *   - LINES / POINTS / TRIANGLE_STRIP / TRIANGLE_FAN primitives
 *   - Empty scenes (no mesh primitives encountered)
 *   - Non-finite positions
 */
export async function decodeGlb(bytes: Uint8Array): Promise<Mesh> {
  // glb magic: 0x46546C67 ("glTF") little-endian at offset 0.
  if (bytes.byteLength < 12 || readU32LE(bytes, 0) !== 0x46546c67) {
    throw new GltfDecodeError(
      'not a binary glTF (.glb): expected magic "glTF" at offset 0. ' +
        'JSON glTF (.gltf) with external buffers is not supported by this decoder; ' +
        'export as .glb (embedded) before importing.',
    );
  }

  const io = new WebIO();
  const doc = await io.readBinary(bytes);

  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  if (!scene) {
    throw new GltfDecodeError('glTF document has no scenes');
  }

  const positions: number[] = [];
  const indices: number[] = [];

  // Iterate scene nodes; getWorldMatrix() already composes the ancestor chain,
  // so we don't need to recurse manually and accumulate transforms ourselves.
  // The traversal needs all descendant nodes regardless, so flatten via listChildren.
  const allNodes = flattenNodes(scene.listChildren());

  let primCount = 0;
  for (const node of allNodes) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const worldMatrix = node.getWorldMatrix();
    for (const prim of mesh.listPrimitives()) {
      const mode = prim.getMode();
      if (mode !== 4 /* TRIANGLES */) {
        throw new GltfDecodeError(
          `primitive mode ${mode} not supported (only TRIANGLES=4); ` +
            'reauthor the asset to use triangle lists',
        );
      }
      const posAcc = prim.getAttribute('POSITION');
      if (!posAcc) continue;
      const posArr = posAcc.getArray();
      if (!posArr) continue;
      const baseIndex = positions.length / 3;

      // Transform positions by world matrix and append. mat4 is column-major
      // per glTF spec: m[col*4 + row].
      const vertCount = posAcc.getCount();
      for (let v = 0; v < vertCount; v++) {
        const x = posArr[v * 3]!;
        const y = posArr[v * 3 + 1]!;
        const z = posArr[v * 3 + 2]!;
        const wx =
          worldMatrix[0]! * x + worldMatrix[4]! * y + worldMatrix[8]! * z + worldMatrix[12]!;
        const wy =
          worldMatrix[1]! * x + worldMatrix[5]! * y + worldMatrix[9]! * z + worldMatrix[13]!;
        const wz =
          worldMatrix[2]! * x + worldMatrix[6]! * y + worldMatrix[10]! * z + worldMatrix[14]!;
        if (!Number.isFinite(wx) || !Number.isFinite(wy) || !Number.isFinite(wz)) {
          throw new GltfDecodeError(`non-finite position after world transform at vertex ${v}`);
        }
        positions.push(wx, wy, wz);
      }

      // Indices: either explicit or implicit (0..N-1).
      const idxAcc = prim.getIndices();
      if (idxAcc) {
        const idxArr = idxAcc.getArray();
        if (idxArr) {
          for (let i = 0; i < idxArr.length; i++) {
            indices.push(baseIndex + idxArr[i]!);
          }
        }
      } else {
        for (let i = 0; i < vertCount; i++) indices.push(baseIndex + i);
      }

      primCount++;
    }
  }

  if (primCount === 0) {
    throw new GltfDecodeError('glTF document contains no mesh primitives in the default scene');
  }

  return {
    vertices: new Float32Array(positions),
    indices: new Uint32Array(indices),
  };
}

function flattenNodes(roots: readonly GltfNode[]): GltfNode[] {
  const out: GltfNode[] = [];
  const stack: GltfNode[] = [...roots];
  while (stack.length) {
    const n = stack.pop()!;
    out.push(n);
    for (const child of n.listChildren()) stack.push(child);
  }
  return out;
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! |
    (bytes[offset + 1]! << 8) |
    (bytes[offset + 2]! << 16) |
    (bytes[offset + 3]! << 24)
  );
}

export class GltfDecodeError extends Error {
  override readonly name = 'GltfDecodeError';
}
