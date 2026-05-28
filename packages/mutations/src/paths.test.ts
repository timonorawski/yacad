import { describe, expect, it } from 'vitest';
import type { NodeDoc } from '@yacad/dag';
import { getAt, parsePath, replaceWithin } from './paths';

const tree: NodeDoc = {
  type: 'union',
  children: [
    { type: 'box', params: { size: [10, 10, 10] } },
    {
      type: 'translate',
      params: { offset: [5, 0, 0] },
      children: [{ type: 'sphere', params: { radius: 3 } }],
    },
  ],
};

describe('paths', () => {
  it('parsePath splits `$` into []', () => {
    expect(parsePath('$')).toEqual([]);
  });

  it('parsePath splits `$/0/1` into [0, 1]', () => {
    expect(parsePath('$/0/1')).toEqual([0, 1]);
  });

  it('parsePath rejects malformed paths', () => {
    expect(() => parsePath('')).toThrow();
    expect(() => parsePath('/0')).toThrow();
    expect(() => parsePath('$/x')).toThrow();
    expect(() => parsePath('$/-1')).toThrow();
  });

  it('getAt returns the root for `$`', () => {
    expect(getAt(tree, '$')).toBe(tree);
  });

  it('getAt returns a leaf by path', () => {
    expect(getAt(tree, '$/1/0')).toMatchObject({ type: 'sphere' });
  });

  it('getAt throws for an out-of-range index', () => {
    expect(() => getAt(tree, '$/5')).toThrow();
  });

  it('replaceWithin replaces the node at the given path and returns a new tree', () => {
    const next = replaceWithin(tree, '$/1/0', {
      type: 'cylinder',
      params: { height: 5, radius: 1 },
    });
    expect((next.children![1].children![0] as NodeDoc).type).toBe('cylinder');
    // Original tree is untouched (immutability).
    expect((tree.children![1].children![0] as NodeDoc).type).toBe('sphere');
  });

  it('replaceWithin can replace the root', () => {
    const next = replaceWithin(tree, '$', { type: 'box', params: {} });
    expect(next.type).toBe('box');
  });
});
