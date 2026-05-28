import { createCanvas } from '@napi-rs/canvas';
import type { CrossSection } from '@yacad/geometry';
import { ExportError } from './errors';
import { renderCrossSectionToContext, type PngOptions } from './render';

/**
 * Node-side PNG export — uses @napi-rs/canvas for the canvas surface and
 * byte extraction. Intended for tests and CI; runtime in the studio uses
 * the browser wrapper.
 */
export function crossSectionToPngNode(cs: CrossSection, opts: PngOptions): Uint8Array {
  if (
    !Number.isInteger(opts.width) ||
    opts.width <= 0 ||
    !Number.isInteger(opts.height) ||
    opts.height <= 0
  ) {
    throw new ExportError('width and height must be positive integers');
  }
  const canvas = createCanvas(opts.width, opts.height);
  const ctx = canvas.getContext('2d');
  // SKRSContext2D.canvas is napi Canvas (not HTMLCanvasElement), so a direct
  // cast fails the structural check — widen through unknown.
  renderCrossSectionToContext(cs, ctx as unknown as CanvasRenderingContext2D, opts);
  const buffer = canvas.toBuffer('image/png');
  // Buffer is a Uint8Array subclass; return as Uint8Array for API uniformity.
  return new Uint8Array(buffer);
}
