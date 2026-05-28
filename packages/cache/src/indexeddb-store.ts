import {
  storageKey,
  type Artifact,
  type ArtifactKind,
  type CacheKey,
  type ObjectStore,
} from './types';

const DB_NAME = 'yacad-cache';
const STORE_NAME = 'artifacts';

/**
 * L2 tier: IndexedDB. Persistent across sessions, which is what gives the POC
 * its warm-start: a page reload finds every artifact already here. Typed-array
 * meshes round-trip via structured clone with no manual (de)serialization.
 *
 * Available in browsers, Web Workers, and (under fake-indexeddb) Node tests.
 */
export class IndexedDbStore implements ObjectStore {
  private dbPromise: Promise<IDBDatabase> | undefined;

  constructor(
    private readonly dbName: string = DB_NAME,
    private readonly storeName: string = STORE_NAME,
  ) {}

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const open = indexedDB.open(this.dbName, 1);
        open.onupgradeneeded = () => {
          if (!open.result.objectStoreNames.contains(this.storeName)) {
            open.result.createObjectStore(this.storeName);
          }
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
    }
    return this.dbPromise;
  }

  private async run<T>(
    mode: IDBTransactionMode,
    op: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.db();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(this.storeName, mode);
      const req = op(tx.objectStore(this.storeName));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async get(key: CacheKey, kind: ArtifactKind): Promise<Artifact | undefined> {
    return this.run<Artifact | undefined>('readonly', (s) => s.get(storageKey(key, kind)));
  }

  async put(key: CacheKey, artifact: Artifact): Promise<void> {
    await this.run('readwrite', (s) => s.put(artifact, storageKey(key, artifact.kind)));
  }

  async has(key: CacheKey, kind: ArtifactKind): Promise<boolean> {
    const count = await this.run<number>('readonly', (s) => s.count(storageKey(key, kind)));
    return count > 0;
  }

  async delete(key: CacheKey, kind: ArtifactKind): Promise<void> {
    await this.run('readwrite', (s) => s.delete(storageKey(key, kind)));
  }

  async clear(): Promise<void> {
    await this.run('readwrite', (s) => s.clear());
  }

  /** Close the backing connection (mainly for test isolation). */
  async close(): Promise<void> {
    if (this.dbPromise) {
      (await this.dbPromise).close();
      this.dbPromise = undefined;
    }
  }
}
