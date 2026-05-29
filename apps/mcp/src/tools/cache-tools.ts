import type { Ctx } from '../context';
import type { ToolResult } from './library-tools';

export async function clearCache(
  ctx: Ctx,
  _args: Record<string, never>,
): Promise<ToolResult<{ ok: true }>> {
  try {
    await ctx.engine.clearCache();
    return { ok: true, data: { ok: true } };
  } catch (e) {
    return {
      ok: false,
      error: { code: 'cache-clear-failed', message: (e as Error).message },
    };
  }
}
