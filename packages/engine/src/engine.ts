import type { CacheKey, ObjectStore, Pinnable } from '@yacad/cache';
import type { Node } from '@yacad/dag';
import type { Mesh } from '@yacad/geometry';
import type { Hash } from '@yacad/hash';
import type { Kernel } from '@yacad/kernel-manifold';

/** Engine version recorded in cache keys' `produced_by`. */
export const ENGINE_VERSION = '0.0.0';

/** Per-node evaluation outcome — lets the UI see exactly what recomputed. */
export interface NodeEval {
  readonly id: string;
  readonly hash: Hash;
  readonly hit: boolean;
}

export interface EvalStats {
  readonly nodes: number;
  readonly hits: number;
  readonly misses: number;
}

export interface EvaluateResult {
  readonly mesh: Mesh;
  readonly hash: Hash;
  readonly stats: EvalStats;
  readonly perNode: readonly NodeEval[];
}

function asPinnable(store: ObjectStore): Pinnable | undefined {
  const maybe = store as ObjectStore & Partial<Pinnable>;
  return typeof maybe.pin === 'function' ? (maybe as unknown as Pinnable) : undefined;
}

/**
 * Lazy, memoized DAG evaluator (vision §Evaluation Engine). Walking a node:
 * compute its cache key from its semantic hash + current context, look it up,
 * return on hit, otherwise evaluate children and run the kernel, then cache.
 *
 * Because the Merkle hash only changes for an edited node and its ancestors,
 * unchanged subtrees hit the cache and never reach the kernel — this is the
 * incremental-recompute property the POC exists to validate.
 */
export class Engine {
  constructor(
    private readonly store: ObjectStore,
    private readonly kernel: Kernel,
    private readonly engineVersion: string = ENGINE_VERSION,
  ) {}

  async evaluate(root: Node, qualityTier = 'final'): Promise<EvaluateResult> {
    this.pinWorkingSet(root);
    const perNode: NodeEval[] = [];
    const mesh = await this.walk(root, qualityTier, perNode);
    const hits = perNode.reduce((n, e) => n + (e.hit ? 1 : 0), 0);
    return {
      mesh,
      hash: root.hash,
      stats: { nodes: perNode.length, hits, misses: perNode.length - hits },
      perNode,
    };
  }

  private async walk(node: Node, tier: string, perNode: NodeEval[]): Promise<Mesh> {
    const key = this.keyFor(node, tier);

    const cached = await this.store.get(key, 'mesh');
    if (cached?.kind === 'mesh') {
      perNode.push({ id: node.id, hash: node.hash, hit: true });
      return cached.mesh;
    }

    const childMeshes: Mesh[] = [];
    for (const child of node.children) {
      childMeshes.push(await this.walk(child, tier, perNode));
    }

    const mesh = this.kernel.evaluate(node, childMeshes);
    await this.store.put(key, { kind: 'mesh', mesh });
    perNode.push({ id: node.id, hash: node.hash, hit: false });
    return mesh;
  }

  private keyFor(node: Node, qualityTier: string): CacheKey {
    return {
      semanticHash: node.hash,
      producedBy: {
        kernel: this.kernel.name,
        kernelVersion: this.kernel.version,
        engineVersion: this.engineVersion,
        qualityTier,
      },
    };
  }

  /** Protect every hash in the active model from L1 eviction during editing. */
  private pinWorkingSet(root: Node): void {
    const pinnable = asPinnable(this.store);
    if (!pinnable) return;
    const hashes = new Set<Hash>();
    const visit = (n: Node): void => {
      hashes.add(n.hash);
      n.children.forEach(visit);
    };
    visit(root);
    pinnable.pin(hashes);
  }
}
