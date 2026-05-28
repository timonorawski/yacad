import { defaultHasher } from '@yacad/hash';

export { decodeGlb, GltfDecodeError } from './decode-gltf';
export { IMPORT_GLTF_NODE_TYPE, IMPORT_GLTF_TYPE } from './import-gltf-node';

/**
 * Compute the content hash of a glTF blob — the value the caller should pass
 * as `params.blobHash` when authoring an `import-gltf` node, and as the key
 * when registering the blob in the worker.
 */
export function hashGltfBlob(bytes: Uint8Array): Promise<string> {
  return defaultHasher.hash(bytes);
}
