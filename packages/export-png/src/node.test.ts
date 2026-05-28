import { describe, expect, it } from 'vitest';
import type { CrossSection } from '@yacad/geometry';
import { crossSectionToPngNode } from './node';
import { ExportError } from './errors';

const squareCs: CrossSection = {
  polygons: [
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
  ],
};

describe('crossSectionToPngNode', () => {
  it('produces bytes starting with the PNG magic signature', () => {
    const bytes = crossSectionToPngNode(squareCs, { width: 100, height: 100 });
    // PNG magic: 89 50 4E 47 0D 0A 1A 0A
    expect(bytes[0]).toBe(0x89);
    expect(bytes[1]).toBe(0x50);
    expect(bytes[2]).toBe(0x4e);
    expect(bytes[3]).toBe(0x47);
    expect(bytes[4]).toBe(0x0d);
    expect(bytes[5]).toBe(0x0a);
    expect(bytes[6]).toBe(0x1a);
    expect(bytes[7]).toBe(0x0a);
  });

  it('encodes width and height correctly in the IHDR chunk', () => {
    const bytes = crossSectionToPngNode(squareCs, { width: 100, height: 80 });
    // IHDR chunk starts at byte 16 (8 magic + 4 length + 4 type "IHDR")
    // Width is bytes 16..19, height is bytes 20..23 (big-endian uint32)
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(16, false)).toBe(100);
    expect(view.getUint32(20, false)).toBe(80);
  });

  it('throws ExportError on zero width', () => {
    expect(() => crossSectionToPngNode(squareCs, { width: 0, height: 100 })).toThrow(ExportError);
  });

  it('throws ExportError on negative height', () => {
    expect(() => crossSectionToPngNode(squareCs, { width: 100, height: -1 })).toThrow(ExportError);
  });

  it('produces non-empty output for a non-empty cross-section', () => {
    const bytes = crossSectionToPngNode(squareCs, { width: 100, height: 100 });
    expect(bytes.length).toBeGreaterThan(100);
  });

  it('renders an empty cross-section without throwing (background-only image)', () => {
    const empty: CrossSection = { polygons: [] };
    const bytes = crossSectionToPngNode(empty, { width: 50, height: 50, background: '#fff' });
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('throws ExportError on non-integer width', () => {
    expect(() => crossSectionToPngNode(squareCs, { width: 100.5, height: 100 })).toThrow(
      ExportError,
    );
  });

  it('forwards rasterizer-level errors (non-finite coords)', () => {
    const bad: CrossSection = {
      polygons: [
        [
          [0, 0],
          [NaN, 0],
          [1, 1],
        ],
      ],
    };
    expect(() => crossSectionToPngNode(bad, { width: 100, height: 100 })).toThrow(ExportError);
  });
});
