import { describe, expect, it } from 'vitest';
import type { CrossSection } from '@yacad/geometry';
import { crossSectionToSvg, ExportError } from './svg';

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
    [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ],
    [
      [3, 3],
      [3, 7],
      [7, 7],
      [7, 3],
    ],
  ],
};

describe('crossSectionToSvg', () => {
  it('emits a valid SVG document for an empty CrossSection', () => {
    const svg = decode(crossSectionToSvg(emptyCs));
    expect(svg).toMatch(/^<\?xml[^>]*\?>/);
    expect(svg).toContain('<svg ');
    expect(svg).toContain('</svg>');
  });

  it('emits a single <path> with Y-flipped coordinates for a square', () => {
    const svg = decode(crossSectionToSvg(squareCs));
    expect(svg).toContain('<path');
    // Y-flipped: vertex [10, 10] should appear as "10 -10" in path data
    expect(svg).toContain('10 -10');
    // Path data uses M / L / Z
    expect(svg).toMatch(/d="M[^"]*L[^"]*Z"/);
  });

  it('concatenates multiple polygons into one <path> with fill-rule="evenodd"', () => {
    const svg = decode(crossSectionToSvg(squareWithHoleCs));
    const pathMatches = svg.match(/<path/g) ?? [];
    expect(pathMatches.length).toBe(1);
    expect(svg).toContain('fill-rule="evenodd"');
    // Two Z commands (one per polygon)
    const dAttr = svg.match(/d="([^"]+)"/)?.[1] ?? '';
    expect(dAttr.split('Z').length - 1).toBe(2);
  });

  it('autocomputes viewBox from bounds plus padding', () => {
    const svg = decode(crossSectionToSvg(squareCs, { padding: 5 }));
    // bbox (0,0)-(10,10), Y-flipped to (0,-10)-(10,0), padded by 5
    // viewBox = (-5, -15, 20, 20)
    expect(svg).toContain('viewBox="-5 -15 20 20"');
  });

  it('honors explicit width/height while keeping autocomputed viewBox', () => {
    const svg = decode(crossSectionToSvg(squareCs, { width: 400, height: 400 }));
    expect(svg).toContain('width="400"');
    expect(svg).toContain('height="400"');
    expect(svg).toContain('viewBox=');
  });

  it('emits a background rect when background is set', () => {
    const svg = decode(crossSectionToSvg(squareCs, { background: '#fff' }));
    expect(svg).toContain('<rect ');
    expect(svg).toContain('#fff');
  });

  it('omits the background rect when background is null (default)', () => {
    const svg = decode(crossSectionToSvg(squareCs));
    expect(svg).not.toContain('<rect ');
  });

  it('honors stroke / fill / strokeWidth options', () => {
    const svg = decode(
      crossSectionToSvg(squareCs, { stroke: '#f00', fill: '#0f0', strokeWidth: 2 }),
    );
    expect(svg).toContain('stroke="#f00"');
    expect(svg).toContain('fill="#0f0"');
    expect(svg).toContain('stroke-width="2"');
  });

  it('throws ExportError on non-finite coordinates', () => {
    const bad: CrossSection = {
      polygons: [
        [
          [0, 0],
          [NaN, 0],
          [1, 1],
        ],
      ],
    };
    expect(() => crossSectionToSvg(bad)).toThrow(ExportError);
  });

  it('is deterministic', () => {
    const a = crossSectionToSvg(squareCs);
    const b = crossSectionToSvg(squareCs);
    expect(a).toEqual(b);
  });

  // Lesson 1 from Task 1: degenerate-polygon guard
  it('throws ExportError on a polygon with fewer than 3 vertices', () => {
    const degenerate: CrossSection = {
      polygons: [
        [
          [0, 0],
          [1, 1],
        ],
      ],
    };
    expect(() => crossSectionToSvg(degenerate)).toThrow(ExportError);
  });

  it('throws ExportError on an empty polygon (zero vertices)', () => {
    const empty: CrossSection = { polygons: [[]] };
    expect(() => crossSectionToSvg(empty)).toThrow(ExportError);
  });

  // Lesson 2 from Task 1: explicit Infinity test
  it('throws ExportError on Infinity coordinates', () => {
    const bad: CrossSection = {
      polygons: [
        [
          [0, 0],
          [Infinity, 0],
          [1, 1],
        ],
      ],
    };
    expect(() => crossSectionToSvg(bad)).toThrow(ExportError);
  });
});
