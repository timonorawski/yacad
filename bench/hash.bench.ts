/**
 * Benchmarks for @yacad/hash — SHA-256 hashing is async and runs on every
 * node in the DAG during buildGraph and engine evaluation.
 */
import { bench, describe } from 'vitest';
import { hashCanonical, Sha256Hasher } from '@yacad/hash';

const hasher = new Sha256Hasher();

// Typical params object (same as canonical bench — so we measure end-to-end).
const typicalParams = { size: [10, 10, 10], center: true };
const largeParams = {
  t: 'difference',
  p: { offset: [0, 0, 0] },
  c: [
    'aaaaabbbbbcccccddddd1111122222',
    'eeeeeffffggggghhhhhiiii0000099',
    'jjjjjkkkkkllllmmmmmnnnn111111',
  ],
};

describe('hashCanonical', () => {
  bench('typical node params', async () => {
    await hashCanonical(typicalParams, hasher);
  });

  bench('large preimage (subtree with child hashes)', async () => {
    await hashCanonical(largeParams, hasher);
  });
});
