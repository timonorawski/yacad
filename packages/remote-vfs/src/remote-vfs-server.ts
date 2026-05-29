import type { Vfs } from '@yacad/vfs';
import type { WebSocketServer, WebSocket as NodeWebSocket } from 'ws';
import type {
  EventType,
  RpcErr,
  RpcOk,
  RpcRequest,
  ServerEvent,
  WsFrame,
} from './protocol';

export interface RemoteVfsServerOptions {
  /** Underlying VFS this server proxies to. */
  readonly vfs: Vfs;
  /**
   * When true, `vfs.write` and `vfs.delete` requests are rejected with
   * `viewer-read-only`. v1 sets this true for studio2 viewer connections.
   */
  readonly readOnly?: boolean;
}

/**
 * Serves a `Vfs` over an existing `ws` WebSocketServer. Also exposes a
 * `broadcast(event)` so the MCP app can fan doc-change events to all clients.
 *
 * One server instance handles many concurrent client sockets. Per-socket state
 * is held in the `clients` set; broadcasts iterate it.
 */
export class RemoteVfsServer {
  private readonly clients = new Set<NodeWebSocket>();

  constructor(private readonly options: RemoteVfsServerOptions) {}

  /** Attach this server to a `ws` WebSocketServer's `connection` event. */
  attach(wss: WebSocketServer): void {
    wss.on('connection', (socket) => this.onConnection(socket));
  }

  /** Send an event to every connected client. */
  broadcast(type: EventType, payload: unknown): void {
    const frame: ServerEvent = { kind: 'event', type, payload };
    const data = JSON.stringify(frame);
    for (const client of this.clients) {
      if (client.readyState === client.OPEN) client.send(data);
    }
  }

  /** Number of currently connected clients (for testing). */
  get clientCount(): number {
    return this.clients.size;
  }

  private onConnection(socket: NodeWebSocket): void {
    this.clients.add(socket);
    socket.on('close', () => this.clients.delete(socket));
    socket.on('error', () => this.clients.delete(socket));
    socket.on('message', (raw) => {
      let frame: WsFrame;
      try {
        frame = JSON.parse(raw.toString()) as WsFrame;
      } catch {
        return; // malformed; ignore
      }
      if (frame.kind !== 'request') return;
      void this.handle(socket, frame);
    });
  }

  private async handle(socket: NodeWebSocket, req: RpcRequest): Promise<void> {
    try {
      const result = await this.dispatch(req);
      const res: RpcOk = { id: req.id, kind: 'response', ok: true, result };
      socket.send(JSON.stringify(res));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code: unknown }).code)
          : 'internal';
      const res: RpcErr = {
        id: req.id,
        kind: 'response',
        ok: false,
        error: { code, message },
      };
      socket.send(JSON.stringify(res));
    }
  }

  private async dispatch(req: RpcRequest): Promise<unknown> {
    const params = req.params as Record<string, unknown>;
    switch (req.method) {
      case 'vfs.read': {
        const bytes = await this.options.vfs.read(params['key'] as string);
        return bytes ? { base64: bytesToBase64(bytes) } : null;
      }
      case 'vfs.write': {
        if (this.options.readOnly) {
          throw vfsReadOnlyError();
        }
        const bytes = base64ToBytes(params['base64'] as string);
        await this.options.vfs.write(params['key'] as string, bytes);
        return { ok: true };
      }
      case 'vfs.delete': {
        if (this.options.readOnly) {
          throw vfsReadOnlyError();
        }
        await this.options.vfs.delete(params['key'] as string);
        return { ok: true };
      }
      case 'vfs.list': {
        return await this.options.vfs.list(params['prefix'] as string);
      }
      case 'library.list':
      case 'library.openSession':
        // These two are handled by the MCP app's own RPC layer (see
        // apps/mcp/src/http-server.ts), not by this VFS server. They land here
        // only if mis-routed; surface a clear error.
        throw Object.assign(new Error(`method ${req.method} not handled by RemoteVfsServer`), {
          code: 'not-implemented',
        });
    }
  }
}

function vfsReadOnlyError(): Error & { code: string } {
  const e = new Error('viewer is read-only in this connection');
  return Object.assign(e, { code: 'viewer-read-only' });
}

function bytesToBase64(bytes: Uint8Array): string {
  // Node-side server: Buffer is available. Browsers never run this code path.
  return Buffer.from(bytes).toString('base64');
}

function base64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}
