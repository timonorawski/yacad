import type { DocSession } from '@yacad/doc-store';
import type { RemoteVfsServer } from '@yacad/remote-vfs';
import type { Ctx } from './context';

/**
 * For each open session in `ctx`, subscribe to its events and forward them
 * over the WS server as `doc-changed` / `meta-changed` / `blob-added`.
 *
 * Idempotent: calling subscribeAll twice on the same session is a no-op
 * because each session keeps a single broadcasting subscriber tagged on it.
 */
const TAG = Symbol('yacad-mcp-broadcast-subscribed');
type Tagged = DocSession & { [TAG]?: true };

export function subscribeSession(session: DocSession, vfsServer: RemoteVfsServer): void {
  const tagged = session as Tagged;
  if (tagged[TAG]) return;
  tagged[TAG] = true;
  // Note: DocSession.subscribe is the existing event API in @yacad/doc-store.
  // It returns an unsubscribe function we discard here — the session lives as
  // long as the MCP process does.
  session.subscribe((ev) => {
    if (ev.kind === 'doc-changed') {
      vfsServer.broadcast('doc-changed', { id: session.id, doc: session.doc });
    } else if (ev.kind === 'meta-changed') {
      vfsServer.broadcast('meta-changed', { id: session.id, meta: session.meta });
    } else if (ev.kind === 'blob-added') {
      const bytes = session.blobs.get(ev.hash);
      if (bytes) {
        vfsServer.broadcast('blob-added', {
          id: session.id,
          hash: ev.hash,
          base64: Buffer.from(bytes).toString('base64'),
        });
      }
    }
  });
}

export function broadcastCurrentDocChanged(ctx: Ctx): void {
  if (!ctx.vfsServer || !ctx.currentDocId) return;
  const session = ctx.sessions.get(ctx.currentDocId);
  if (!session) return;
  ctx.vfsServer.broadcast('current-doc-changed', {
    id: session.id,
    meta: session.meta,
    doc: session.doc,
    blobs: [...session.blobs.entries()].map(([hash, bytes]) => ({
      hash,
      base64: Buffer.from(bytes).toString('base64'),
    })),
  });
}
