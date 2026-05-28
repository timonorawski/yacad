import { describe, expect, it } from 'vitest';
import { defaultHasher } from '@yacad/hash';
import { canonicalizeDefinition, hashLuaDefinition } from './canonical';
import type { LuaDefinition } from './schema';

const A: LuaDefinition = {
  schema: { inputs: [], params: { teeth: { type: 'int', default: 12 } }, output: '3d' },
  code: 'return geo.box({size = {1, 1, 1}})',
};

const A_REORDERED: LuaDefinition = {
  code: A.code,
  schema: { output: '3d', params: { teeth: { default: 12, type: 'int' } }, inputs: [] },
};

const B_DIFFERENT_CODE: LuaDefinition = { ...A, code: A.code + '\n' };

describe('canonicalizeDefinition', () => {
  it('is stable under key reorderings', () => {
    expect(canonicalizeDefinition(A)).toBe(canonicalizeDefinition(A_REORDERED));
  });

  it('distinguishes byte-different code', () => {
    expect(canonicalizeDefinition(A)).not.toBe(canonicalizeDefinition(B_DIFFERENT_CODE));
  });
});

describe('hashLuaDefinition', () => {
  it('matches hash(canonicalize)', async () => {
    const h1 = await hashLuaDefinition(A, defaultHasher);
    const h2 = await defaultHasher.hash(new TextEncoder().encode(canonicalizeDefinition(A)));
    expect(h1).toBe(h2);
  });

  it('is deterministic across runs', async () => {
    const h1 = await hashLuaDefinition(A, defaultHasher);
    const h2 = await hashLuaDefinition(A, defaultHasher);
    expect(h1).toBe(h2);
  });

  it('hashes equal across schema-key reorderings (canonical form is identical)', async () => {
    expect(await hashLuaDefinition(A, defaultHasher)).toBe(
      await hashLuaDefinition(A_REORDERED, defaultHasher),
    );
  });
});
