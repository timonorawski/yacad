import { describe, expect, it } from 'vitest';
import { defaultHasher, hashCanonical, Sha256Hasher } from './hasher';

const enc = new TextEncoder();

describe('Sha256Hasher', () => {
  const hasher = new Sha256Hasher();

  it('reports its algorithm', () => {
    expect(hasher.algorithm).toBe('sha-256');
  });

  it('matches the known SHA-256 vector for "abc"', () => {
    // NIST FIPS 180-4 example.
    return expect(hasher.hash(enc.encode('abc'))).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashes the empty input to the known digest', () => {
    return expect(hasher.hash(new Uint8Array(0))).resolves.toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('is deterministic and collision-sensitive', async () => {
    const a = await hasher.hash(enc.encode('hello'));
    const b = await hasher.hash(enc.encode('hello'));
    const c = await hasher.hash(enc.encode('hellp'));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('hashCanonical', () => {
  it('produces equal hashes for semantically equal values', async () => {
    const a = await hashCanonical({ a: 1, b: 2 });
    const b = await hashCanonical({ b: 2, a: 1 });
    expect(a).toBe(b);
  });

  it('produces different hashes for different values', async () => {
    const a = await hashCanonical({ size: [1, 2, 3] });
    const b = await hashCanonical({ size: [1, 2, 4] });
    expect(a).not.toBe(b);
  });

  it('defaults to the shared SHA-256 hasher', async () => {
    const viaHelper = await hashCanonical({ x: 1 });
    const viaInstance = await defaultHasher.hash(enc.encode('{"x":1}'));
    expect(viaHelper).toBe(viaInstance);
  });
});
