import type { DecoderNodeType, DefinitionResolver } from '@yacad/dag';
import type { Mesh } from '@yacad/geometry';
import { decodeBinaryStl, StlDecodeError } from './decode-stl';

/**
 * Node type for importing a binary STL blob. The blob itself is content-
 * addressable and lives in the same resolver as other blob-leaf inputs (Lua
 * definitions, etc.); the node carries only its hash.
 *
 *   { "type": "import-stl", "params": { "blobHash": "<sha-256 hex>" } }
 */
export const IMPORT_STL_TYPE = 'import-stl';

export const IMPORT_STL_NODE_TYPE: DecoderNodeType = {
  kind: 'decoder',
  type: IMPORT_STL_TYPE,
  output: '3d',

  checkChildren(children, path) {
    if (children.length !== 0) {
      throw new Error(`"${IMPORT_STL_TYPE}" takes no children (at ${path})`);
    }
  },

  normalizeParams(params, path) {
    if (typeof params !== 'object' || params === null || Array.isArray(params)) {
      throw new Error(`"${IMPORT_STL_TYPE}" params must be an object (at ${path})`);
    }
    const record = params as Record<string, unknown>;
    const blobHash = record['blobHash'];
    if (typeof blobHash !== 'string' || blobHash.length === 0) {
      throw new Error(`"${IMPORT_STL_TYPE}" requires a non-empty "blobHash" string (at ${path})`);
    }
    return { blobHash };
  },

  async decode(params: Record<string, unknown>, resolver: DefinitionResolver): Promise<Mesh> {
    const blobHash = params['blobHash'] as string;
    const blob = resolver.get(blobHash);
    if (blob === undefined) {
      throw new StlDecodeError(`import-stl: no blob registered under hash "${blobHash}"`);
    }
    if (!(blob instanceof Uint8Array)) {
      throw new StlDecodeError(
        `import-stl: blob under "${blobHash}" is not a Uint8Array (got ${typeof blob})`,
      );
    }
    return decodeBinaryStl(blob);
  },
};
