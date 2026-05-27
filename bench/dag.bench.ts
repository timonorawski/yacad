/**
 * Benchmarks for @yacad/dag — buildGraph re-hashes the entire DAG on every
 * edit. The cost scales with DAG depth × number of nodes.
 */
import { bench, describe } from 'vitest';
import { buildGraph } from '@yacad/dag';

// Minimal single-node DAG.
const primitiveDoc = { type: 'box', params: { size: [10, 10, 10], center: true } };

// Three-node model: union[ box, sphere ] — the canonical POC example.
const threeNodeDoc = {
  type: 'union',
  children: [
    { type: 'box', params: { size: [10, 10, 10], center: true } },
    { type: 'sphere', params: { radius: 5 } },
  ],
};

// Five-node model simulating a slightly deeper tree.
const fiveNodeDoc = {
  type: 'difference',
  children: [
    { type: 'box', params: { size: [30, 30, 30], center: true } },
    {
      type: 'translate',
      params: { offset: [5, 5, 5] },
      children: [{ type: 'sphere', params: { radius: 19, segments: 48 } }],
    },
  ],
};

describe('buildGraph', () => {
  bench('single primitive (box)', async () => {
    await buildGraph(primitiveDoc);
  });

  bench('three nodes (union[box, sphere])', async () => {
    await buildGraph(threeNodeDoc);
  });

  bench('five nodes (difference tree)', async () => {
    await buildGraph(fiveNodeDoc);
  });
});
