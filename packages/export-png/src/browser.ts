import type { CrossSection } from '@yacad/geometry';
import { ExportError } from './errors';
import { renderCrossSectionToContext, type PngOptions } from './render';

/**
 * Browser-side PNG export — uses OffscreenCanvas for the canvas surface and
 * convertToBlob for byte extraction. Studio uses this at runtime.
 */
export async function crossSectionToPngBrowser(
  cs: CrossSection,
  opts: PngOptions,
): Promise<Uint8Array> {
  if (
    !Number.isInteger(opts.width) ||
    opts.width <= 0 ||
    !Number.isInteger(opts.height) ||
    opts.height <= 0
  ) {
    throw new ExportError('width and height must be positive integers');
  }
  const canvas = new OffscreenCanvas(opts.width, opts.height);
  const ctx = canvas.getContext('2d');
  if (ctx === null) {
    throw new ExportError('failed to acquire 2d context from OffscreenCanvas');
  }
  renderCrossSectionToContext(cs, ctx as unknown as CanvasRenderingContext2D, opts);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}
