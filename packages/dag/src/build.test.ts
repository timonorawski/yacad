import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildFromJson, buildGraph } from './build';
import { getNodeType, registerNodeType, unregisterNodeType, type KernelNodeType } from './registry';
import { DagError } from './types';

const box = (size = [10, 10, 10]) => ({ type: 'box', params: { size } });

describe('buildGraph', () => {
  it('builds a primitive and assigns a path-based id and 3D output type', async () => {
    const node = await buildGraph(box());
    expect(node.id).toBe('$');
    expect(node.type).toBe('box');
    expect(node.outputType).toBe('3d');
    expect(node.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('assigns child ids by path', async () => {
    const node = await buildGraph({
      type: 'difference',
      children: [box(), { type: 'sphere', params: { radius: 5 } }],
    });
    expect(node.children.map((c) => c.id)).toEqual(['$/0', '$/1']);
  });

  describe('semantic hashing', () => {
    it('is identical for semantically equal documents (param key order irrelevant)', async () => {
      const a = await buildGraph({ type: 'box', params: { size: [1, 2, 3], center: true } });
      const b = await buildGraph({ type: 'box', params: { center: true, size: [1, 2, 3] } });
      expect(a.hash).toBe(b.hash);
    });

    it('treats an omitted default as identical to the explicit default', async () => {
      // `center` defaults to false; specifying it explicitly must not change the hash.
      const implicit = await buildGraph({ type: 'box', params: { size: [1, 2, 3] } });
      const explicit = await buildGraph({
        type: 'box',
        params: { size: [1, 2, 3], center: false },
      });
      expect(implicit.hash).toBe(explicit.hash);
    });

    it('ignores unknown params (dropped during normalization)', async () => {
      const clean = await buildGraph({ type: 'sphere', params: { radius: 5 } });
      const noisy = await buildGraph({ type: 'sphere', params: { radius: 5, color: 'red' } });
      expect(clean.hash).toBe(noisy.hash);
    });

    it('changes when a parameter changes', async () => {
      const a = await buildGraph(box([10, 10, 10]));
      const b = await buildGraph(box([10, 10, 11]));
      expect(a.hash).not.toBe(b.hash);
    });

    it('only changes the affected node and its ancestors, not siblings', async () => {
      const make = (r: number) =>
        buildGraph({
          type: 'union',
          children: [box(), { type: 'sphere', params: { radius: r } }],
        });
      const base = await make(5);
      const edited = await make(6);

      // sibling (box) hash is stable; sphere + root change.
      expect(edited.children[0]!.hash).toBe(base.children[0]!.hash);
      expect(edited.children[1]!.hash).not.toBe(base.children[1]!.hash);
      expect(edited.hash).not.toBe(base.hash);
    });

    it('is order-sensitive for non-commutative operations', async () => {
      const ab = await buildGraph({
        type: 'difference',
        children: [box(), { type: 'sphere', params: { radius: 5 } }],
      });
      const ba = await buildGraph({
        type: 'difference',
        children: [{ type: 'sphere', params: { radius: 5 } }, box()],
      });
      expect(ab.hash).not.toBe(ba.hash);
    });
  });

  describe('validation', () => {
    it('rejects unknown node types', async () => {
      await expect(buildGraph({ type: 'torus' })).rejects.toBeInstanceOf(DagError);
    });

    it('enforces transform arity (translate needs exactly one child)', async () => {
      await expect(
        buildGraph({ type: 'translate', params: { offset: [1, 0, 0] } }),
      ).rejects.toThrow(DagError);
      await expect(
        buildGraph({ type: 'translate', params: { offset: [1, 0, 0] }, children: [box(), box()] }),
      ).rejects.toThrow(DagError);
    });

    it('rejects children on a primitive', async () => {
      await expect(
        buildGraph({ type: 'box', params: { size: [1, 1, 1] }, children: [box()] }),
      ).rejects.toThrow(DagError);
    });

    it('rejects invalid params', async () => {
      await expect(buildGraph({ type: 'sphere', params: { radius: -1 } })).rejects.toThrow(
        DagError,
      );
      await expect(buildGraph({ type: 'box', params: { size: [1, 1] } })).rejects.toThrow(DagError);
      await expect(
        buildGraph({ type: 'sphere', params: { radius: 5, segments: 2 } }),
      ).rejects.toThrow(DagError);
    });

    it('reports the path of the offending node', async () => {
      const err = await buildGraph({
        type: 'union',
        children: [box(), { type: 'sphere', params: { radius: 0 } }],
      }).catch((e: unknown) => e as DagError);
      expect(err).toBeInstanceOf(DagError);
      expect((err as DagError).path).toBe('$/1');
    });
  });

  it('rejects reserved __-prefixed node types in authored documents', async () => {
    await expect(buildGraph({ type: '__input_ref', params: { name: 'foo' } })).rejects.toThrow(
      /reserved/i,
    );
    await expect(buildGraph({ type: '__anything' })).rejects.toThrow(/reserved/i);
  });

  describe('buildFromJson', () => {
    it('parses and builds', async () => {
      const node = await buildFromJson('{"type":"box","params":{"size":[2,2,2]}}');
      expect(node.type).toBe('box');
    });

    it('throws DagError on malformed JSON', async () => {
      await expect(buildFromJson('{not json')).rejects.toThrow(DagError);
    });
  });
});

describe('circle node type', () => {
  it('builds with required radius', async () => {
    const node = await buildGraph({ type: 'circle', params: { radius: 5 } });
    expect(node.outputType).toBe('2d');
    expect(node.params['radius']).toBe(5);
  });

  it('defaults segments via the existing default (32)', async () => {
    const node = await buildGraph({ type: 'circle', params: { radius: 5 } });
    expect(node.params['segments']).toBe(32);
  });

  it('rejects negative radius', async () => {
    await expect(buildGraph({ type: 'circle', params: { radius: -1 } })).rejects.toThrow(
      /greater than 0/,
    );
  });

  it('rejects children', async () => {
    await expect(
      buildGraph({ type: 'circle', params: { radius: 5 }, children: [] as unknown as never[] }),
    ).resolves.toBeDefined(); // empty children array is fine
    await expect(
      buildGraph({
        type: 'circle',
        params: { radius: 5 },
        children: [{ type: 'box', params: { size: [1, 1, 1] } }],
      }),
    ).rejects.toThrow(/no children/);
  });
});

describe('rectangle node type', () => {
  it('builds with required size', async () => {
    const node = await buildGraph({ type: 'rectangle', params: { size: [10, 20] } });
    expect(node.outputType).toBe('2d');
    expect(node.params['size']).toEqual([10, 20]);
  });

  it('defaults center: false', async () => {
    const node = await buildGraph({ type: 'rectangle', params: { size: [1, 1] } });
    expect(node.params['center']).toBe(false);
  });

  it('rejects non-positive sizes', async () => {
    await expect(buildGraph({ type: 'rectangle', params: { size: [0, 5] } })).rejects.toThrow(
      /greater than 0/,
    );
  });
});

describe('polygon node type', () => {
  it('builds with required points', async () => {
    const node = await buildGraph({
      type: 'polygon',
      params: {
        points: [
          [0, 0],
          [10, 0],
          [5, 10],
        ],
      },
    });
    expect(node.outputType).toBe('2d');
  });

  it('rejects fewer than 3 points', async () => {
    await expect(
      buildGraph({
        type: 'polygon',
        params: {
          points: [
            [0, 0],
            [1, 0],
          ],
        },
      }),
    ).rejects.toThrow(/at least 3/);
  });

  it('rejects non-Vec2 entries', async () => {
    await expect(
      buildGraph({ type: 'polygon', params: { points: [[0, 0], 'not a point', [5, 5]] } }),
    ).rejects.toThrow(/2-element/);
  });
});

describe('spline node type', () => {
  it('builds with required points and defaults', async () => {
    const node = await buildGraph({
      type: 'spline',
      params: {
        points: [
          [0, 0],
          [10, 0],
          [5, 10],
        ],
      },
    });
    expect(node.outputType).toBe('2d');
    expect(node.params['segmentsPerCurve']).toBe(16);
    expect(node.params['tension']).toBe(0.5);
  });

  it('rejects fewer than 3 control points', async () => {
    await expect(
      buildGraph({
        type: 'spline',
        params: {
          points: [
            [0, 0],
            [1, 0],
          ],
        },
      }),
    ).rejects.toThrow(/at least 3/);
  });
});

describe('KernelNodeType.output per-instance resolver', () => {
  const SYN: KernelNodeType = {
    kind: 'kernel',
    type: 'syn_overloaded',
    // Output type taken from the first child — same pattern as the real
    // `union`/`difference`/`intersection`/`hull` in chunk 4.
    output: (children) => children[0]!.outputType,
    checkChildren(children, _path) {
      if (children.length < 1) {
        throw new Error('needs ≥1 child');
      }
    },
    normalizeParams: () => ({}),
  };

  beforeEach(() => registerNodeType(SYN));
  afterEach(() => unregisterNodeType('syn_overloaded'));

  it('resolves output from children at buildGraph time', async () => {
    const node = await buildGraph({
      type: 'syn_overloaded',
      children: [{ type: 'box', params: { size: [1, 1, 1] } }],
    });
    expect(node.outputType).toBe('3d');
  });

  it('uses static string output when output is not a function', () => {
    const def = getNodeType('box')!;
    expect(def.kind).toBe('kernel');
    if (def.kind === 'kernel') {
      expect(typeof def.output).toBe('string');
    }
  });
});
