import type { Hash } from '@yacad/hash';
import {
  hashPrefix,
  storageKey,
  type Artifact,
  type ArtifactKind,
  type CacheKey,
  type ObjectStore,
  type Pinnable,
} from './types';

const DEFAULT_MAX_ENTRIES = 512;

/**
 * L1 tier: in-memory, bounded, LRU with pinning. Entries whose semantic hash is
 * in the pinned set (the active model) are never evicted, so interactive
 * editing never evicts the geometry currently on screen.
 *
 * Insertion order of a Map is its LRU order here: a read re-inserts to move the
 * entry to the most-recently-used end.
 */
export class MemoryStore implements ObjectStore, Pinnable {
  private readonly entries = new Map<string, Artifact>();
  private readonly pinned = new Set<Hash>();

  constructor(private readonly maxEntries: number = DEFAULT_MAX_ENTRIES) {}

  get(key: CacheKey, kind: ArtifactKind): Promise<Artifact | undefined> {
    const k = storageKey(key, kind);
    const value = this.entries.get(k);
    if (value !== undefined) {
      // Touch: move to MRU end.
      this.entries.delete(k);
      this.entries.set(k, value);
    }
    return Promise.resolve(value);
  }

  put(key: CacheKey, artifact: Artifact): Promise<void> {
    const k = storageKey(key, artifact.kind);
    this.entries.delete(k);
    this.entries.set(k, artifact);
    this.evict();
    return Promise.resolve();
  }

  has(key: CacheKey, kind: ArtifactKind): Promise<boolean> {
    return Promise.resolve(this.entries.has(storageKey(key, kind)));
  }

  delete(key: CacheKey, kind: ArtifactKind): Promise<void> {
    this.entries.delete(storageKey(key, kind));
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.entries.clear();
    this.pinned.clear();
    return Promise.resolve();
  }

  pin(hashes: Iterable<Hash>): void {
    this.pinned.clear();
    for (const h of hashes) this.pinned.add(h);
  }

  /** Current entry count — exposed for cache instrumentation/tests. */
  get size(): number {
    return this.entries.size;
  }

  private evict(): void {
    if (this.entries.size <= this.maxEntries) return;
    for (const k of this.entries.keys()) {
      if (this.entries.size <= this.maxEntries) break;
      if (!this.isPinned(k)) this.entries.delete(k);
    }
    // If everything over budget is pinned, we intentionally overflow rather
    // than evict the active working set.
  }

  private isPinned(storageKeyStr: string): boolean {
    for (const h of this.pinned) {
      if (storageKeyStr.startsWith(hashPrefix(h))) return true;
    }
    return false;
  }
}
