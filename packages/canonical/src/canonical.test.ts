import { describe, expect, it } from 'vitest';
import { canonicalBytes, canonicalize, CanonicalError } from './canonical';

describe('canonicalize', () => {
  it('sorts object keys deterministically regardless of insertion order', () => {
    expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }));
    expect(canonicalize({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it('sorts keys recursively in nested objects', () => {
    const a = { outer: { z: 1, a: 2 }, first: true };
    const b = { first: true, outer: { a: 2, z: 1 } };
    expect(canonicalize(a)).toBe(canonicalize(b));
    expect(canonicalize(a)).toBe('{"first":true,"outer":{"a":2,"z":1}}');
  });

  it('preserves array order (arrays are not sorted)', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalize([1, 2, 3])).not.toBe(canonicalize([3, 2, 1]));
  });

  describe('number normalization', () => {
    it('treats integer and trailing-zero float forms as identical', () => {
      // These parse to the same float64, the core guarantee we rely on.
      expect(canonicalize(JSON.parse('1.0'))).toBe(canonicalize(JSON.parse('1')));
      expect(canonicalize(JSON.parse('1.10'))).toBe('1.1');
      expect(canonicalize(JSON.parse('1e3'))).toBe('1000');
    });

    it('folds negative zero to zero', () => {
      expect(canonicalize(-0)).toBe('0');
      expect(canonicalize(0)).toBe('0');
      expect(canonicalize({ x: -0 })).toBe(canonicalize({ x: 0 }));
    });

    it('rejects non-finite numbers', () => {
      expect(() => canonicalize(NaN)).toThrow(CanonicalError);
      expect(() => canonicalize(Infinity)).toThrow(CanonicalError);
      expect(() => canonicalize(-Infinity)).toThrow(CanonicalError);
    });
  });

  describe('primitives', () => {
    it('encodes null and booleans', () => {
      expect(canonicalize(null)).toBe('null');
      expect(canonicalize(true)).toBe('true');
      expect(canonicalize(false)).toBe('false');
    });

    it('escapes strings via JSON rules', () => {
      expect(canonicalize('a"b\\c')).toBe('"a\\"b\\\\c"');
      expect(canonicalize('\n')).toBe('"\\n"');
      expect(canonicalize('a')).toBe(canonicalize('a'));
    });
  });

  describe('undefined handling', () => {
    it('omits undefined object properties (matching JSON)', () => {
      expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}');
      expect(canonicalize({ a: 1, b: undefined })).toBe(canonicalize({ a: 1 }));
    });

    it('rejects undefined as an array element', () => {
      expect(() => canonicalize([1, undefined, 2])).toThrow(CanonicalError);
    });

    it('rejects a bare undefined value', () => {
      expect(() => canonicalize(undefined)).toThrow(CanonicalError);
    });
  });

  describe('unsupported values', () => {
    it('rejects bigint, function, and symbol', () => {
      expect(() => canonicalize(1n)).toThrow(CanonicalError);
      expect(() => canonicalize(() => {})).toThrow(CanonicalError);
      expect(() => canonicalize(Symbol('x'))).toThrow(CanonicalError);
    });

    it('rejects non-plain objects (Date, Map, class instances)', () => {
      expect(() => canonicalize(new Date())).toThrow(CanonicalError);
      expect(() => canonicalize(new Map())).toThrow(CanonicalError);
      class Foo {
        x = 1;
      }
      expect(() => canonicalize(new Foo())).toThrow(CanonicalError);
    });

    it('accepts null-prototype objects', () => {
      const obj = Object.assign(Object.create(null), { b: 2, a: 1 });
      expect(canonicalize(obj)).toBe('{"a":1,"b":2}');
    });
  });

  it('is idempotent / stable across repeated calls', () => {
    const value = { n: 'box', params: { size: [10, 20, 30], centered: true } };
    expect(canonicalize(value)).toBe(canonicalize(value));
  });

  it('produces UTF-8 bytes matching the canonical string', () => {
    const value = { size: [1, 2, 3] };
    expect(new TextDecoder().decode(canonicalBytes(value))).toBe(canonicalize(value));
  });
});
