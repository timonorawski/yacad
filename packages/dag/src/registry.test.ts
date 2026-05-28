import { describe, expect, it } from 'vitest';
import { getNodeType, registerNodeType, unregisterNodeType, type KernelNodeType } from './registry';

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
