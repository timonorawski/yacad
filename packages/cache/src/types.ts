import type { Hash } from '@yacad/hash';
import type { BBox, Mesh } from '@yacad/geometry';

/**
 * Provenance half of a cache key (CLAUDE.md #3): which implementation produced
 * an artifact. Kept structurally separate from the semantic hash so the cache
 * can hold multiple valid artifacts for one geometry (different kernels,
 * versions, or quality tiers) and select among them.
 */
export interface ProducedBy {
  readonly kernel: string;
  readonly kernelVersion: string;
  readonly engineVersion: string;
  readonly qualityTier: string;
}

/**
 * Structured cache key: `semanticHash` identifies the geometry, `producedBy` is
 * provenance. Never collapse these into one opaque string at the API boundary.
 */
export interface CacheKey {
  readonly semanticHash: Hash;
  readonly producedBy: ProducedBy;
}

/** The kinds of derived artifact stored per node, each under its own sub-key. */
export type ArtifactKind = 'mesh' | 'bbox';

export interface MeshArtifact {
  readonly kind: 'mesh';
  readonly mesh: Mesh;
}

export interface BBoxArtifact {
  readonly kind: 'bbox';
  readonly bbox: BBox | null;
}

export type Artifact = MeshArtifact | BBoxArtifact;

/**
 * Async-uniform store. Consumers use this interface without knowing which tier
 * (memory / IndexedDB / remote) actually serves a request.
 */
export interface ObjectStore {
  get(key: CacheKey, kind: ArtifactKind): Promise<Artifact | undefined>;
  put(key: CacheKey, artifact: Artifact): Promise<void>;
  has(key: CacheKey, kind: ArtifactKind): Promise<boolean>;
  delete(key: CacheKey, kind: ArtifactKind): Promise<void>;
}

/** Stores that support pinning a working set against eviction (the L1 tier). */
export interface Pinnable {
  /** Replace the set of semantic hashes protected from eviction. */
  pin(hashes: Iterable<Hash>): void;
}

/**
 * Derive the flat backing-store key. The `{hash}:{kind}` prefix matches the
 * vision's sub-key scheme; the provenance suffix keeps per-kernel/version/tier
 * artifacts distinct under the same geometry.
 */
export function storageKey(key: CacheKey, kind: ArtifactKind): string {
  const pb = key.producedBy;
  return `${key.semanticHash}:${kind}:${pb.kernel}@${pb.kernelVersion}:e${pb.engineVersion}:${pb.qualityTier}`;
}

/** The semantic-hash prefix shared by every artifact of one geometry. */
export function hashPrefix(hash: Hash): string {
  return `${hash}:`;
}
