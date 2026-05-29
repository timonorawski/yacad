import type { Ctx } from '../context';

export type ToolResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      readonly error: { readonly code: string; readonly message: string; readonly details?: unknown };
    };

function ok<T>(data: T): ToolResult<T> {
  return { ok: true, data };
}
function err(code: string, message: string, details?: unknown): ToolResult<never> {
  return {
    ok: false,
    error: details === undefined ? { code, message } : { code, message, details },
  };
}

export async function listDocs(
  ctx: Ctx,
  _args: Record<string, never>,
): Promise<ToolResult<readonly { id: string; name: string }[]>> {
  const metas = await ctx.library.list();
  return ok(metas.map((m) => ({ id: m.id, name: m.name })));
}

export async function createDoc(
  ctx: Ctx,
  args: { name: string; initialDoc?: unknown },
): Promise<ToolResult<{ id: string }>> {
  try {
    const session = await ctx.library.create(args.name, args.initialDoc as never);
    ctx.sessions.set(session.id, session);
    ctx.currentDocId = session.id;
    return ok({ id: session.id });
  } catch (e) {
    return err('create-failed', (e as Error).message);
  }
}

export async function openDoc(
  ctx: Ctx,
  args: { id: string },
): Promise<
  ToolResult<{ id: string; name: string; doc: unknown; blobs: { hash: string; base64: string }[] }>
> {
  try {
    let session = ctx.sessions.get(args.id);
    if (!session) {
      session = await ctx.library.open(args.id);
      ctx.sessions.set(args.id, session);
    }
    ctx.currentDocId = args.id;
    const blobs = [...session.blobs.entries()].map(([hash, bytes]) => ({
      hash,
      base64: Buffer.from(bytes).toString('base64'),
    }));
    return ok({ id: session.id, name: session.meta.name, doc: session.doc, blobs });
  } catch (e) {
    const msg = (e as Error).message;
    if (/no document with id/i.test(msg)) {
      return err('not-found', `${args.id}: ${msg}`);
    }
    return err('open-failed', msg);
  }
}

export async function deleteDoc(
  ctx: Ctx,
  args: { id: string },
): Promise<ToolResult<{ ok: true }>> {
  try {
    const session = ctx.sessions.get(args.id);
    if (session) {
      await session.close();
      ctx.sessions.delete(args.id);
    }
    if (ctx.currentDocId === args.id) ctx.currentDocId = undefined;
    await ctx.library.delete(args.id);
    return ok({ ok: true });
  } catch (e) {
    return err('delete-failed', (e as Error).message);
  }
}

export async function setCurrentDoc(
  ctx: Ctx,
  args: { id: string },
): Promise<ToolResult<{ id: string }>> {
  if (!ctx.sessions.has(args.id)) {
    return err('not-open', `session for ${args.id} is not open; call openDoc first`);
  }
  ctx.currentDocId = args.id;
  return ok({ id: args.id });
}
