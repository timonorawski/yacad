import type { Vfs } from './types';

const DB_NAME = 'yacad-vfs';
const STORE_NAME = 'kv';

/**
 * IndexedDB-backed Vfs. Persistent across reloads. Keys are strings; values
 * are stored as Uint8Array directly (structured clone preserves typed arrays).
 * `list(prefix)` uses an IDBKeyRange bound to keep large stores fast.
 *
 * Available in browsers, Web Workers, and (under fake-indexeddb) Node tests.
 */
export class IndexedDbVfs implements Vfs {
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

  async read(key: string): Promise<Uint8Array | undefined> {
    return this.run<Uint8Array | undefined>('readonly', (s) => s.get(key));
  }

  async write(key: string, value: Uint8Array): Promise<void> {
    await this.run('readwrite', (s) => s.put(value, key));
  }

  async delete(key: string): Promise<void> {
    await this.run('readwrite', (s) => s.delete(key));
  }

  async list(prefix: string): Promise<readonly string[]> {
    // Half-open range [prefix, prefix + '￿') covers all keys starting
    // with `prefix` lexicographically — ￿ is the highest code point in
    // the BMP, larger than anything realistic application code emits.
    const range = IDBKeyRange.bound(prefix, prefix + '￿', false, true);
    return this.run<readonly string[]>(
      'readonly',
      (s) => s.getAllKeys(range) as unknown as IDBRequest<readonly string[]>,
    );
  }

  /** Closes the backing connection (mainly for test isolation). */
  async close(): Promise<void> {
    if (this.dbPromise) {
      (await this.dbPromise).close();
      this.dbPromise = undefined;
    }
  }
}
