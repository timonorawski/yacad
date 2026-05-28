import { defaultHasher } from '@yacad/hash';

export { decodeBinaryStl, StlDecodeError } from './decode-stl';
export { IMPORT_STL_NODE_TYPE, IMPORT_STL_TYPE } from './import-stl-node';

/**
 * Compute the content hash of an STL blob — the value the caller should pass
 * as `params.blobHash` when authoring an `import-stl` node, and as the key
 * when registering the blob in the worker.
 */
export function hashStlBlob(bytes: Uint8Array): Promise<string> {
  return defaultHasher.hash(bytes);
}
