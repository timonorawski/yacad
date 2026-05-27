import { describe, expect, it } from 'vitest';
import { IndexedDbStore } from './indexeddb-store';
import { MemoryStore } from './memory-store';
import { TieredStore } from './tiered-store';
import { storageKey, type CacheKey, type MeshArtifact } from './types';

function key(semanticHash: string, qualityTier = 'final'): CacheKey {
  return {
    semanticHash,
    producedBy: { kernel: 'manifold', kernelVersion: '3.5.0', engineVersion: '0.0.0', qualityTier },
  };
}

function mesh(seed = 0): MeshArtifact {
  return {
    kind: 'mesh',
    mesh: {
      vertices: new Float32Array([seed, 0, 0, 1, 1, 1, 2, 2, 2]),
      indices: new Uint32Array([0, 1, 2]),
    },
  };
}

let dbCounter = 0;
const freshL2 = () => new IndexedDbStore(`yacad-test-${dbCounter++}`);

describe('storageKey', () => {
  it('separates kinds and provenance under the same semantic hash', () => {
    expect(storageKey(key('h'), 'mesh')).not.toBe(storageKey(key('h'), 'bbox'));
    expect(storageKey(key('h'), 'mesh')).toContain('h:mesh:');
  });

  it('distinguishes quality tiers', () => {
    expect(storageKey(key('h', 'preview'), 'mesh')).not.toBe(storageKey(key('h', 'final'), 'mesh'));
  });
});

describe('MemoryStore', () => {
  it('stores and retrieves artifacts', async () => {
    const store = new MemoryStore();
    await store.put(key('a'), mesh(7));
    const got = await store.get(key('a'), 'mesh');
    expect(got).toEqual(mesh(7));
  });

  it('evicts the least-recently-used entry past capacity', async () => {
    const store = new MemoryStore(2);
    await store.put(key('a'), mesh());
    await store.put(key('b'), mesh());
    await store.put(key('c'), mesh());
    expect(store.size).toBe(2);
    expect(await store.has(key('a'), 'mesh')).toBe(false);
    expect(await store.has(key('c'), 'mesh')).toBe(true);
  });

  it('treats a read as a recency touch', async () => {
    const store = new MemoryStore(2);
    await store.put(key('a'), mesh());
    await store.put(key('b'), mesh());
    await store.get(key('a'), 'mesh'); // a becomes most-recent; b is now LRU
    await store.put(key('c'), mesh());
    expect(await store.has(key('b'), 'mesh')).toBe(false);
    expect(await store.has(key('a'), 'mesh')).toBe(true);
  });

  it('never evicts pinned hashes', async () => {
    const store = new MemoryStore(2);
    store.pin(['a']);
    await store.put(key('a'), mesh());
    await store.put(key('b'), mesh());
    await store.put(key('c'), mesh());
    expect(await store.has(key('a'), 'mesh')).toBe(true); // pinned survives
    expect(await store.has(key('b'), 'mesh')).toBe(false);
    expect(await store.has(key('c'), 'mesh')).toBe(true);
  });
});

describe('IndexedDbStore', () => {
  it('round-trips a mesh artifact through structured clone', async () => {
    const store = freshL2();
    await store.put(key('a'), mesh(3));
    const got = await store.get(key('a'), 'mesh');
    expect(got?.kind).toBe('mesh');
    expect((got as MeshArtifact).mesh.vertices[0]).toBe(3);
  });

  it('round-trips a null bbox artifact', async () => {
    const store = freshL2();
    await store.put(key('a'), { kind: 'bbox', bbox: null });
    expect(await store.get(key('a'), 'bbox')).toEqual({ kind: 'bbox', bbox: null });
  });

  it('reports misses as undefined', async () => {
    const store = freshL2();
    expect(await store.get(key('missing'), 'mesh')).toBeUndefined();
    expect(await store.has(key('missing'), 'mesh')).toBe(false);
  });
});

describe('luaDefinition artifact', () => {
  it('round-trips a luaDefinition artifact', async () => {
    const store = new MemoryStore();
    const k = {
      semanticHash: 'abc',
      producedBy: {
        kernel: 'lua-definition',
        kernelVersion: '0',
        engineVersion: '0',
        qualityTier: 'definition',
      },
    };
    const def = {
      schema: { inputs: [], params: {}, output: '3d' as const },
      code: 'return geo.box({size = {1, 1, 1}})',
    };
    await store.put(k, { kind: 'luaDefinition', definition: def });
    const got = await store.get(k, 'luaDefinition');
    expect(got).toEqual({ kind: 'luaDefinition', definition: def });
  });
});

describe('TieredStore', () => {
  it('writes L1 eagerly and L2 write-behind (flush for durability)', async () => {
    const l1 = new MemoryStore();
    const l2 = freshL2();
    const tiered = new TieredStore(l1, l2);
    await tiered.put(key('a'), mesh());
    expect(await l1.has(key('a'), 'mesh')).toBe(true); // L1 resident immediately
    await tiered.flush();
    expect(await l2.has(key('a'), 'mesh')).toBe(true); // L2 persisted after flush
  });

  it('promotes L2 hits into L1 (warm start after an L1 reset)', async () => {
    const l2 = freshL2();
    // First session populates the cache; flush to persist before "reload".
    const first = new TieredStore(new MemoryStore(), l2);
    await first.put(key('a'), mesh(9));
    await first.flush();

    // "Reload": brand-new L1, same persistent L2.
    const l1 = new MemoryStore();
    const tiered = new TieredStore(l1, l2);
    expect(await l1.has(key('a'), 'mesh')).toBe(false);

    const got = await tiered.get(key('a'), 'mesh');
    expect((got as MeshArtifact).mesh.vertices[0]).toBe(9);
    expect(await l1.has(key('a'), 'mesh')).toBe(true); // promoted on read
  });
});
