import { describe, expect, it } from 'vitest';
import type { NodeDoc } from '@yacad/dag';
import { addChild, moveChild, removeAt, replaceAt, wrapWith } from './structural';

const tree: NodeDoc = {
  type: 'union',
  children: [
    { type: 'box', params: { size: [10, 10, 10] } },
    { type: 'sphere', params: { radius: 5 } },
  ],
};

describe('addChild', () => {
  it('appends a child when index is omitted', () => {
    const next = addChild(tree, '$', { type: 'cylinder', params: { height: 5, radius: 1 } });
    expect(next.children).toHaveLength(3);
    expect((next.children![2] as NodeDoc).type).toBe('cylinder');
  });

  it('inserts a child at the given index', () => {
    const next = addChild(tree, '$', { type: 'cylinder', params: { height: 5, radius: 1 } }, 0);
    expect((next.children![0] as NodeDoc).type).toBe('cylinder');
    expect((next.children![1] as NodeDoc).type).toBe('box');
  });

  it('throws on out-of-range index', () => {
    expect(() => addChild(tree, '$', { type: 'box', params: {} }, 99)).toThrow();
  });
});

describe('removeAt', () => {
  it('removes the node at the given path', () => {
    const next = removeAt(tree, '$/0');
    expect(next.children).toHaveLength(1);
    expect((next.children![0] as NodeDoc).type).toBe('sphere');
  });

  it('throws when removing the root', () => {
    expect(() => removeAt(tree, '$')).toThrow(/cannot remove root/i);
  });
});

describe('replaceAt', () => {
  it('replaces the node at the given path', () => {
    const next = replaceAt(tree, '$/0', { type: 'cylinder', params: { height: 5, radius: 1 } });
    expect((next.children![0] as NodeDoc).type).toBe('cylinder');
  });

  it('replaces the root when path is `$`', () => {
    const next = replaceAt(tree, '$', { type: 'box', params: {} });
    expect(next.type).toBe('box');
  });
});

describe('wrapWith', () => {
  it('wraps the node at the given path in a new parent', () => {
    const next = wrapWith(tree, '$/0', 'translate', { offset: [5, 0, 0] });
    const wrapped = next.children![0] as NodeDoc;
    expect(wrapped.type).toBe('translate');
    expect(wrapped.params).toMatchObject({ offset: [5, 0, 0] });
    expect((wrapped.children![0] as NodeDoc).type).toBe('box');
  });

  it('wraps the root', () => {
    const next = wrapWith(tree, '$', 'translate', { offset: [0, 0, 0] });
    expect(next.type).toBe('translate');
    expect((next.children![0] as NodeDoc).type).toBe('union');
  });
});

describe('moveChild', () => {
  it('moves a child to a different position within the same parent', () => {
    const next = moveChild(tree, '$/0', '$/1');
    expect((next.children![0] as NodeDoc).type).toBe('sphere');
    expect((next.children![1] as NodeDoc).type).toBe('box');
  });

  it('throws when source and destination share the same path', () => {
    expect(() => moveChild(tree, '$/0', '$/0')).toThrow();
  });
});
