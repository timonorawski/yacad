import { DagError } from '@yacad/dag';
import {
  addChild as mAddChild,
  moveChild as mMoveChild,
  removeAt as mRemoveAt,
  replaceAt as mReplaceAt,
  setParam as mSetParam,
  setParams as mSetParams,
  unwrap as mUnwrap,
  wrapWith as mWrapWith,
} from '@yacad/mutations';
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

function withSession(ctx: Ctx) {
  const id = ctx.currentDocId;
  if (!id) return undefined;
  return ctx.sessions.get(id);
}

function mapMutationError(e: unknown): ToolResult<never> {
  if (e instanceof DagError) {
    return err('dag-validation', e.message, { path: e.path });
  }
  return err('mutation-failed', (e as Error).message);
}

async function applyMutation<T>(
  ctx: Ctx,
  f: (prev: never) => never,
  build: () => T,
): Promise<ToolResult<T>> {
  const s = withSession(ctx);
  if (!s) return err('no-current-doc', 'no current doc');
  try {
    await s.mutate(f as never);
    return ok(build());
  } catch (e) {
    return mapMutationError(e);
  }
}

/**
 * Compose `mutations.moveChild`'s `toPath` from the tool's ergonomic
 * `{destParentPath, destIndex}` args, compensating for same-parent forward
 * moves where the removal shifts subsequent indices down by 1.
 *
 *   srcPath='$/0', destParentPath='$', destIndex=2  →  toPath='$/1'
 *   srcPath='$/2', destParentPath='$', destIndex=0  →  toPath='$/0' (no shift)
 *   srcPath='$/0/1', destParentPath='$', destIndex=0  →  toPath='$/0' (different parent)
 */
function buildMoveDestPath(srcPath: string, destParentPath: string, destIndex: number): string {
  let adjusted = destIndex;
  const srcParts = srcPath.split('/');
  const destParentParts = destParentPath.split('/');
  if (
    srcParts.length === destParentParts.length + 1 &&
    srcParts.slice(0, -1).join('/') === destParentParts.join('/')
  ) {
    const srcIndex = Number(srcParts[srcParts.length - 1]);
    if (Number.isFinite(srcIndex) && srcIndex < destIndex) adjusted -= 1;
  }
  return destParentPath === '$' ? `$/${adjusted}` : `${destParentPath}/${adjusted}`;
}

export async function addChild(
  ctx: Ctx,
  args: { parentPath: string; nodeDoc: unknown; insertAt?: number },
): Promise<ToolResult<{ ok: true }>> {
  return applyMutation(
    ctx,
    (prev) => mAddChild(prev, args.parentPath, args.nodeDoc as never, args.insertAt) as never,
    () => ({ ok: true as const }),
  );
}

export async function wrapWith(
  ctx: Ctx,
  args: { path: string; type: string; params?: Record<string, unknown> },
): Promise<ToolResult<{ ok: true }>> {
  return applyMutation(
    ctx,
    // mWrapWith signature: (doc, path, wrapperType, wrapperParams?) — 4 positional args.
    (prev) => mWrapWith(prev, args.path, args.type, args.params ?? {}) as never,
    () => ({ ok: true as const }),
  );
}

export async function unwrap(
  ctx: Ctx,
  args: { path: string },
): Promise<ToolResult<{ ok: true }>> {
  return applyMutation(
    ctx,
    (prev) => mUnwrap(prev, args.path) as never,
    () => ({ ok: true as const }),
  );
}

export async function removeAt(
  ctx: Ctx,
  args: { path: string },
): Promise<ToolResult<{ ok: true }>> {
  return applyMutation(
    ctx,
    (prev) => mRemoveAt(prev, args.path) as never,
    () => ({ ok: true as const }),
  );
}

export async function moveChild(
  ctx: Ctx,
  args: { srcPath: string; destParentPath: string; destIndex: number },
): Promise<ToolResult<{ ok: true }>> {
  return applyMutation(
    ctx,
    // mMoveChild signature: (doc, fromPath, toPath) — 3 positional args.
    // Compose toPath from destParentPath + destIndex with same-parent compensation.
    (prev) => {
      const toPath = buildMoveDestPath(args.srcPath, args.destParentPath, args.destIndex);
      return mMoveChild(prev, args.srcPath, toPath) as never;
    },
    () => ({ ok: true as const }),
  );
}

export async function replaceAt(
  ctx: Ctx,
  args: { path: string; newDoc: unknown },
): Promise<ToolResult<{ ok: true }>> {
  return applyMutation(
    ctx,
    (prev) => mReplaceAt(prev, args.path, args.newDoc as never) as never,
    () => ({ ok: true as const }),
  );
}

export async function setParam(
  ctx: Ctx,
  args: { path: string; key: string; value: unknown },
): Promise<ToolResult<{ ok: true }>> {
  return applyMutation(
    ctx,
    (prev) => mSetParam(prev, args.path, args.key, args.value) as never,
    () => ({ ok: true as const }),
  );
}

export async function setParams(
  ctx: Ctx,
  args: { path: string; patch: Record<string, unknown> },
): Promise<ToolResult<{ ok: true }>> {
  return applyMutation(
    ctx,
    (prev) => mSetParams(prev, args.path, args.patch) as never,
    () => ({ ok: true as const }),
  );
}
