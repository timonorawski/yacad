import type { CrossSection } from '@yacad/geometry';
import { ExportError } from './errors';

export interface PngOptions {
  readonly width: number;
  readonly height: number;
  readonly padding?: number;
  readonly stroke?: string;
  readonly fill?: string;
  readonly strokeWidth?: number;
  readonly background?: string | null;
}

const DEFAULT_PADDING = 10;
const DEFAULT_STROKE = '#000';
const DEFAULT_FILL = '#88aacc';
const DEFAULT_STROKE_WIDTH = 0.5;

/**
 * Pure rasterizer: draws a CrossSection onto an existing 2D context. The
 * context can be a browser OffscreenCanvas's 2D context or @napi-rs/canvas's
 * equivalent — the API surface we use is well-supported in both.
 */
export function renderCrossSectionToContext(
  cs: CrossSection,
  ctx: CanvasRenderingContext2D,
  opts: PngOptions,
): void {
  const padding = opts.padding ?? DEFAULT_PADDING;
  const stroke = opts.stroke ?? DEFAULT_STROKE;
  const fill = opts.fill ?? DEFAULT_FILL;
  const strokeWidth = opts.strokeWidth ?? DEFAULT_STROKE_WIDTH;
  const background = opts.background ?? null;

  if (
    !Number.isInteger(opts.width) ||
    opts.width <= 0 ||
    !Number.isInteger(opts.height) ||
    opts.height <= 0
  ) {
    throw new ExportError('width and height must be positive integers');
  }

  // Validates vertex count (≥3) AND finiteness of all coordinates.
  validate(cs);

  // Reset transform to identity for the background pass.
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  if (background !== null) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, opts.width, opts.height);
  } else {
    ctx.clearRect(0, 0, opts.width, opts.height);
  }

  if (cs.polygons.length === 0) {
    return;
  }

  const bounds = boundsOf(cs);
  const contentW = bounds.maxX - bounds.minX;
  const contentH = bounds.maxY - bounds.minY;
  const drawableW = opts.width - 2 * padding;
  const drawableH = opts.height - 2 * padding;

  // Pick a uniform scale so the content fits the drawable area while
  // preserving aspect ratio.
  const scale = Math.min(
    contentW > 0 ? drawableW / contentW : Infinity,
    contentH > 0 ? drawableH / contentH : Infinity,
  );
  // Zero-range geometry (all vertices identical): avoid 0*Infinity = NaN.
  // Fall back to scale=1 and center the single point.
  const effectiveScale = Number.isFinite(scale) ? scale : 1;

  // Center the content in the drawable area.
  const offsetX = padding + (drawableW - contentW * effectiveScale) / 2;
  const offsetY = padding + (drawableH - contentH * effectiveScale) / 2;

  // Build affine transform: scale X, flip Y, translate to align (minX, maxY)
  // in CAD coords to (offsetX, offsetY) in canvas coords.
  //   canvas_x =  effectiveScale * cad_x + tx
  //   canvas_y = -effectiveScale * cad_y + ty
  // At cad_x = minX: canvas_x = offsetX → tx = offsetX - effectiveScale * minX
  // At cad_y = maxY: canvas_y = offsetY → ty = offsetY + effectiveScale * maxY
  const tx = offsetX - effectiveScale * bounds.minX;
  const ty = offsetY + effectiveScale * bounds.maxY;
  ctx.setTransform(effectiveScale, 0, 0, -effectiveScale, tx, ty);

  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = strokeWidth;

  ctx.beginPath();
  for (const polygon of cs.polygons) {
    // validate() guarantees polygon.length >= 3, so no empty-check needed here.
    const [firstX, firstY] = polygon[0]!;
    ctx.moveTo(firstX, firstY);
    for (let i = 1; i < polygon.length; i++) {
      const [x, y] = polygon[i]!;
      ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  ctx.fill('evenodd');
  ctx.stroke();
}

/**
 * Validates that every polygon has at least 3 vertices and that all
 * coordinates are finite. Throws ExportError on the first violation.
 */
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

function boundsOf(cs: CrossSection): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
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
