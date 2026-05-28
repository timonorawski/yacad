import type { NodeDoc } from '@yacad/dag';
import type { WorkerClient } from '@yacad/worker';
import { meshToBinaryStl } from '@yacad/export-stl';
import { crossSectionToSvg } from '@yacad/export-svg';
import { crossSectionToDxf } from '@yacad/export-dxf';
import { crossSectionToPngBrowser } from '@yacad/export-png';
import { getAt } from '@yacad/mutations';

/** Format identifiers used across the export gadget. */
export type ExportFormat = 'stl' | 'svg' | 'dxf' | 'png';

/** Output kind a format consumes — informs which formats are offered. */
export type OutputType = '2d' | '3d';

interface FormatSpec {
  readonly format: ExportFormat;
  readonly label: string;
  readonly outputType: OutputType;
  readonly extension: string;
}

const FORMATS: readonly FormatSpec[] = [
  { format: 'stl', label: 'Export STL', outputType: '3d', extension: 'stl' },
  { format: 'svg', label: 'Export SVG', outputType: '2d', extension: 'svg' },
  { format: 'dxf', label: 'Export DXF', outputType: '2d', extension: 'dxf' },
  { format: 'png', label: 'Export PNG', outputType: '2d', extension: 'png' },
];

/** Formats that can be produced from a node of the given output type. */
export function formatsFor(outputType: OutputType): readonly FormatSpec[] {
  return FORMATS.filter((spec) => spec.outputType === outputType);
}

/**
 * Evaluate the sub-document rooted at `path` and download the result encoded
 * in `format`. The worker performs the evaluation; the encoder lives in
 * `@yacad/export-*`. Throws if the node's actual output type does not match
 * the format (e.g., asking for STL of a 2D node) — the caller is expected to
 * have gated this via `formatsFor`.
 */
export async function runExport(
  client: WorkerClient,
  doc: NodeDoc,
  path: string,
  format: ExportFormat,
  baseName: string,
): Promise<void> {
  const subDoc = getAt(doc, path);
  const outcome = await client.evaluate(subDoc);
  const fileBase = sanitizeFileName(baseName);
  if (format === 'stl') {
    if (outcome.geometry.kind !== '3d') {
      throw new Error(`STL export requires a 3D node, got ${outcome.geometry.kind}`);
    }
    download(meshToBinaryStl(outcome.geometry.mesh), `${fileBase}.stl`, 'application/octet-stream');
    return;
  }
  if (outcome.geometry.kind !== '2d') {
    throw new Error(
      `${format.toUpperCase()} export requires a 2D node, got ${outcome.geometry.kind}`,
    );
  }
  const section = outcome.geometry.section;
  if (format === 'svg') {
    download(crossSectionToSvg(section), `${fileBase}.svg`, 'image/svg+xml');
  } else if (format === 'dxf') {
    download(crossSectionToDxf(section), `${fileBase}.dxf`, 'application/octet-stream');
  } else if (format === 'png') {
    const bytes = await crossSectionToPngBrowser(section, {
      width: 800,
      height: 800,
      background: '#fff',
    });
    download(bytes, `${fileBase}.png`, 'image/png');
  }
}

function download(bytes: Uint8Array, filename: string, mimeType: string): void {
  // Uint8Array<ArrayBufferLike> isn't assignable to BlobPart without
  // narrowing; the encoders produce ArrayBuffer-backed arrays in practice.
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-z0-9._-]+/gi, '_') || 'export';
}
