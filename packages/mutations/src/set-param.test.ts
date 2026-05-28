import { describe, expect, it } from 'vitest';
import type { NodeDoc } from '@yacad/dag';
import { setParam, setParams } from './set-param';

const tree: NodeDoc = {
  type: 'difference',
  children: [
    { type: 'box', params: { size: [30, 30, 30], center: true } },
    { type: 'sphere', params: { radius: 19, segments: 48 } },
  ],
};

describe('setParam', () => {
  it('returns a new tree with the specified param updated', () => {
    const next = setParam(tree, '$/1', 'radius', 25);
    expect((next.children![1] as NodeDoc).params).toMatchObject({ radius: 25, segments: 48 });
  });

  it('does not mutate the original tree', () => {
    setParam(tree, '$/1', 'radius', 25);
    expect((tree.children![1] as NodeDoc).params).toMatchObject({ radius: 19 });
  });

  it('updates a root-level param when path is `$`', () => {
    const next = setParam({ type: 'box', params: { size: [1, 1, 1] } }, '$', 'size', [2, 2, 2]);
    expect(next.params).toMatchObject({ size: [2, 2, 2] });
  });

  it('adds a new param key if missing', () => {
    const next = setParam(tree, '$/0', 'newKey', 'newValue');
    expect((next.children![0] as NodeDoc).params).toMatchObject({ newKey: 'newValue' });
  });

  it('throws when the path is invalid', () => {
    expect(() => setParam(tree, '$/9', 'x', 1)).toThrow();
  });
});

describe('setParams', () => {
  it('applies multiple updates in a single call', () => {
    const next = setParams(tree, '$/1', { radius: 25, segments: 16 });
    expect((next.children![1] as NodeDoc).params).toEqual({ radius: 25, segments: 16 });
  });

  it('deletes a key when its patch value is undefined', () => {
    const seeded: NodeDoc = { type: 'refine', children: [], params: { n: 2 } };
    const next = setParams(seeded, '$', { n: undefined, maxEdgeLength: 0.5 });
    expect(next.params).toEqual({ maxEdgeLength: 0.5 });
  });

  it('preserves unmentioned keys', () => {
    const seeded: NodeDoc = { type: 'sphere', params: { radius: 5, segments: 32 } };
    const next = setParams(seeded, '$', { radius: 7 });
    expect(next.params).toEqual({ radius: 7, segments: 32 });
  });

  it('does not mutate the original tree', () => {
    setParams(tree, '$/0', { center: false });
    expect((tree.children![0] as NodeDoc).params).toMatchObject({ center: true });
  });
});
