import { canonicalBytes } from '@yacad/canonical';
import { defaultHasher } from '@yacad/hash';
import { LuaValidationError, validateLuaSource, type LuaDefinition } from '@yacad/lua';
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

export async function addLuaDefinition(
  ctx: Ctx,
  args: { schema: LuaDefinition['schema']; code: string },
): Promise<ToolResult<{ hash: string }>> {
  const def: LuaDefinition = { schema: args.schema, code: args.code };
  try {
    validateLuaSource(def);
  } catch (e) {
    if (e instanceof LuaValidationError) {
      return err('lua-validation', 'Lua validation failed', { issues: e.issues });
    }
    return err('lua-validation', (e as Error).message);
  }
  const bytes = canonicalBytes(def);
  const hash = await defaultHasher.hash(bytes);
  ctx.luaDefs.set(hash, def);
  // Also persist the bytes into the current session's blob set if one is open,
  // so the def lives with the doc when saved.
  if (ctx.currentDocId) {
    const session = ctx.sessions.get(ctx.currentDocId);
    if (session) {
      try {
        await session.addBlob(bytes);
      } catch (e) {
        return err('blob-persist-failed', (e as Error).message);
      }
    }
  }
  return ok({ hash });
}

export async function validateLuaCode(
  _ctx: Ctx,
  args: { schema: LuaDefinition['schema']; code: string },
): Promise<ToolResult<{ issues: unknown[] }>> {
  const def: LuaDefinition = { schema: args.schema, code: args.code };
  try {
    validateLuaSource(def);
    return ok({ issues: [] });
  } catch (e) {
    if (e instanceof LuaValidationError) {
      return ok({ issues: e.issues as unknown[] });
    }
    // Non-validation error: surface as a tool error since it's unexpected.
    return err('lua-validation-internal', (e as Error).message);
  }
}
