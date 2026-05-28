import type { CrossSection } from '@yacad/geometry';

export interface SvgOptions {
  readonly width?: number;
  readonly height?: number;
  readonly padding?: number;
  readonly stroke?: string;
  readonly fill?: string;
  readonly strokeWidth?: number;
  readonly background?: string | null;
}

export class ExportError extends Error {
  override readonly name = 'ExportError';
}

const DEFAULT_PADDING = 10;
const DEFAULT_STROKE = '#000';
const DEFAULT_FILL = '#88aacc';
const DEFAULT_STROKE_WIDTH = 0.5;
const DEFAULT_MAX_PIXELS = 800;

/**
 * Serialize a CrossSection to an SVG document. Multiple polygons collapse into
 * one <path> element with fill-rule="evenodd" so Manifold's CW-hole convention
 * renders correctly. Y axis is flipped from CAD Y-up to SVG Y-down via a
 * negated viewBox.
 */
export function crossSectionToSvg(cs: CrossSection, opts: SvgOptions = {}): Uint8Array {
  const padding = opts.padding ?? DEFAULT_PADDING;
  const stroke = opts.stroke ?? DEFAULT_STROKE;
  const fill = opts.fill ?? DEFAULT_FILL;
  const strokeWidth = opts.strokeWidth ?? DEFAULT_STROKE_WIDTH;
  const background = opts.background ?? null;

  validate(cs);

  const bounds = boundsOf(cs);
  // Y-flip: SVG y-axis points down, CAD up. Compute viewBox in flipped space.
  const vbX = bounds.minX - padding;
  const vbY = -bounds.maxY - padding;
  const contentW = bounds.maxX - bounds.minX;
  const contentH = bounds.maxY - bounds.minY;
  const vbW = Math.max(contentW + 2 * padding, 1);
  const vbH = Math.max(contentH + 2 * padding, 1);

  let width = opts.width;
  let height = opts.height;
  if (width === undefined && height === undefined) {
    const scale = DEFAULT_MAX_PIXELS / Math.max(vbW, vbH);
    width = Math.round(vbW * scale);
    height = Math.round(vbH * scale);
  } else if (width === undefined) {
    width = Math.round((height! / vbH) * vbW);
  } else if (height === undefined) {
    height = Math.round((width / vbW) * vbH);
  }

  const pathData = buildPathData(cs);

  const lines: string[] = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" width="${width}" height="${height}">`,
  );
  if (background !== null) {
    lines.push(
      `  <rect x="${vbX}" y="${vbY}" width="${vbW}" height="${vbH}" fill="${xmlEscape(background)}"/>`,
    );
  }
  lines.push(
    `  <path d="${pathData}" fill="${xmlEscape(fill)}" fill-rule="evenodd" stroke="${xmlEscape(stroke)}" stroke-width="${strokeWidth}"/>`,
  );
  lines.push('</svg>');

  return new TextEncoder().encode(lines.join('\n') + '\n');
}

/** Escape XML special characters in string attribute values. */
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Operates on already-validated polygons (validate() guarantees ≥3 vertices each). */
function buildPathData(cs: CrossSection): string {
  const parts: string[] = [];
  for (const polygon of cs.polygons) {
    const [firstX, firstY] = polygon[0]!;
    parts.push(`M${fmt(firstX)} ${fmt(-firstY)}`);
    for (let i = 1; i < polygon.length; i++) {
      const [x, y] = polygon[i]!;
      parts.push(`L${fmt(x)} ${fmt(-y)}`);
    }
    parts.push('Z');
  }
  return parts.join(' ');
}

function fmt(n: number): string {
  // 4 decimals = sub-100μm precision at mm scale, plenty for vector graphics.
  return Number(n.toFixed(4)).toString();
}

function validate(cs: CrossSection): void {
  for (let p = 0; p < cs.polygons.length; p++) {
    const polygon = cs.polygons[p]!;
    if (polygon.length < 3) {
      throw new ExportError(`polygon ${p} has fewer than 3 vertices (got ${polygon.length})`);
    }
    for (let v = 0; v < polygon.length; v++) {
      const [x, y] = polygon[v]!;
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new ExportError(`non-finite coordinate at polygons[${p}][${v}]`);
      }
    }
  }
}

function boundsOf(cs: CrossSection): { minX: number; minY: number; maxX: number; maxY: number } {
  if (cs.polygons.length === 0) return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const polygon of cs.polygons) {
    for (const [x, y] of polygon) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}
