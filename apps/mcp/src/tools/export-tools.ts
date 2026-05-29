import { buildGraph } from '@yacad/dag';
import { meshToBinaryStl } from '@yacad/export-stl';
import { crossSectionToSvg } from '@yacad/export-svg';
import { crossSectionToDxf } from '@yacad/export-dxf';
import { crossSectionToPngNode } from '@yacad/export-png';
import { getAt } from '@yacad/mutations';
import type { Ctx } from '../context';
import type { ToolResult } from './library-tools';

function ok<T>(data: T): ToolResult<T> {
  return { ok: true, data };
}
function err(code: string, message: string, details?: unknown): ToolResult<never> {
  return {
    ok: false,
    error: details === undefined ? { code, message } : { code, message, details },
  };
}

async function evalAtPath(ctx: Ctx, path: string | undefined) {
  const id = ctx.currentDocId;
  if (!id) throw new Error('no current doc');
  const session = ctx.sessions.get(id);
  if (!session) throw new Error('session not open');
  const sub = path && path !== '$' ? getAt(session.doc, path) : session.doc;
  const graph = await buildGraph(sub, undefined, '$', {
    get: (h) => ctx.luaDefs.get(h) ?? ctx.meshBlobs.get(h),
  });
  return ctx.engine.evaluate(graph, 'final');
}

function safeName(s: string): string {
  return s.replace(/[^a-z0-9._-]+/gi, '_') || 'export';
}

function fileBase(ctx: Ctx, path: string | undefined): string {
  const id = ctx.currentDocId!;
  const session = ctx.sessions.get(id)!;
  const safe = safeName(session.meta.name || 'document');
  const suffix = path && path !== '$' ? path.replace(/\$/g, '').replace(/\//g, '-') : '';
  return `${safe}${suffix}`;
}

export async function exportStl(
  ctx: Ctx,
  args: { path?: string },
): Promise<ToolResult<{ filename: string; base64: string }>> {
  if (!ctx.currentDocId) return err('no-current-doc', 'no current doc');
  try {
    const result = await evalAtPath(ctx, args.path);
    if (result.geometry.kind !== '3d') {
      return err('wrong-geometry-kind', `STL requires a 3D node, got ${result.geometry.kind}`);
    }
    const bytes = meshToBinaryStl(result.geometry.mesh);
    return ok({
      filename: `${fileBase(ctx, args.path)}.stl`,
      base64: Buffer.from(bytes).toString('base64'),
    });
  } catch (e) {
    return err('export-failed', (e as Error).message);
  }
}

export async function exportSvg(
  ctx: Ctx,
  args: { path?: string },
): Promise<ToolResult<{ filename: string; base64: string }>> {
  if (!ctx.currentDocId) return err('no-current-doc', 'no current doc');
  try {
    const result = await evalAtPath(ctx, args.path);
    if (result.geometry.kind !== '2d') {
      return err('wrong-geometry-kind', `SVG requires a 2D node, got ${result.geometry.kind}`);
    }
    const bytes = crossSectionToSvg(result.geometry.section);
    return ok({
      filename: `${fileBase(ctx, args.path)}.svg`,
      base64: Buffer.from(bytes).toString('base64'),
    });
  } catch (e) {
    return err('export-failed', (e as Error).message);
  }
}

export async function exportDxf(
  ctx: Ctx,
  args: { path?: string },
): Promise<ToolResult<{ filename: string; base64: string }>> {
  if (!ctx.currentDocId) return err('no-current-doc', 'no current doc');
  try {
    const result = await evalAtPath(ctx, args.path);
    if (result.geometry.kind !== '2d') {
      return err('wrong-geometry-kind', `DXF requires a 2D node, got ${result.geometry.kind}`);
    }
    const bytes = crossSectionToDxf(result.geometry.section);
    return ok({
      filename: `${fileBase(ctx, args.path)}.dxf`,
      base64: Buffer.from(bytes).toString('base64'),
    });
  } catch (e) {
    return err('export-failed', (e as Error).message);
  }
}

export async function exportPng(
  ctx: Ctx,
  args: { path?: string; opts?: { width: number; height: number; background?: string } },
): Promise<ToolResult<{ filename: string; base64: string }>> {
  if (!ctx.currentDocId) return err('no-current-doc', 'no current doc');
  try {
    const result = await evalAtPath(ctx, args.path);
    if (result.geometry.kind !== '2d') {
      return err('wrong-geometry-kind', `PNG requires a 2D node, got ${result.geometry.kind}`);
    }
    const bytes = crossSectionToPngNode(result.geometry.section, {
      width: args.opts?.width ?? 800,
      height: args.opts?.height ?? 800,
      background: args.opts?.background ?? '#ffffff',
    });
    return ok({
      filename: `${fileBase(ctx, args.path)}.png`,
      base64: Buffer.from(bytes).toString('base64'),
    });
  } catch (e) {
    return err('export-failed', (e as Error).message);
  }
}
