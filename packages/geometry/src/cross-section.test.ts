import { describe, expect, it } from 'vitest';
import { emptyCrossSection, type CrossSection, type Vec2 } from './cross-section';

describe('CrossSection helpers', () => {
  it('emptyCrossSection has no polygons', () => {
    expect(emptyCrossSection().polygons).toEqual([]);
  });

  it('round-trips through structured clone (postMessage-safe)', () => {
    const cs: CrossSection = {
      polygons: [[[0, 0] as Vec2, [10, 0] as Vec2, [10, 10] as Vec2, [0, 10] as Vec2]],
    };
    const clone = structuredClone(cs);
    expect(clone).toEqual(cs);
    expect(clone).not.toBe(cs);
  });
});
