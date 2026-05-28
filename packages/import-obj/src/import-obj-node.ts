import type { DecoderNodeType, DefinitionResolver } from '@yacad/dag';
import type { Mesh } from '@yacad/geometry';
import { decodeObj, ObjDecodeError } from './decode-obj';

/**
 * Node type for importing a Wavefront OBJ blob. The blob is content-addressable
 * (same resolver as STL blobs and Lua definitions); the node carries only its
 * hash.
 *
 *   { "type": "import-obj", "params": { "blobHash": "<sha-256 hex>" } }
 */
export const IMPORT_OBJ_TYPE = 'import-obj';

export const IMPORT_OBJ_NODE_TYPE: DecoderNodeType = {
  kind: 'decoder',
  type: IMPORT_OBJ_TYPE,
  output: '3d',

  checkChildren(children, path) {
    if (children.length !== 0) {
      throw new Error(`"${IMPORT_OBJ_TYPE}" takes no children (at ${path})`);
    }
  },

  normalizeParams(params, path) {
    if (typeof params !== 'object' || params === null || Array.isArray(params)) {
      throw new Error(`"${IMPORT_OBJ_TYPE}" params must be an object (at ${path})`);
    }
    const record = params as Record<string, unknown>;
    const blobHash = record['blobHash'];
    if (typeof blobHash !== 'string' || blobHash.length === 0) {
      throw new Error(`"${IMPORT_OBJ_TYPE}" requires a non-empty "blobHash" string (at ${path})`);
    }
    return { blobHash };
  },

  async decode(params: Record<string, unknown>, resolver: DefinitionResolver): Promise<Mesh> {
    const blobHash = params['blobHash'] as string;
    const blob = resolver.get(blobHash);
    if (blob === undefined) {
      throw new ObjDecodeError(`import-obj: no blob registered under hash "${blobHash}"`);
    }
    if (!(blob instanceof Uint8Array)) {
      throw new ObjDecodeError(
        `import-obj: blob under "${blobHash}" is not a Uint8Array (got ${typeof blob})`,
      );
    }
    return decodeObj(blob);
  },
};
