import { describe, expect, it } from 'vitest';
import { getNodeType, listNodeTypes } from '@yacad/dag';
import { KERNEL_TYPE_DOCS } from './geo-docs';

describe('KERNEL_TYPE_DOCS', () => {
  it('has an entry for every registered kernel-backed (non-reserved) type', () => {
    const declared = new Set(KERNEL_TYPE_DOCS.map((d) => d.type));
    const expected = listNodeTypes()
      .filter((t) => !t.type.startsWith('__'))
      .map((t) => t.type)
      .filter((type) => getNodeType(type)?.kind === 'kernel');
    for (const type of expected) {
      expect(declared.has(type), `missing geo doc entry for "${type}"`).toBe(true);
    }
  });

  it('does not declare entries for unregistered or non-kernel types', () => {
    for (const doc of KERNEL_TYPE_DOCS) {
      const def = getNodeType(doc.type);
      expect(def, `geo doc references unknown type "${doc.type}"`).toBeDefined();
      expect(def!.kind).toBe('kernel');
    }
  });

  it('has non-empty summary and example for every entry', () => {
    for (const doc of KERNEL_TYPE_DOCS) {
      expect(doc.summary.length).toBeGreaterThan(0);
      expect(doc.example.length).toBeGreaterThan(0);
    }
  });

  it('every kernel type has a non-empty paramSchema array or an empty one (never undefined)', () => {
    for (const doc of KERNEL_TYPE_DOCS) {
      expect(Array.isArray(doc.paramSchema), `kernel type "${doc.type}" has no paramSchema`).toBe(
        true,
      );
    }
  });

  it('every kernel type has a Lua example', () => {
    for (const doc of KERNEL_TYPE_DOCS) {
      expect(doc.example.length, `kernel type "${doc.type}" has no example`).toBeGreaterThan(0);
    }
  });
});
