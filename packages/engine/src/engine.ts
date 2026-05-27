import type { CacheKey, ObjectStore, Pinnable } from '@yacad/cache';
import {
  buildGraph,
  getNodeType,
  NOOP_RESOLVER,
  type DefinitionResolver,
  type ExpandableNodeType,
  type InputRef,
  type Node,
  type NodeDoc,
} from '@yacad/dag';
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
  /** End-to-end time for this node including recursive child evaluation. */
  readonly totalMs: number;
  /** Time spent in this node's own work (lookup + kernel + cache write). */
  readonly selfMs: number;
  /** Cache lookup latency for this node. */
  readonly lookupMs: number;
  /** Total kernel time for this node = import + op + export (0 on cache hits). */
  readonly kernelMs: number;
  /** Kernel phase: rebuilding child solids from cached meshes (0 on hits/leaves). */
  readonly importMs: number;
  /** Kernel phase: the Manifold operation itself (0 on cache hits). */
  readonly opMs: number;
  /** Kernel phase: extracting the result mesh from WASM (0 on cache hits). */
  readonly exportMs: number;
  /** Cache write latency for this node (0 on cache hits). */
  readonly storeMs: number;
}

export interface EvalStats {
  readonly nodes: number;
  readonly hits: number;
  readonly misses: number;
  readonly totalMs: number;
  readonly lookupMs: number;
  readonly kernelMs: number;
  readonly importMs: number;
  readonly opMs: number;
  readonly exportMs: number;
  readonly storeMs: number;
  readonly selfMs: number;
}

export interface EvaluateResult {
  readonly mesh: Mesh;
  readonly hash: Hash;
  readonly stats: EvalStats;
  readonly perNode: readonly NodeEval[];
}

/** Options accepted by the Engine constructor. */
export interface EngineOptions {
  /** Resolver for expandable node definitions (e.g., LuaDefinition lookup). */
  resolver?: DefinitionResolver;
  /** Engine version stamped into cache keys' `produced_by.engineVersion`. */
  engineVersion?: string;
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
 *
 * Expandable nodes (e.g., LuaNode) are handled by calling `def.expand()`,
 * resolving `__input_ref` sentinels by name, then recursively walking the
 * emitted sub-DAG. The outer node's cache entry covers the full subtree so a
 * warm cache skips `expand()` entirely.
 */
export class Engine {
  private readonly resolver: DefinitionResolver;
  private readonly engineVersion: string;

  constructor(
    private readonly store: ObjectStore,
    private readonly kernel: Kernel,
    options: EngineOptions = {},
  ) {
    this.resolver = options.resolver ?? NOOP_RESOLVER;
    this.engineVersion = options.engineVersion ?? ENGINE_VERSION;
  }

  async evaluate(root: Node, qualityTier = 'final'): Promise<EvaluateResult> {
    const evalStart = performance.now();
    this.pinWorkingSet(root);
    const perNode: NodeEval[] = [];
    const mesh = await this.walk(root, qualityTier, perNode);

    const sum = (pick: (e: NodeEval) => number) => perNode.reduce((n, e) => n + pick(e), 0);
    const hits = perNode.reduce((n, e) => n + (e.hit ? 1 : 0), 0);
    return {
      mesh,
      hash: root.hash,
      stats: {
        nodes: perNode.length,
        hits,
        misses: perNode.length - hits,
        totalMs: performance.now() - evalStart,
        lookupMs: sum((e) => e.lookupMs),
        kernelMs: sum((e) => e.kernelMs),
        importMs: sum((e) => e.importMs),
        opMs: sum((e) => e.opMs),
        exportMs: sum((e) => e.exportMs),
        storeMs: sum((e) => e.storeMs),
        selfMs: sum((e) => e.selfMs),
      },
      perNode,
    };
  }

  private async walk(node: Node, tier: string, perNode: NodeEval[]): Promise<Mesh> {
    const nodeStart = performance.now();
    const key = this.keyFor(node, tier);

    // --- Outer cache lookup (covers both kernel and expandable nodes) ---
    const lookupStart = performance.now();
    const cached = await this.store.get(key, 'mesh');
    const lookupMs = performance.now() - lookupStart;
    if (cached?.kind === 'mesh') {
      const totalMs = performance.now() - nodeStart;
      perNode.push({
        id: node.id,
        hash: node.hash,
        hit: true,
        totalMs,
        selfMs: totalMs,
        lookupMs,
        kernelMs: 0,
        importMs: 0,
        opMs: 0,
        exportMs: 0,
        storeMs: 0,
      });
      return cached.mesh;
    }

    // --- Discriminate on node kind ---
    const def = getNodeType(node.type);
    let mesh: Mesh;
    let kernelMs: number;
    let importMs: number;
    let opMs: number;
    let exportMs: number;

    if (!def || def.kind === 'kernel') {
      // --- Kernel branch: evaluate children then call the geometry kernel ---
      const childMeshes: Mesh[] = [];
      for (const child of node.children) {
        childMeshes.push(await this.walk(child, tier, perNode));
      }
      // Use evaluateTimed to preserve per-phase timings (constraint #1).
      const { mesh: kernelMesh, timings } = this.kernel.evaluateTimed(node, childMeshes);
      mesh = kernelMesh;
      kernelMs = timings.importMs + timings.opMs + timings.exportMs;
      importMs = timings.importMs;
      opMs = timings.opMs;
      exportMs = timings.exportMs;
    } else {
      // --- Expandable branch: expand sub-DAG, resolve __input_ref sentinels, recurse ---
      const expandableDef = def as ExpandableNodeType;
      const inputNames = expandableDef.inputNames(node.params as Record<string, unknown>, this.resolver);
      // Only create InputRefs for children that actually exist — the declared
      // names list may be longer than the actual child list for optional inputs.
      const inputs: InputRef[] = node.children.map((child, i) => ({
        name: inputNames[i] ?? String(i),
        type: child.outputType,
        outputType: () => child.outputType,
      }));

      const expandStart = performance.now();
      const subDoc = await expandableDef.expand(node.params as Record<string, unknown>, inputs);
      const resolved = resolveInputRefs(subDoc, node.children, inputNames);
      const subRoot = await buildGraph(resolved, undefined, undefined, this.resolver);
      const expandMs = performance.now() - expandStart;

      // Walk the sub-DAG into a PRIVATE perNode — sub-DAG nodes are implementation
      // details and must not pollute the caller's perNode array (their IDs start at
      // '$' and would collide with user-graph IDs, inflating stats.nodes).
      const innerPerNode: NodeEval[] = [];
      mesh = await this.walk(subRoot, tier, innerPerNode);

      // Aggregate inner timings into this node's accounting so the outer NodeEval
      // faithfully represents the total cost of the expandable node.
      const sumInner = (pick: (e: NodeEval) => number) =>
        innerPerNode.reduce((n, e) => n + pick(e), 0);
      kernelMs = expandMs + sumInner((e) => e.kernelMs);
      importMs = sumInner((e) => e.importMs);
      opMs = sumInner((e) => e.opMs);
      exportMs = sumInner((e) => e.exportMs);
    }

    const storeStart = performance.now();
    await this.store.put(key, { kind: 'mesh', mesh });
    const storeMs = performance.now() - storeStart;

    const totalMs = performance.now() - nodeStart;
    perNode.push({
      id: node.id,
      hash: node.hash,
      hit: false,
      totalMs,
      selfMs: lookupMs + kernelMs + storeMs,
      lookupMs,
      kernelMs,
      importMs,
      opMs,
      exportMs,
      storeMs,
    });
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

/**
 * Replace `__input_ref` sentinels in an emitted sub-DAG with the corresponding
 * child NodeDoc, matched by name (not by index).
 *
 * The `inputNames` array is the ordered list of declared input names returned by
 * `ExpandableNodeType.inputNames()`. A sentinel node of the form
 * `{ type: '__input_ref', params: { name: 'foo' } }` is replaced by the NodeDoc
 * representation of the child whose position corresponds to the first occurrence
 * of `'foo'` in `inputNames`.
 */
function resolveInputRefs(doc: NodeDoc, children: readonly Node[], inputNames: readonly string[]): NodeDoc {
  return walkDoc(doc, children, inputNames);
}

function walkDoc(doc: unknown, children: readonly Node[], inputNames: readonly string[]): NodeDoc {
  if (typeof doc !== 'object' || doc === null) {
    throw new Error('expanded sub-DAG must be a NodeDoc object');
  }
  const d = doc as Record<string, unknown>;
  if (d['type'] === '__input_ref') {
    const params = (d['params'] ?? {}) as Record<string, unknown>;
    const name = String(params['name'] ?? '');
    // Resolve by name: find the child whose declared input name matches.
    const idx = inputNames.indexOf(name);
    if (idx < 0) {
      throw new Error(`__input_ref "${name}" did not match any declared input name`);
    }
    const child = children[idx];
    if (!child) {
      throw new Error(`__input_ref "${name}" resolved to index ${idx} but no child exists at that position`);
    }
    return nodeDocFromNode(child);
  }
  const kids = Array.isArray(d['children']) ? (d['children'] as unknown[]) : [];
  return {
    type: d['type'] as string,
    params: (d['params'] ?? {}) as Record<string, unknown>,
    children: kids.map((c) => walkDoc(c, children, inputNames)),
  };
}

function nodeDocFromNode(node: Node): NodeDoc {
  return {
    type: node.type,
    params: node.params as Record<string, unknown>,
    children: node.children.map(nodeDocFromNode),
  };
}
