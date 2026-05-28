/**
 * Async key-value byte store. Path-like keys are convention, not contract:
 * the Vfs makes no claims about hierarchy. Values are opaque bytes; textual
 * content is encoded by the caller. Backends today: in-memory (tests) and
 * IndexedDB (prod). The interface is shaped to accept a File System Access
 * impl later without churning consumers.
 */
export interface Vfs {
  /** Reads the bytes stored under `key`, or `undefined` if absent. */
  read(key: string): Promise<Uint8Array | undefined>;

  /** Writes `value` at `key`, overwriting any previous value. */
  write(key: string, value: Uint8Array): Promise<void>;

  /** Removes the value at `key`. No-op if absent. */
  delete(key: string): Promise<void>;

  /** Returns every key whose string starts with `prefix`. Order unspecified. */
  list(prefix: string): Promise<readonly string[]>;
}
