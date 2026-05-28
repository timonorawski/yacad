import type { Hash } from '@yacad/hash';
import type { MemoryStore } from './memory-store';
import type { IndexedDbStore } from './indexeddb-store';
import type { Artifact, ArtifactKind, CacheKey, ObjectStore, Pinnable } from './types';

/**
 * Composite store presenting the multi-tier cache as one async-uniform
 * ObjectStore. Reads fall through L1 → L2 and promote L2 hits back into L1.
 *
 * Writes are L1-eager / L2-write-behind: the in-memory tier is updated
 * synchronously (so same-session reads hit immediately) while the IndexedDB
 * write is scheduled but not awaited — keeping its latency off the evaluation
 * critical path. Durability is reconciled via `flush()`. This is the single
 * object the engine talks to; it never knows which tier served a request.
 */
export class TieredStore implements ObjectStore, Pinnable {
  private readonly pendingL2 = new Set<Promise<void>>();

  constructor(
    private readonly l1: MemoryStore,
    private readonly l2: IndexedDbStore,
  ) {}

  async get(key: CacheKey, kind: ArtifactKind): Promise<Artifact | undefined> {
    const fromL1 = await this.l1.get(key, kind);
    if (fromL1 !== undefined) return fromL1;

    const fromL2 = await this.l2.get(key, kind);
    if (fromL2 !== undefined) {
      await this.l1.put(key, fromL2); // promote to hot tier
    }
    return fromL2;
  }

  put(key: CacheKey, artifact: Artifact): Promise<void> {
    // L1 (Map) write is synchronous; the data is resident the moment this
    // returns, so same-session reads never wait on it.
    void this.l1.put(key, artifact);
    // L2 (IndexedDB) is write-behind: schedule, track, but don't await.
    const write = this.l2
      .put(key, artifact)
      .catch((err: unknown) => {
        console.error('yacad cache: L2 write failed', err);
      })
      .finally(() => this.pendingL2.delete(write));
    this.pendingL2.add(write);
    return Promise.resolve();
  }

  /** Await all outstanding L2 writes — call before relying on persistence. */
  async flush(): Promise<void> {
    await Promise.all([...this.pendingL2]);
  }

  async has(key: CacheKey, kind: ArtifactKind): Promise<boolean> {
    return (await this.l1.has(key, kind)) || (await this.l2.has(key, kind));
  }

  async delete(key: CacheKey, kind: ArtifactKind): Promise<void> {
    await Promise.all([this.l1.delete(key, kind), this.l2.delete(key, kind)]);
  }

  async clear(): Promise<void> {
    // Drain any write-behind L2 writes first so they don't repopulate the
    // store after we've cleared it.
    await this.flush();
    await Promise.all([this.l1.clear(), this.l2.clear()]);
  }

  pin(hashes: Iterable<Hash>): void {
    this.l1.pin(hashes);
  }
}
