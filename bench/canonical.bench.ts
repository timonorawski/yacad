/**
 * Benchmarks for @yacad/canonical — the hot-path serializer that runs on every
 * node hash computation. Regressions here multiply across the whole DAG.
 */
import { bench, describe } from 'vitest';
import { canonicalize, canonicalBytes } from '@yacad/canonical';

// Representative parameter objects similar to real node params.
const simpleParams = { size: [10, 10, 10], center: true };
const nestedParams = {
  type: 'difference',
  params: { offset: [0, 0, 0] },
  children: [
    { type: 'box', params: { size: [10, 10, 10], center: true } },
    { type: 'sphere', params: { radius: 5, segments: 48 } },
  ],
};
const stringHeavy = { label: 'a long parameter label with unicode éàü', value: 42 };

describe('canonicalize', () => {
  bench('simple params (box)', () => {
    canonicalize(simpleParams);
  });

  bench('nested params (subtree preimage)', () => {
    canonicalize(nestedParams);
  });

  bench('string-heavy params', () => {
    canonicalize(stringHeavy);
  });

  bench('canonicalBytes (includes TextEncoder)', () => {
    canonicalBytes(simpleParams);
  });
});
