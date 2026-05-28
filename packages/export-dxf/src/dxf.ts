import type { CrossSection } from '@yacad/geometry';

export interface DxfOptions {
  /** Layer name for all emitted entities. Default: '0'. */
  readonly layer?: string;
  /** DXF $INSUNITS code. Default: 4 (millimeters). */
  readonly units?: number;
}

export class ExportError extends Error {
  override readonly name = 'ExportError';
}

/**
 * Serialize a CrossSection to a minimal AutoCAD 2010 (AC1024) DXF file.
 * One LWPOLYLINE entity per polygon, closed, vertex order preserved.
 * Manifold's CCW-outer / CW-hole winding passes through unchanged.
 */
export function crossSectionToDxf(cs: CrossSection, opts: DxfOptions = {}): Uint8Array {
  const layer = opts.layer ?? '0';
  const units = opts.units ?? 4; // millimeters

  // Defensive scan for non-finite coordinates.
  for (let p = 0; p < cs.polygons.length; p++) {
    const polygon = cs.polygons[p]!;
    for (let v = 0; v < polygon.length; v++) {
      const [x, y] = polygon[v]!;
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new ExportError(`non-finite coordinate at polygons[${p}][${v}]`);
      }
    }
  }

  const { minX, minY, maxX, maxY } = boundsOf(cs);

  const lines: string[] = [];
  const emit = (groupCode: number, value: string | number): void => {
    lines.push(String(groupCode), String(value));
  };

  // HEADER
  emit(0, 'SECTION');
  emit(2, 'HEADER');
  emit(9, '$ACADVER');
  emit(1, 'AC1024');
  emit(9, '$INSUNITS');
  emit(70, units);
  emit(9, '$EXTMIN');
  emit(10, fmtNum(minX));
  emit(20, fmtNum(minY));
  emit(30, '0.0');
  emit(9, '$EXTMAX');
  emit(10, fmtNum(maxX));
  emit(20, fmtNum(maxY));
  emit(30, '0.0');
  emit(0, 'ENDSEC');

  // TABLES (one layer)
  emit(0, 'SECTION');
  emit(2, 'TABLES');
  emit(0, 'TABLE');
  emit(2, 'LAYER');
  emit(70, 1);
  emit(0, 'LAYER');
  emit(2, layer);
  emit(70, 0);
  emit(62, 7); // color: white
  emit(6, 'CONTINUOUS');
  emit(0, 'ENDTAB');
  emit(0, 'ENDSEC');

  // ENTITIES
  emit(0, 'SECTION');
  emit(2, 'ENTITIES');
  for (const polygon of cs.polygons) {
    emit(0, 'LWPOLYLINE');
    emit(8, layer);
    emit(90, polygon.length);
    emit(70, 1); // 1 = closed
    for (const [x, y] of polygon) {
      emit(10, fmtNum(x));
      emit(20, fmtNum(y));
    }
  }
  emit(0, 'ENDSEC');

  emit(0, 'EOF');

  // DXF lines are CRLF-terminated by convention; \n also works in modern readers
  // but CRLF is what AutoCAD writes and what some older tools require.
  const text = lines.join('\r\n') + '\r\n';
  return new TextEncoder().encode(text);
}

function boundsOf(cs: CrossSection): { minX: number; minY: number; maxX: number; maxY: number } {
  if (cs.polygons.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
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

/** Format a number for DXF: avoid scientific notation, trim trailing zeros. */
function fmtNum(n: number): string {
  // toFixed(9) gives sub-nanometer precision in mm; trim trailing zeros.
  return n
    .toFixed(9)
    .replace(/0+$/, '')
    .replace(/\.$/, '.0');
}
