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
export type ArtifactKind = 'mesh' | 'bbox' | 'luaDefinition' | 'crossSection' | 'expandedDoc';

export interface MeshArtifact {
  readonly kind: 'mesh';
  readonly mesh: Mesh;
}

export interface BBoxArtifact {
  readonly kind: 'bbox';
  readonly bbox: BBox | null;
}

/**
 * Structural placeholder for a Lua definition. The concrete
 * `LuaDefinition` from @yacad/lua is structurally assignable to this; we keep
 * @yacad/cache free of any @yacad/lua import so the dep graph stays acyclic
 * and `cache` and `lua` remain siblings under `dag` (see spec §Layered
 * placement).
 */
export interface LuaDefinitionLike {
  readonly schema: { readonly output: '2d' | '3d'; readonly [k: string]: unknown };
  readonly code: string;
}

export interface LuaDefinitionArtifact {
  readonly kind: 'luaDefinition';
  readonly definition: LuaDefinitionLike;
}

/**
 * Structural placeholder for a 2D cross-section artifact. The real
 * `CrossSection` from @yacad/geometry is structurally assignable. We keep
 * @yacad/cache free of @yacad/geometry imports so the dep graph stays acyclic
 * and the package boundaries match Phase 1's LuaDefinitionLike pattern.
 */
export interface CrossSectionLike {
  readonly polygons: ReadonlyArray<ReadonlyArray<readonly [number, number]>>;
}

export interface CrossSectionArtifact {
  readonly kind: 'crossSection';
  readonly section: CrossSectionLike;
}

/**
 * Structural placeholder for an expanded sub-DAG document. The real `NodeDoc`
 * from @yacad/dag is structurally assignable. We keep @yacad/cache free of
 * @yacad/dag imports so the dep graph stays acyclic (same pattern as
 * LuaDefinitionLike and CrossSectionLike).
 */
export interface NodeDocLike {
  readonly type: string;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly children?: readonly NodeDocLike[];
}

export interface ExpandedDocArtifact {
  readonly kind: 'expandedDoc';
  readonly doc: NodeDocLike;
}

export type Artifact = MeshArtifact | BBoxArtifact | LuaDefinitionArtifact | CrossSectionArtifact | ExpandedDocArtifact;

/**
 * Async-uniform store. Consumers use this interface without knowing which tier
 * (memory / IndexedDB / remote) actually serves a request.
 */
export interface ObjectStore {
  get(key: CacheKey, kind: ArtifactKind): Promise<Artifact | undefined>;
  put(key: CacheKey, artifact: Artifact): Promise<void>;
  has(key: CacheKey, kind: ArtifactKind): Promise<boolean>;
  delete(key: CacheKey, kind: ArtifactKind): Promise<void>;
  /** Drop every entry. Pinned hashes and other store state are also cleared. */
  clear(): Promise<void>;
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
