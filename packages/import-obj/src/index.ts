import { defaultHasher } from '@yacad/hash';

export { decodeObj, ObjDecodeError } from './decode-obj';
export { IMPORT_OBJ_NODE_TYPE, IMPORT_OBJ_TYPE } from './import-obj-node';

/**
 * Compute the content hash of an OBJ blob — the value the caller should pass
 * as `params.blobHash` when authoring an `import-obj` node, and as the key
 * when registering the blob in the worker.
 */
export function hashObjBlob(bytes: Uint8Array): Promise<string> {
  return defaultHasher.hash(bytes);
}
