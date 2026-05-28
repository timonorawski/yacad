import { describe, expect, it } from 'vitest';

import { vec2, posVec2 } from './validate';
import { DagError } from './types';

describe('vec2 validator', () => {
  it('accepts a length-2 finite array', () => {
    expect(vec2({ p: [1.5, -2.0] }, 'p', '$')).toEqual([1.5, -2.0]);
  });

  it('rejects wrong length', () => {
    expect(() => vec2({ p: [1] }, 'p', '$')).toThrow(/2-element/);
    expect(() => vec2({ p: [1, 2, 3] }, 'p', '$')).toThrow(/2-element/);
  });

  it('rejects non-finite numbers', () => {
    expect(() => vec2({ p: [Infinity, 0] }, 'p', '$')).toThrow(/finite/);
    expect(() => vec2({ p: [NaN, 0] }, 'p', '$')).toThrow(/finite/);
  });
});

describe('posVec2 / vec2 positive validator', () => {
  it('accepts positive components', () => {
    expect(posVec2({ p: [1, 2] }, 'p', '$')).toEqual([1, 2]);
  });

  it('rejects zero or negative', () => {
    expect(() => posVec2({ p: [0, 1] }, 'p', '$')).toThrow(/greater than 0/);
    expect(() => posVec2({ p: [-1, 1] }, 'p', '$')).toThrow(/greater than 0/);
  });
});
