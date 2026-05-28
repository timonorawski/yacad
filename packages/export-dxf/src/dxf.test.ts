import { describe, expect, it } from 'vitest';
import DxfParser from 'dxf-parser';
import type { CrossSection } from '@yacad/geometry';
import { crossSectionToDxf, ExportError } from './dxf';

function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

const emptyCs: CrossSection = { polygons: [] };

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

const squareWithHoleCs: CrossSection = {
  polygons: [
    // Outer CCW
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
    // Hole CW
    [
      [3, 3],
      [3, 7],
      [7, 7],
      [7, 3],
    ],
  ],
};

describe('crossSectionToDxf', () => {
  it('emits a valid DXF for an empty CrossSection (no LWPOLYLINE)', () => {
    const dxf = decode(crossSectionToDxf(emptyCs));
    expect(dxf).toContain('SECTION');
    expect(dxf).toContain('HEADER');
    expect(dxf).toContain('ENTITIES');
    expect(dxf).toContain('EOF');
    expect(dxf).not.toContain('LWPOLYLINE');
  });

  it('emits one LWPOLYLINE per polygon with correct vertex count and coords', () => {
    const dxf = decode(crossSectionToDxf(squareCs));
    expect(dxf).toContain('LWPOLYLINE');
    // 4 vertices, closed
    expect(dxf).toMatch(/^\s*90\s*\n\s*4\s*$/m); // group code 90 = vertex count
    expect(dxf).toMatch(/^\s*70\s*\n\s*1\s*$/m); // group code 70 = flags (1 = closed)
    // First vertex (group 10 = x, 20 = y)
    expect(dxf).toMatch(/^\s*10\s*\n\s*0(\.0+)?\s*$/m);
  });

  it('emits two LWPOLYLINE entries for a multi-polygon CrossSection', () => {
    const dxf = decode(crossSectionToDxf(squareWithHoleCs));
    const matches = dxf.match(/LWPOLYLINE/g) ?? [];
    expect(matches.length).toBe(2);
  });

  it('uses the supplied layer name on each entity', () => {
    const dxf = decode(crossSectionToDxf(squareCs, { layer: 'profile' }));
    // Layer table entry
    expect(dxf).toContain('profile');
    // Group code 8 = layer on entity
    expect(dxf).toMatch(/^\s*8\s*\n\s*profile\s*$/m);
  });

  it('defaults layer to "0" and units to mm (4)', () => {
    const dxf = decode(crossSectionToDxf(squareCs));
    expect(dxf).toMatch(/^\s*8\s*\n\s*0\s*$/m);
    // $INSUNITS header
    expect(dxf).toContain('$INSUNITS');
    expect(dxf).toMatch(/\$INSUNITS\s*\n\s*70\s*\n\s*4/);
  });

  it('throws ExportError on non-finite coordinates', () => {
    const bad: CrossSection = {
      polygons: [
        [
          [0, 0],
          [Infinity, 0],
          [1, 1],
        ],
      ],
    };
    expect(() => crossSectionToDxf(bad)).toThrow(ExportError);
  });

  it('is deterministic — same input produces byte-identical output', () => {
    const a = crossSectionToDxf(squareCs);
    const b = crossSectionToDxf(squareCs);
    expect(a).toEqual(b);
  });

  it('throws ExportError on NaN coordinates', () => {
    const bad: CrossSection = {
      polygons: [
        [
          [0, 0],
          [NaN, 0],
          [1, 1],
        ],
      ],
    };
    expect(() => crossSectionToDxf(bad)).toThrow(ExportError);
  });

  it('throws ExportError on a polygon with fewer than 3 vertices', () => {
    const degenerate: CrossSection = {
      polygons: [
        [
          [0, 0],
          [1, 1],
        ],
      ],
    };
    expect(() => crossSectionToDxf(degenerate)).toThrow(ExportError);
  });

  it('throws ExportError on an empty polygon (zero vertices)', () => {
    const empty: CrossSection = { polygons: [[]] };
    expect(() => crossSectionToDxf(empty)).toThrow(ExportError);
  });
});

describe('crossSectionToDxf (structural validation via dxf-parser)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parse = (bytes: Uint8Array): any =>
    new DxfParser().parseSync(new TextDecoder().decode(bytes));

  it('produces a parseable DXF for an empty CrossSection (no entities)', () => {
    const parsed = parse(crossSectionToDxf(emptyCs));
    expect(parsed.entities).toEqual([]);
  });

  it('produces exactly one LWPOLYLINE entity for a single-polygon CrossSection', () => {
    const parsed = parse(crossSectionToDxf(squareCs));
    expect(parsed.entities).toHaveLength(1);
    const e = parsed.entities[0];
    expect(e.type).toBe('LWPOLYLINE');
    expect(e.shape).toBe(true); // closed
    expect(e.vertices).toHaveLength(4);
    expect(e.vertices[0]).toMatchObject({ x: 0, y: 0 });
    expect(e.vertices[1]).toMatchObject({ x: 10, y: 0 });
    expect(e.vertices[2]).toMatchObject({ x: 10, y: 10 });
    expect(e.vertices[3]).toMatchObject({ x: 0, y: 10 });
  });

  it('produces two LWPOLYLINE entities for a multi-polygon CrossSection', () => {
    const parsed = parse(crossSectionToDxf(squareWithHoleCs));
    expect(parsed.entities).toHaveLength(2);
    for (const e of parsed.entities) {
      expect(e.type).toBe('LWPOLYLINE');
      expect(e.shape).toBe(true);
    }
  });

  it('places entities on the configured layer name', () => {
    const parsed = parse(crossSectionToDxf(squareCs, { layer: 'profile' }));
    expect(parsed.entities[0].layer).toBe('profile');
  });

  it('defaults layer to "0"', () => {
    const parsed = parse(crossSectionToDxf(squareCs));
    expect(parsed.entities[0].layer).toBe('0');
  });
});
