import { describe, expect, it } from 'vitest';
import { listNodeTypes, getKernelTypeDoc, getNodeType } from './index';

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

  it('getKernelTypeDoc returns undefined for non-kernel types', () => {
    // 'lua' is expandable; 'import-stl' is a decoder. Neither has a kernel doc.
    expect(getKernelTypeDoc('lua')).toBeUndefined();
    expect(getKernelTypeDoc('not-a-real-type')).toBeUndefined();
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
