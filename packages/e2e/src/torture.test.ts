import { beforeAll, describe, expect, it } from 'vitest';
import { MemoryStore } from '@yacad/cache';
import { buildGraph, type NodeDoc } from '@yacad/dag';
import { Engine } from '@yacad/engine';
import { computeBBox, triangleCount } from '@yacad/geometry';
import type { ManifoldKernel } from '@yacad/kernel-manifold';
import { isWatertight, nonManifoldEdges } from './mesh-check';
import { getKernel, loadScenes, runScene } from './pipeline';

let kernel: ManifoldKernel;

beforeAll(async () => {
  kernel = await getKernel();
});

const freshEngine = () => new Engine(new MemoryStore(), kernel);
const evaluate = async (engine: Engine, doc: NodeDoc) => engine.evaluate(await buildGraph(doc));

function sceneDoc(name: string): unknown {
  const scene = loadScenes().find((s) => s.name === name);
  if (!scene) throw new Error(`scene not found: ${name}`);
  return scene.doc;
}

// ─── Cache thrash: a leaf that is an ancestor to everything via a long chain ──

/** `depth` nested translates wrapping a sphere leaf. The outermost translate's
 * offset is `rootOffset`; all inner translates use 1. */
function transformChain(depth: number, radius: number, rootOffset = 1): NodeDoc {
  let node: NodeDoc = { type: 'sphere', params: { radius, segments: 16 } };
  for (let i = 0; i < depth; i++) {
    node = {
      type: 'translate',
      params: { offset: [i === depth - 1 ? rootOffset : 1, 0, 0] },
      children: [node],
    };
  }
  return node;
}

describe('cache thrash: deep transform chain', () => {
  const DEPTH = 40;

  it('editing the leaf recomputes the whole chain — linear in depth, not pathological', async () => {
    const engine = freshEngine();
    await evaluate(engine, transformChain(DEPTH, 5));
    const edited = await evaluate(engine, transformChain(DEPTH, 6));
    // The leaf underlies every ancestor, so all hashes change and the entire
    // chain recomputes. The point: cost is exactly depth+1 — bounded/predictable.
    expect(edited.stats.nodes).toBe(DEPTH + 1);
    expect(edited.stats.misses).toBe(DEPTH + 1);
    expect(edited.stats.hits).toBe(0);
  });

  it('editing the outermost transform recomputes only the root', async () => {
    const engine = freshEngine();
    await evaluate(engine, transformChain(DEPTH, 5, 1));
    const edited = await evaluate(engine, transformChain(DEPTH, 5, 2));
    // Only the root's params changed; its entire child subtree is cached and the
    // walk short-circuits at the first hit.
    expect(edited.stats.misses).toBe(1);
    expect(edited.stats.hits).toBe(1);
    expect(edited.stats.nodes).toBe(2);
  });
});

// ─── Hash collision near-misses: exercise the canonical serializer ────────────

describe('canonical torture: hash near-misses', () => {
  it('keeps 50 subtly-different radii distinct (no phantom cache hits)', async () => {
    const n = 50;
    const children: NodeDoc[] = [];
    for (let i = 0; i < n; i++) {
      children.push({ type: 'sphere', params: { radius: 1 + i * 1e-6, segments: 8 } });
    }
    const root = await buildGraph({ type: 'union', children });
    expect(new Set(root.children.map((c) => c.hash)).size).toBe(n);
  });

  it('collapses semantically identical numeric forms (1.0 === 1)', async () => {
    const a = await buildGraph({ type: 'sphere', params: { radius: 1.0, segments: 8 } });
    const b = await buildGraph({ type: 'sphere', params: { radius: 1, segments: 8 } });
    expect(a.hash).toBe(b.hash);
  });

  it('is invariant to parameter key order', async () => {
    const a = await buildGraph({ type: 'box', params: { size: [1, 2, 3], center: true } });
    const b = await buildGraph({ type: 'box', params: { center: true, size: [1, 2, 3] } });
    expect(a.hash).toBe(b.hash);
  });

  it('dedupes exactly-identical subtrees but never near-misses', async () => {
    const engine = freshEngine();
    const r = await evaluate(engine, {
      type: 'union',
      children: [
        { type: 'sphere', params: { radius: 5, segments: 16 } },
        { type: 'sphere', params: { radius: 5, segments: 16 } }, // exact dup → cache hit
        { type: 'sphere', params: { radius: 5.0000001, segments: 16 } }, // near-miss → distinct
      ],
    });
    expect(r.stats.hits).toBe(1); // only the duplicate sphere
    expect(r.stats.misses).toBe(3); // union + sphere(5) + sphere(5.0000001)
  });
});

// ─── Boolean-of-booleans depth ────────────────────────────────────────────────

/** union( difference(<inner>, sphere), translate(box) ) nested `levels` deep. */
function boolTree(levels: number, baseSize = 10): NodeDoc {
  if (levels === 0) {
    return { type: 'box', params: { size: [baseSize, baseSize, baseSize], center: true } };
  }
  return {
    type: 'union',
    children: [
      {
        type: 'difference',
        children: [
          boolTree(levels - 1, baseSize),
          { type: 'sphere', params: { radius: 4, segments: 16 } },
        ],
      },
      {
        type: 'translate',
        params: { offset: [6 * levels, 0, 0] },
        children: [{ type: 'box', params: { size: [6, 6, 6], center: true } }],
      },
    ],
  };
}

describe('boolean-of-booleans depth', () => {
  const LEVELS = 5;

  it('evaluates a 5-level union/difference nest to a watertight solid', async () => {
    const run = await runScene(boolTree(LEVELS));
    expect(triangleCount(run.mesh)).toBeGreaterThan(0);
    expect(isWatertight(run.mesh)).toBe(true);
  });

  it('editing the deepest primitive recomputes only the boolean spine', async () => {
    const engine = freshEngine();
    await evaluate(engine, boolTree(LEVELS, 10));
    const edited = await evaluate(engine, boolTree(LEVELS, 11));
    // Spine = base box + one difference + one union per level (2·levels + 1).
    expect(edited.stats.misses).toBe(2 * LEVELS + 1);
    // Off-spine operands (spheres, translated boxes) at every level stay cached,
    // proving intermediate boolean results are reused.
    expect(edited.stats.hits).toBeGreaterThan(0);
    expect(isWatertight(edited.mesh)).toBe(true);
  });
});

// ─── Wide n-ary boolean ───────────────────────────────────────────────────────

/** A union of `n` boxes marching along +X (overlapping, so the union is solid). */
function wideUnion(n: number): NodeDoc {
  const children: NodeDoc[] = [];
  for (let i = 0; i < n; i++) {
    children.push({
      type: 'translate',
      params: { offset: [i * 5, 0, 0] },
      children: [{ type: 'box', params: { size: [8, 8, 8], center: true } }],
    });
  }
  return { type: 'union', children };
}

describe('wide n-ary union (50 children)', () => {
  it('unions 50 overlapping boxes into a watertight solid', async () => {
    const run = await runScene(wideUnion(50));
    expect(isWatertight(run.mesh)).toBe(true);
  });

  it('adding one child reuses the existing 50 — only the n-ary union op recomputes', async () => {
    const engine = freshEngine();
    await evaluate(engine, wideUnion(50));
    const grown = await evaluate(engine, wideUnion(51));
    // The 50 prior child subtrees are cache hits. The union node's hash changes
    // (new child set), so the n-ary boolean itself re-runs over all 51 operands:
    // the cache saves child geometry, not the union op. This documents that an
    // n-ary boolean is a single node with no internal binary-tree caching.
    expect(grown.stats.hits).toBeGreaterThanOrEqual(50);
    expect(grown.stats.misses).toBeLessThanOrEqual(3);
  });
});

// ─── High-mesh-count primitives (kernel-bound regime) ─────────────────────────

describe('high-mesh-count primitives', () => {
  it('boolean on a 512-segment sphere (~130k triangles) stays correct and watertight', async () => {
    const run = await runScene({
      type: 'difference',
      children: [
        { type: 'sphere', params: { radius: 20, segments: 512 } },
        { type: 'box', params: { size: [20, 20, 40], center: true } },
      ],
    });
    expect(triangleCount(run.mesh)).toBeGreaterThan(50_000);
    expect(isWatertight(run.mesh)).toBe(true);
  });
});

// ─── Procedural tree (real-world stress) ─────────────────────────────────────

/** Deterministic PRNG for reproducible wobble. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface TreeOpts {
  depth: number;
  splits: number;
  length: number;
  radius: number;
  lengthTaper: number;
  radiusTaper: number;
  branchAngle: number;
  phyllotaxis: number;
  leafScale: number;
  segments: number;
  wobble: number;
  seed: number;
}

/**
 * Recursive branching tree: each branch is a +Z cylinder with `splits`
 * sub-branches at its tip, rotated outward by `branchAngle` and spun around the
 * parent axis in golden-angle increments. Sphere "leaves" at depth 0.
 *
 * `wobble: 0` → every sub-branch at a given depth is structurally identical, so
 * content-addressing collapses hundreds of references to a few dozen unique
 * kernel calls. `wobble > 0` perturbs each branch deterministically from the
 * seed, breaking dedup completely.
 */
function procTree(opts: TreeOpts): NodeDoc {
  const prng = mulberry32(opts.seed);
  const jitter = (range: number) => (opts.wobble ? (prng() * 2 - 1) * range : 0);

  function build(length: number, radius: number, depth: number, segs: number): NodeDoc {
    const trunk: NodeDoc = {
      type: 'cylinder',
      params: { height: length, radius, segments: segs, center: false },
    };
    if (depth === 0) {
      const leaf: NodeDoc = {
        type: 'translate',
        params: { offset: [0, 0, length] },
        children: [{ type: 'sphere', params: { radius: length * opts.leafScale, segments: segs } }],
      };
      return { type: 'union', children: [trunk, leaf] };
    }
    const subLen = length * opts.lengthTaper;
    const subRad = radius * opts.radiusTaper;
    const subSeg = Math.max(6, Math.round(segs * 0.8));

    const children: NodeDoc[] = [trunk];
    for (let i = 0; i < opts.splits; i++) {
      const phi = i * opts.phyllotaxis + jitter(opts.wobble * 6);
      const ba = opts.branchAngle + jitter(opts.wobble);
      const sub = build(subLen, subRad, depth - 1, subSeg);
      children.push({
        type: 'translate',
        params: { offset: [0, 0, length] },
        children: [{ type: 'rotate', params: { angles: [0, ba, phi] }, children: [sub] }],
      });
    }
    return { type: 'union', children };
  }

  return build(opts.length, opts.radius, opts.depth, opts.segments);
}

const treeBase: TreeOpts = {
  depth: 3,
  splits: 3,
  length: 12,
  radius: 0.9,
  lengthTaper: 0.72,
  radiusTaper: 0.62,
  branchAngle: 34,
  phyllotaxis: 137.5,
  leafScale: 0.55,
  segments: 8,
  wobble: 0,
  seed: 1,
};

describe('procedural tree (real-world stress)', () => {
  it('symmetric tree: dedup compresses the walk — hundreds of branch references collapse into ~30 unique kernel calls', async () => {
    const run = await evaluate(freshEngine(), procTree({ ...treeBase, wobble: 0 }));
    // The compression of the visit count is the headline; hit/miss ratio is not,
    // because each unique hash is computed once and only its sibling references
    // produce hits.
    expect(run.stats.nodes).toBeLessThan(50);
    expect(run.stats.misses).toBeLessThan(40);
    expect(isWatertight(run.mesh)).toBe(true);
  });

  it('real-world tree: wobble breaks dedup so the walk expands several-fold', async () => {
    const symmetric = await evaluate(freshEngine(), procTree({ ...treeBase, wobble: 0 }));
    const wobbly = await evaluate(freshEngine(), procTree({ ...treeBase, wobble: 1, seed: 42 }));
    expect(wobbly.stats.nodes).toBeGreaterThan(symmetric.stats.nodes * 3);
    expect(wobbly.stats.misses).toBeGreaterThan(symmetric.stats.misses * 3);
    expect(isWatertight(wobbly.mesh)).toBe(true);
  });
});

// ─── Geometric edge cases (correctness over performance) ──────────────────────

describe('geometric edge cases', () => {
  it('seeds three edge-case scenes', () => {
    expect(loadScenes().filter((s) => s.name.startsWith('edge-cases/')).length).toBe(3);
  });

  it('shared-face cubes union → watertight box spanning both', async () => {
    const run = await runScene(sceneDoc('edge-cases/shared-face-cubes'));
    expect(isWatertight(run.mesh)).toBe(true);
    expect(computeBBox(run.mesh)).toEqual({ min: [-5, -5, -5], max: [15, 5, 5] });
  });

  it('difference with an operand fully inside → watertight solid with an inner void', async () => {
    const run = await runScene(sceneDoc('edge-cases/interior-void'));
    expect(isWatertight(run.mesh)).toBe(true);
    // The void leaves the outer bbox unchanged but adds an inner shell.
    expect(computeBBox(run.mesh)).toEqual({ min: [-10, -10, -10], max: [10, 10, 10] });
    expect(triangleCount(run.mesh)).toBeGreaterThan(12);
  });

  it('point-tangent sphere/box: produces output; capture manifold-edge behavior', async () => {
    const run = await runScene(sceneDoc('edge-cases/tangent-sphere-box'));
    expect(triangleCount(run.mesh)).toBeGreaterThan(0);
    // Point contact is genuinely degenerate; capture the behavior in a snapshot
    // rather than hard-asserting watertightness, so any change is visible.
    expect({
      triangles: triangleCount(run.mesh),
      nonManifoldEdges: nonManifoldEdges(run.mesh),
    }).toMatchSnapshot();
  });
});
