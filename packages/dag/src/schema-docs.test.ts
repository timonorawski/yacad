import { describe, expect, it } from 'vitest';
import {
  listNodeTypes,
  getKernelTypeDoc,
  getNodeType,
  registerNodeType,
  unregisterNodeType,
} from './index';

describe('kernel schema-docs', () => {
  it('getKernelTypeDoc returns summary/outputDoc/paramSchema for every kernel type', () => {
    const kernelTypes = listNodeTypes()
      .map((t) => t.type)
      .filter((t) => getNodeType(t)?.kind === 'kernel');

    expect(kernelTypes.length).toBeGreaterThan(0);
    for (const type of kernelTypes) {
      const doc = getKernelTypeDoc(type);
      expect(doc, `kernel type "${type}" has no docs`).toBeDefined();
      expect(doc!.summary.length).toBeGreaterThan(0);
      expect(doc!.outputDoc.length).toBeGreaterThan(0);
      expect(Array.isArray(doc!.paramSchema)).toBe(true);
    }
  });

  it('getKernelTypeDoc returns undefined for unknown types', () => {
    expect(getKernelTypeDoc('not-a-real-type')).toBeUndefined();
  });

  it('returns undefined for a registered non-kernel type', () => {
    const MOCK_TYPE = 'mock-expandable-for-test';
    registerNodeType({
      kind: 'expandable',
      type: MOCK_TYPE,
      resolveOutput: () => '3d',
      checkChildren: () => {},
      normalizeParams: () => ({}),
      inputNames: () => [],
      expand: async () => ({ type: 'box', params: { size: [1, 1, 1] } }),
    });
    try {
      expect(getKernelTypeDoc(MOCK_TYPE)).toBeUndefined();
    } finally {
      unregisterNodeType(MOCK_TYPE);
    }
  });

  it('a kernel doc with paramSchema entries has well-formed ParamDoc shape', () => {
    const box = getKernelTypeDoc('box');
    expect(box).toBeDefined();
    const size = box!.paramSchema.find((p) => p.name === 'size');
    expect(size).toBeDefined();
    expect(size!.type).toBe('vec3');
    expect(size!.required).toBe(true);
  });
});
