import type { DecoderNodeType, DefinitionResolver } from '@yacad/dag';
import type { Mesh } from '@yacad/geometry';
import { decodeGlb, GltfDecodeError } from './decode-gltf';

/**
 * Node type for importing a binary glTF (.glb) blob. The blob is content-
 * addressable; the node carries only its hash.
 *
 *   { "type": "import-gltf", "params": { "blobHash": "<sha-256 hex>" } }
 */
export const IMPORT_GLTF_TYPE = 'import-gltf';

export const IMPORT_GLTF_NODE_TYPE: DecoderNodeType = {
  kind: 'decoder',
  type: IMPORT_GLTF_TYPE,
  output: '3d',

  checkChildren(children, path) {
    if (children.length !== 0) {
      throw new Error(`"${IMPORT_GLTF_TYPE}" takes no children (at ${path})`);
    }
  },

  normalizeParams(params, path) {
    if (typeof params !== 'object' || params === null || Array.isArray(params)) {
      throw new Error(`"${IMPORT_GLTF_TYPE}" params must be an object (at ${path})`);
    }
    const record = params as Record<string, unknown>;
    const blobHash = record['blobHash'];
    if (typeof blobHash !== 'string' || blobHash.length === 0) {
      throw new Error(`"${IMPORT_GLTF_TYPE}" requires a non-empty "blobHash" string (at ${path})`);
    }
    return { blobHash };
  },

  async decode(params: Record<string, unknown>, resolver: DefinitionResolver): Promise<Mesh> {
    const blobHash = params['blobHash'] as string;
    const blob = resolver.get(blobHash);
    if (blob === undefined) {
      throw new GltfDecodeError(`import-gltf: no blob registered under hash "${blobHash}"`);
    }
    if (!(blob instanceof Uint8Array)) {
      throw new GltfDecodeError(
        `import-gltf: blob under "${blobHash}" is not a Uint8Array (got ${typeof blob})`,
      );
    }
    return decodeGlb(blob);
  },
};
