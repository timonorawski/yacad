import type { Ctx } from '../context';
import type { ToolResult } from './library-tools';

function ok<T>(data: T): ToolResult<T> {
  return { ok: true, data };
}
function err(code: string, message: string): ToolResult<never> {
  return { ok: false, error: { code, message } };
}

export async function getViewerUrl(
  ctx: Ctx,
  _args: Record<string, never>,
): Promise<ToolResult<{ url: string }>> {
  if (!ctx.viewer) {
    return err('no-viewer', 'MCP is running with --no-viewer; no HTTP server is bound');
  }
  return ok({ url: ctx.viewer.url() });
}

export async function rotateAccessToken(
  ctx: Ctx,
  _args: Record<string, never>,
): Promise<ToolResult<{ url: string; token: string }>> {
  if (!ctx.viewer) {
    return err('no-viewer', 'MCP is running with --no-viewer; no token to rotate');
  }
  try {
    const token = ctx.viewer.rotateToken();
    return ok({ url: ctx.viewer.url(), token });
  } catch (e) {
    const code = (e as Error & { code?: string }).code ?? 'rotate-failed';
    return err(code, (e as Error).message);
  }
}
