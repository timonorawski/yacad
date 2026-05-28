import type { Vfs } from './types';

/**
 * In-RAM Map-backed Vfs. Returned bytes are *copies* of the stored bytes so
 * mutating one doesn't affect the other — matches IndexedDB's structured-clone
 * semantics and lets tests treat both impls interchangeably.
 */
export class MemoryVfs implements Vfs {
  private readonly map = new Map<string, Uint8Array>();

  async read(key: string): Promise<Uint8Array | undefined> {
    const v = this.map.get(key);
    return v === undefined ? undefined : new Uint8Array(v);
  }

  async write(key: string, value: Uint8Array): Promise<void> {
    this.map.set(key, new Uint8Array(value));
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }

  async list(prefix: string): Promise<readonly string[]> {
    const out: string[] = [];
    for (const k of this.map.keys()) {
      if (k.startsWith(prefix)) out.push(k);
    }
    return out;
  }
}
