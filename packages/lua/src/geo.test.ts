import { describe, expect, it } from 'vitest';
import { registerNodeType, unregisterNodeType, type ExpandableNodeType } from '@yacad/dag';
import { buildGeoApi } from './geo';

describe('buildGeoApi', () => {
  it('produces a wrapper per registered kernel-node type', () => {
    const geo = buildGeoApi();
    expect(typeof geo.box).toBe('function');
    expect(typeof geo.union).toBe('function');
    expect(typeof geo.difference).toBe('function');
    expect(typeof geo.translate).toBe('function');
    expect(typeof geo.rotate).toBe('function');
    expect(typeof geo.sphere).toBe('function');
    expect(typeof geo.cylinder).toBe('function');
    expect(typeof geo.node).toBe('function');
  });

  it('wrappers produce NodeDoc shape', () => {
    const geo = buildGeoApi();
    const doc = geo.box({ size: [1, 2, 3] });
    expect(doc).toEqual({ type: 'box', params: { size: [1, 2, 3] }, children: [] });
  });

  it('union/difference accept variadic children (as an array)', () => {
    const geo = buildGeoApi();
    const a = geo.box({ size: [1, 1, 1] });
    const b = geo.sphere({ radius: 1 });
    const doc = geo.union({}, [a, b]);
    expect(doc).toEqual({ type: 'union', params: {}, children: [a, b] });
  });

  it('node() primitive accepts arbitrary kernel-type strings', () => {
    const geo = buildGeoApi();
    expect(geo.node('box', { size: [1, 1, 1] })).toEqual({
      type: 'box',
      params: { size: [1, 1, 1] },
      children: [],
    });
  });

  it('node() rejects unknown types eagerly (fails fast in Lua, not at buildGraph)', () => {
    const geo = buildGeoApi();
    expect(() => geo.node('not_a_type', {})).toThrow(/unknown/i);
  });

  it('node() rejects reserved __-prefixed types', () => {
    const geo = buildGeoApi();
    expect(() => geo.node('__input_ref', {})).toThrow(/reserved/i);
  });

  it('does not generate wrappers for expandable node types, and node() rejects them', () => {
    // Register a synthetic expandable type to verify the filter works once
    // chunk 4 lands the real 'lua' expandable type.
    const synExpandable: ExpandableNodeType = {
      kind: 'expandable',
      type: 'syn_expand',
      resolveOutput: () => '3d',
      checkChildren() {},
      normalizeParams: (p) => (p ?? {}) as Record<string, unknown>,
      inputNames: () => [],
      async expand() {
        return { type: 'box', params: { size: [1, 1, 1] } };
      },
    };
    registerNodeType(synExpandable);
    try {
      const geo = buildGeoApi();
      expect(geo).not.toHaveProperty('syn_expand');
      expect(() => geo.node('syn_expand', {})).toThrow(/expandable.*v1 restriction/i);
    } finally {
      unregisterNodeType('syn_expand');
    }
  });
});
