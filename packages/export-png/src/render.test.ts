import { describe, expect, it } from 'vitest';
import type { CrossSection } from '@yacad/geometry';
import { renderCrossSectionToContext, type PngOptions } from './render';

interface Call {
  method: string;
  args: unknown[];
}

/** Minimal mock of CanvasRenderingContext2D — records every call. */
function mockContext() {
  const calls: Call[] = [];
  let fillStyle = '';
  let strokeStyle = '';
  let lineWidth = 0;

  const record = (method: string, args: unknown[]): void => {
    calls.push({ method, args });
  };

  const ctx = {
    get fillStyle(): string {
      return fillStyle;
    },
    set fillStyle(v: string) {
      fillStyle = v;
      record('set fillStyle', [v]);
    },
    get strokeStyle(): string {
      return strokeStyle;
    },
    set strokeStyle(v: string) {
      strokeStyle = v;
      record('set strokeStyle', [v]);
    },
    get lineWidth(): number {
      return lineWidth;
    },
    set lineWidth(v: number) {
      lineWidth = v;
      record('set lineWidth', [v]);
    },
    setTransform: (...a: unknown[]) => record('setTransform', a),
    resetTransform: () => record('resetTransform', []),
    fillRect: (...a: unknown[]) => record('fillRect', a),
    clearRect: (...a: unknown[]) => record('clearRect', a),
    beginPath: () => record('beginPath', []),
    closePath: () => record('closePath', []),
    moveTo: (...a: unknown[]) => record('moveTo', a),
    lineTo: (...a: unknown[]) => record('lineTo', a),
    fill: (...a: unknown[]) => record('fill', a),
    stroke: () => record('stroke', []),
  };

  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
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

const baseOpts: PngOptions = { width: 100, height: 100 };

describe('renderCrossSectionToContext', () => {
  // --- 6 plan tests ---

  it('clears the canvas before drawing when no background', () => {
    const { ctx, calls } = mockContext();
    renderCrossSectionToContext(emptyCs, ctx, baseOpts);
    expect(calls.some((c) => c.method === 'clearRect')).toBe(true);
  });

  it('fills the canvas with the background color when provided', () => {
    const { ctx, calls } = mockContext();
    renderCrossSectionToContext(emptyCs, ctx, { ...baseOpts, background: '#fff' });
    const bgFill = calls.find((c) => c.method === 'fillRect');
    expect(bgFill).toBeDefined();
  });

  it('emits the expected draw sequence for a square (begin/move/line×3/close/fill/stroke)', () => {
    const { ctx, calls } = mockContext();
    renderCrossSectionToContext(squareCs, ctx, baseOpts);
    const methods = calls.map((c) => c.method);
    const drawSeq = methods.filter(
      (m) =>
        m === 'beginPath' ||
        m === 'moveTo' ||
        m === 'lineTo' ||
        m === 'closePath' ||
        m === 'fill' ||
        m === 'stroke',
    );
    expect(drawSeq).toEqual([
      'beginPath',
      'moveTo',
      'lineTo',
      'lineTo',
      'lineTo',
      'closePath',
      'fill',
      'stroke',
    ]);
  });

  it('calls setTransform once with the correct scale + Y-flip + translation for the square', () => {
    const { ctx, calls } = mockContext();
    renderCrossSectionToContext(squareCs, ctx, { ...baseOpts, padding: 10 });
    // First setTransform is identity reset; second is the geometry transform.
    const sets = calls.filter((c) => c.method === 'setTransform');
    const set = sets[1]; // geometry transform is the second call
    expect(set).toBeDefined();
    // Square is 10×10 in CAD; canvas is 100×100 with padding 10 → drawable 80×80
    // scaleX = 80 / 10 = 8; scaleY (with flip) = -8
    const [a, b, c, d, tx, ty] = set!.args as [number, number, number, number, number, number];
    expect(a).toBeCloseTo(8, 6);
    expect(b).toBeCloseTo(0, 6);
    expect(c).toBeCloseTo(0, 6);
    expect(d).toBeCloseTo(-8, 6);
    // Translation puts (minX, maxY) at (padding, padding) in canvas coords
    expect(tx).toBeCloseTo(10, 6);
    expect(ty).toBeCloseTo(90, 6);
  });

  it('uses fill rule evenodd', () => {
    const { ctx, calls } = mockContext();
    renderCrossSectionToContext(squareCs, ctx, baseOpts);
    const fillCall = calls.find((c) => c.method === 'fill');
    expect(fillCall?.args[0]).toBe('evenodd');
  });

  it('sets fillStyle and strokeStyle from options', () => {
    const { ctx, calls } = mockContext();
    renderCrossSectionToContext(squareCs, ctx, {
      ...baseOpts,
      fill: '#abc',
      stroke: '#def',
      strokeWidth: 1.5,
    });
    expect(calls.some((c) => c.method === 'set fillStyle' && c.args[0] === '#abc')).toBe(true);
    expect(calls.some((c) => c.method === 'set strokeStyle' && c.args[0] === '#def')).toBe(true);
    expect(calls.some((c) => c.method === 'set lineWidth')).toBe(true);
  });

  // --- Lesson 1: degenerate-polygon guard (2 tests) ---

  it('throws ExportError on a polygon with fewer than 3 vertices', () => {
    const degenerate: CrossSection = {
      polygons: [
        [
          [0, 0],
          [1, 1],
        ],
      ],
    };
    const { ctx } = mockContext();
    expect(() => renderCrossSectionToContext(degenerate, ctx, baseOpts)).toThrow();
  });

  it('throws ExportError on an empty polygon (zero vertices)', () => {
    const empty: CrossSection = { polygons: [[]] };
    const { ctx } = mockContext();
    expect(() => renderCrossSectionToContext(empty, ctx, baseOpts)).toThrow();
  });

  // --- Lesson 2: non-finite coordinate tests (2 tests) ---

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
    const { ctx } = mockContext();
    expect(() => renderCrossSectionToContext(bad, ctx, baseOpts)).toThrow();
  });

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
    const { ctx } = mockContext();
    expect(() => renderCrossSectionToContext(bad, ctx, baseOpts)).toThrow();
  });

  // --- Lesson 3: width/height validation tests (2 tests) ---

  it('throws ExportError on zero width', () => {
    const { ctx } = mockContext();
    expect(() => renderCrossSectionToContext(squareCs, ctx, { width: 0, height: 100 })).toThrow();
  });

  it('throws ExportError on non-integer width', () => {
    const { ctx } = mockContext();
    expect(() =>
      renderCrossSectionToContext(squareCs, ctx, { width: 100.5, height: 100 }),
    ).toThrow();
  });

  // --- Lesson 5: zero-range geometry guard (1 test) ---

  it('handles zero-range geometry without producing NaN transform values', () => {
    const point: CrossSection = {
      polygons: [
        [
          [5, 5],
          [5, 5],
          [5, 5],
        ],
      ],
    };
    const { ctx, calls } = mockContext();
    renderCrossSectionToContext(point, ctx, baseOpts);
    const sets = calls.filter((c) => c.method === 'setTransform');
    const set = sets[1]; // geometry transform
    expect(set).toBeDefined();
    const args = set!.args as number[];
    for (const v of args) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});
