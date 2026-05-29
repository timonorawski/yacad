import { describe, expect, it } from 'vitest';
import {
  getKernelTypeDoc,
  getNodeType,
  listNodeTypes,
  registerNodeType,
  unregisterNodeType,
  type KernelNodeType,
} from './registry';

describe('registerNodeType', () => {
  const SYN: KernelNodeType = {
    kind: 'kernel',
    type: 'syn_test',
    output: '3d',
    checkChildren() {},
    normalizeParams() {
      return {};
    },
  };

  it('round-trips a registered type and rejects duplicates', () => {
    registerNodeType(SYN);
    try {
      expect(getNodeType('syn_test')).toBe(SYN);
      expect(() => registerNodeType(SYN)).toThrow(/already registered/);
    } finally {
      unregisterNodeType('syn_test');
    }
    expect(getNodeType('syn_test')).toBeUndefined();
  });
});

/** Fabricate a typed-valid stub value for a ParamDoc type.
 *  Uses positive/non-empty values so validators that require > 0 pass. */
function stubFor(type: string): unknown {
  switch (type) {
    case 'number':
      return 1;
    case 'int':
      return 1;
    case 'boolean':
      return false;
    case 'string':
      return 'stub';
    case 'vec2':
      return [1, 1];
    case 'vec3':
      return [1, 1, 1];
    case 'vec2-array':
      return [
        [0, 0],
        [1, 0],
        [0, 1],
      ];
    case 'record':
      return {};
    default:
      return undefined;
  }
}

describe('paramSchema completeness', () => {
  it('every declared paramSchema param is accepted by normalizeParams for all kernel types', () => {
    const kernelTypes = listNodeTypes()
      .map((t) => t.type)
      .filter((type) => {
        const def = getNodeType(type);
        return def?.kind === 'kernel';
      });

    for (const typeName of kernelTypes) {
      const doc = getKernelTypeDoc(typeName);
      if (!doc || doc.paramSchema.length === 0) continue;

      const def = getNodeType(typeName);
      if (!def || def.kind !== 'kernel') continue;

      // Build a params object with stub values for every declared param.
      const params: Record<string, unknown> = {};
      for (const p of doc.paramSchema) {
        const value = p.default !== undefined ? p.default : stubFor(p.type);
        if (value !== undefined) {
          params[p.name] = value;
        }
      }

      // normalizeParams must not throw when given every declared param.
      // Special-case `refine`: it uses an exclusive-group; provide only one member.
      // The exclusive check requires exactly one of 'n' or 'maxEdgeLength'.
      let callParams = params;
      if (typeName === 'refine') {
        // Only supply `n`, not `maxEdgeLength` (mutually exclusive).
        callParams = { n: 2 };
      }

      expect(
        () => def.normalizeParams(callParams, `paramSchema-completeness/${typeName}`),
        `normalizeParams for "${typeName}" should not throw with all declared params`,
      ).not.toThrow();
    }
  });
});
