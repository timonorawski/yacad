/**
 * Benchmarks for @yacad/cache — MemoryStore get/put are on the critical path
 * for every engine evaluation (one get+put per node). storageKey() is called
 * inside every get/put/has.
 */
import { bench, describe } from 'vitest';
import { MemoryStore, storageKey, type CacheKey, type MeshArtifact } from '@yacad/cache';

function key(semanticHash: string): CacheKey {
  return {
    semanticHash,
    producedBy: {
      kernel: 'manifold',
      kernelVersion: '3.5.0',
      engineVersion: '0.0.0',
      qualityTier: 'final',
    },
  };
}

function artifact(): MeshArtifact {
  return {
    kind: 'mesh',
    mesh: {
      vertices: new Float32Array([0, 0, 0, 1, 1, 1, 2, 2, 2]),
      indices: new Uint32Array([0, 1, 2]),
    },
  };
}

const PRE_HASHES = Array.from({ length: 64 }, (_, i) => i.toString(16).padStart(64, '0'));

const warmStore = new MemoryStore(256);
for (const h of PRE_HASHES) {
  void warmStore.put(key(h), artifact());
}

const writeStore = new MemoryStore(256);

const lookupKey = key(PRE_HASHES[32]!);
const hitArtifact = artifact();

describe('storageKey', () => {
  bench('derive flat key from CacheKey', () => {
    storageKey(lookupKey, 'mesh');
  });
});

describe('MemoryStore', () => {
  bench('get (cache hit)', async () => {
    await warmStore.get(lookupKey, 'mesh');
  });

  bench('put (insert new entry)', async () => {
    await writeStore.put(lookupKey, hitArtifact);
  });

  bench('has (positive check)', async () => {
    await warmStore.has(lookupKey, 'mesh');
  });
});
