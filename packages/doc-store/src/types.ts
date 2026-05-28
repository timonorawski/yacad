import type { NodeDoc } from '@yacad/dag';
import type { Hash } from '@yacad/hash';
import type { LuaDefinition } from '@yacad/lua';

/** Stable identity + display metadata for a stored document. */
export interface DocMeta {
  readonly id: string;
  readonly name: string;
  /** Milliseconds since epoch. */
  readonly createdAt: number;
  readonly updatedAt: number;
  /** Optional data URL captured by the editor; not used by the doc-store itself. */
  readonly thumbnail?: string;
}

/** Optional initial NodeDoc passed to `library.create`. */
export type NewDocSeed = NodeDoc | undefined;

/** Coarse-grained event emitted by `DocSession.subscribe`. */
export type DocEvent =
  | { kind: 'doc-changed' }
  | { kind: 'meta-changed' }
  | { kind: 'persisted' }
  | { kind: 'invalidated'; error: Error };

/**
 * Narrow interface the doc-store needs from the worker transport layer. The
 * actual `@yacad/worker` WorkerClient class structurally satisfies this — the
 * doc-store deliberately does NOT import from `@yacad/worker` so the
 * dependency direction stays `doc-store` → (nothing UI/transport-specific).
 */
export interface BlobUploader {
  putMeshBlob(hash: Hash, bytes: Uint8Array): Promise<void>;
  hasMeshBlob(hash: Hash): Promise<boolean>;
  putLuaDefinition(hash: Hash, def: LuaDefinition): Promise<void>;
  hasLuaDefinition(hash: Hash): Promise<boolean>;
}

export interface SessionOptions {
  /** Autosave debounce window in milliseconds. Default 500. */
  readonly autosaveMs?: number;
  /**
   * When true, skip `buildGraph` validation on open. Use only in controlled
   * seeding / batch-import paths where the caller guarantees doc integrity
   * and blobs are not yet available to the resolver.
   */
  readonly skipValidation?: boolean;
}

export interface LibraryOptions {
  /** VFS key namespace; defaults to `/docs/`. Must end with `/`. */
  readonly prefix?: string;
}
