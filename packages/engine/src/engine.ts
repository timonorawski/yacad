import type { ArtifactKind, CacheKey, ObjectStore, Pinnable } from '@yacad/cache';
import {
  buildGraph,
  getNodeType,
  NOOP_RESOLVER,
  type DefinitionResolver,
  type ExpandableNodeType,
  type GeometryType,
  type InputRef,
  type Node,
  type NodeDoc,
} from '@yacad/dag';
import type { Geometry } from '@yacad/geometry';
import type { Hash } from '@yacad/hash';
import type { Kernel } from '@yacad/kernel-manifold';

function artifactKindFor(geometryType: GeometryType): ArtifactKind {
  return geometryType === '2d' ? 'crossSection' : 'mesh';
}

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
  /** Populated when this node's expandable expansion threw. */
  readonly error?: { phase: 'expand' | 'kernel'; message: string; cause?: string };
}

export interface EvalStats {
  readonly nodes: number;
  readonly hits: number;
  readonly misses: number;
  /** Count of nodes whose evaluation threw (NodeEval.error is set). */
  readonly errors: number;
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
  readonly geometry: Geometry;
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

/**
 * Thrown by `Engine.evaluate()` when the root node (or any ancestor) could not
 * produce a mesh. Carries the root node's id/hash so callers can surface the
 * location. Per-node entries in `perNode` carry granular error details.
 *
 * Only thrown at the `evaluate()` boundary — never inside `walk()`, to avoid
 * double-wrapping nested expandable failures (constraint 6).
 */
export class EvaluationError extends Error {
  override readonly name = 'EvaluationError';
  readonly nodeId: string;
  readonly nodeHash: string;
  constructor(message: string, nodeId: string, nodeHash: string, options?: { cause?: unknown }) {
    super(message, options as ErrorOptions | undefined);
    this.nodeId = nodeId;
    this.nodeHash = nodeHash;
  }
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
    let geometry: Geometry;
    try {
      geometry = await this.walk(root, qualityTier, perNode);
    } catch (err) {
      // Wrap at the evaluate() boundary only (constraint 6): the caller sees
      // EvaluationError; nested expandable failures inside walk() just rethrow
      // the original error to avoid double-wrapping.
      throw new EvaluationError(
        `evaluation failed at root "${root.id}": ${err instanceof Error ? err.message : String(err)}`,
        root.id,
        root.hash,
        { cause: err },
      );
    }

    const sum = (pick: (e: NodeEval) => number) => perNode.reduce((n, e) => n + pick(e), 0);
    const hits = perNode.reduce((n, e) => n + (e.hit ? 1 : 0), 0);
    return {
      geometry,
      hash: root.hash,
      stats: {
        nodes: perNode.length,
        hits,
        misses: perNode.length - hits,
        errors: perNode.reduce((n, e) => n + (e.error ? 1 : 0), 0),
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

  private async walk(node: Node, tier: string, perNode: NodeEval[]): Promise<Geometry> {
    const nodeStart = performance.now();
    const key = this.keyFor(node, tier);

    // --- Outer cache lookup (covers both kernel and expandable nodes) ---
    const kindForThisNode = artifactKindFor(node.outputType);
    const lookupStart = performance.now();
    const cached = await this.store.get(key, kindForThisNode);
    const lookupMs = performance.now() - lookupStart;
    if (cached) {
      let cachedGeometry: Geometry;
      if (cached.kind === 'mesh') {
        cachedGeometry = { kind: '3d', mesh: cached.mesh };
      } else if (cached.kind === 'crossSection') {
        cachedGeometry = { kind: '2d', section: cached.section };
      } else {
        throw new Error(`unexpected artifact kind ${cached.kind} for node ${node.id}`);
      }
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
      return cachedGeometry;
    }

    // --- Discriminate on node kind ---
    const def = getNodeType(node.type);
    let geometry: Geometry;
    let kernelMs: number;
    let importMs: number;
    let opMs: number;
    let exportMs: number;

    if (!def || def.kind === 'kernel') {
      // --- Kernel branch: evaluate children then call the geometry kernel ---
      const childGeometries: Geometry[] = [];
      for (const child of node.children) {
        childGeometries.push(await this.walk(child, tier, perNode));
      }
      // Use evaluateTimed to preserve per-phase timings (constraint #1).
      const { geometry: kernelGeometry, timings } = this.kernel.evaluateTimed(
        node,
        childGeometries,
      );
      geometry = kernelGeometry;
      kernelMs = timings.importMs + timings.opMs + timings.exportMs;
      importMs = timings.importMs;
      opMs = timings.opMs;
      exportMs = timings.exportMs;
    } else if (def.kind === 'decoder') {
      // --- Decoder branch: blob-leaf node. No children walked; the decoder
      // fetches its blob via the resolver and returns a Mesh directly. ---
      const decodeStart = performance.now();
      const decodedMesh = await def.decode(node.params as Record<string, unknown>, this.resolver);
      const decodeMs = performance.now() - decodeStart;
      geometry = { kind: '3d', mesh: decodedMesh };
      kernelMs = decodeMs;
      importMs = 0;
      opMs = decodeMs;
      exportMs = 0;
    } else {
      // --- Expandable branch: expand sub-DAG, resolve __input_ref sentinels, recurse ---
      const expandableDef = def as ExpandableNodeType;
      const inputNames = expandableDef.inputNames(
        node.params as Record<string, unknown>,
        this.resolver,
      );
      // Only create InputRefs for children that actually exist — the declared
      // names list may be longer than the actual child list for optional inputs.
      const inputs: InputRef[] = node.children.map((child, i) => ({
        name: inputNames[i] ?? String(i),
        type: child.outputType,
        outputType: () => child.outputType,
      }));

      let expandErr: Error | undefined;
      try {
        const expandStart = performance.now();
        const subDoc = await expandableDef.expand(node.params as Record<string, unknown>, inputs);
        const resolved = resolveInputRefs(subDoc, node.children, inputNames);
        const subRoot = await buildGraph(resolved, undefined, undefined, this.resolver);
        const expandMs = performance.now() - expandStart;

        // Walk the sub-DAG into a PRIVATE perNode — sub-DAG nodes are implementation
        // details and must not pollute the caller's perNode array (their IDs start at
        // '$' and would collide with user-graph IDs, inflating stats.nodes).
        const innerPerNode: NodeEval[] = [];
        geometry = await this.walk(subRoot, tier, innerPerNode);

        // Aggregate inner timings into this node's accounting so the outer NodeEval
        // faithfully represents the total cost of the expandable node.
        const sumInner = (pick: (e: NodeEval) => number) =>
          innerPerNode.reduce((n, e) => n + pick(e), 0);
        kernelMs = expandMs + sumInner((e) => e.kernelMs);
        importMs = sumInner((e) => e.importMs);
        opMs = sumInner((e) => e.opMs);
        exportMs = sumInner((e) => e.exportMs);
      } catch (err) {
        // Record failure on this node's NodeEval entry, then rethrow the ORIGINAL
        // error (not EvaluationError) so the parent can propagate it. Wrapping as
        // EvaluationError happens only at the evaluate() boundary (constraint 6).
        expandErr = err instanceof Error ? err : new Error(String(err));
        const causeMsg = expandErr.cause instanceof Error ? expandErr.cause.message : undefined;
        perNode.push({
          id: node.id,
          hash: node.hash,
          hit: false,
          totalMs: performance.now() - nodeStart,
          selfMs: lookupMs,
          lookupMs,
          kernelMs: 0,
          importMs: 0,
          opMs: 0,
          exportMs: 0,
          storeMs: 0,
          error: {
            phase: 'expand',
            message: expandErr.message,
            ...(causeMsg !== undefined ? { cause: causeMsg } : {}),
          },
        });
        throw expandErr;
      }
    }

    const storeStart = performance.now();
    if (geometry.kind === '3d') {
      await this.store.put(key, { kind: 'mesh', mesh: geometry.mesh });
    } else {
      await this.store.put(key, { kind: 'crossSection', section: geometry.section });
    }
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
    return geometry;
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
function resolveInputRefs(
  doc: NodeDoc,
  children: readonly Node[],
  inputNames: readonly string[],
): NodeDoc {
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
      throw new Error(
        `__input_ref "${name}" resolved to index ${idx} but no child exists at that position`,
      );
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
