import { buildGraph } from '@yacad/dag';
import { computeBBox, triangleCount } from '@yacad/geometry';
import { getAt } from '@yacad/mutations';
import type { Ctx } from '../context';
import { type ToolResult } from './library-tools';

function ok<T>(data: T): ToolResult<T> {
  return { ok: true, data };
}
function err(code: string, message: string, details?: unknown): ToolResult<never> {
  return {
    ok: false,
    error: details === undefined ? { code, message } : { code, message, details },
  };
}

function requireSession(ctx: Ctx) {
  if (!ctx.currentDocId) return undefined;
  return ctx.sessions.get(ctx.currentDocId);
}

export async function getDoc(
  ctx: Ctx,
  _args: Record<string, never>,
): Promise<ToolResult<unknown>> {
  const s = requireSession(ctx);
  if (!s) return err('no-current-doc', 'no current doc; call createDoc or openDoc first');
  return ok(s.doc);
}

export async function getNodeAt(
  ctx: Ctx,
  args: { path: string },
): Promise<
  ToolResult<{ type: string; params: unknown; childCount: number; outputType?: '2d' | '3d' }>
> {
  const s = requireSession(ctx);
  if (!s) return err('no-current-doc', 'no current doc');
  try {
    const node = getAt(s.doc, args.path);
    // outputType requires a built graph; we don't build it here to keep this
    // cheap. evaluate() gives the engineer the full breakdown.
    return ok({
      type: node.type,
      params: node.params ?? {},
      childCount: (node.children ?? []).length,
    });
  } catch (e) {
    return err('bad-path', (e as Error).message);
  }
}

export async function evaluate(
  ctx: Ctx,
  args: { tier?: string; includePerNode?: boolean },
): Promise<
  ToolResult<{
    bbox: { min: [number, number, number]; max: [number, number, number] } | null;
    triangleCount: number;
    stats: {
      hits: number;
      misses: number;
      totalMs: number;
      lookupMs: number;
      kernelMs: number;
    };
    perNode?: readonly unknown[];
  }>
> {
  const s = requireSession(ctx);
  if (!s) return err('no-current-doc', 'no current doc');
  try {
    const graph = await buildGraph(s.doc, undefined, '$', {
      get: (h) => ctx.luaDefs.get(h) ?? ctx.meshBlobs.get(h),
    });
    const result = await ctx.engine.evaluate(graph, args.tier ?? 'final');
    const geom = result.geometry;
    let bbox: { min: [number, number, number]; max: [number, number, number] } | null = null;
    let tris = 0;
    if (geom.kind === '3d') {
      const bb = computeBBox(geom.mesh);
      if (bb) {
        bbox = {
          min: [bb.min[0], bb.min[1], bb.min[2]],
          max: [bb.max[0], bb.max[1], bb.max[2]],
        };
      }
      tris = triangleCount(geom.mesh);
    }
    return ok({
      bbox,
      triangleCount: tris,
      stats: {
        hits: result.stats.hits,
        misses: result.stats.misses,
        totalMs: result.stats.totalMs,
        lookupMs: result.stats.lookupMs,
        kernelMs: result.stats.kernelMs,
      },
      ...(args.includePerNode ? { perNode: result.perNode } : {}),
    });
  } catch (e) {
    return err('eval-failed', (e as Error).message);
  }
}
