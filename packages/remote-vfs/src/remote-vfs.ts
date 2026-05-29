import type { Vfs } from '@yacad/vfs';
import type {
  EventType,
  RpcMethod,
  RpcRequest,
  RpcResponse,
  ServerEvent,
  WsFrame,
} from './protocol';

export interface RemoteVfsOptions {
  /** Full ws:// URL to the MCP server's /ws endpoint. */
  readonly url: string;
  /** Reconnect backoff: starts at this many ms, doubles up to maxBackoffMs. */
  readonly initialBackoffMs?: number;
  /** Reconnect backoff cap. */
  readonly maxBackoffMs?: number;
  /**
   * Constructor for the WebSocket class. Defaults to the platform `WebSocket`
   * in browsers; tests inject `ws.WebSocket` (Node).
   */
  readonly webSocketCtor?: typeof WebSocket;
}

type EventListener = (payload: unknown) => void;

/**
 * Browser-side `Vfs` client that proxies all calls over a single WebSocket
 * to a `RemoteVfsServer`. Also fans out server-pushed events
 * (`current-doc-changed`, `doc-changed`, `blob-added`, ...) to subscribers.
 *
 * Reconnect strategy: exponential backoff. Pending RPCs queued during a
 * disconnect are replayed on reconnect (one-shot reads/lists are safe to
 * replay; writes/deletes in v1 viewer mode are not issued).
 */
export class RemoteVfs implements Vfs {
  private socket: WebSocket | undefined;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private readonly queue: RpcRequest[] = [];
  private readonly eventListeners = new Map<EventType, Set<EventListener>>();
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly webSocketCtor: typeof WebSocket;
  private backoffMs: number;
  private closed = false;

  constructor(opts: RemoteVfsOptions) {
    this.initialBackoffMs = opts.initialBackoffMs ?? 250;
    this.maxBackoffMs = opts.maxBackoffMs ?? 5000;
    this.backoffMs = this.initialBackoffMs;
    this.webSocketCtor =
      opts.webSocketCtor ?? (globalThis.WebSocket as typeof WebSocket);
    this.connect(opts.url);
  }

  /** Subscribe to a server-broadcast event. Returns an unsubscribe function. */
  on(type: EventType, listener: EventListener): () => void {
    let set = this.eventListeners.get(type);
    if (!set) {
      set = new Set();
      this.eventListeners.set(type, set);
    }
    set.add(listener);
    return () => set!.delete(listener);
  }

  /** Permanently close. Pending RPCs reject. */
  close(): void {
    this.closed = true;
    for (const p of this.pending.values()) p.reject(new Error('RemoteVfs closed'));
    this.pending.clear();
    this.socket?.close();
  }

  // --- Vfs interface ---

  async read(key: string): Promise<Uint8Array | undefined> {
    const res = (await this.send('vfs.read', { key })) as { base64: string } | null;
    if (!res) return undefined;
    return base64ToBytes(res.base64);
  }

  async write(key: string, value: Uint8Array): Promise<void> {
    await this.send('vfs.write', { key, base64: bytesToBase64(value) });
  }

  async delete(key: string): Promise<void> {
    await this.send('vfs.delete', { key });
  }

  async list(prefix: string): Promise<readonly string[]> {
    return (await this.send('vfs.list', { prefix })) as string[];
  }

  // --- internal ---

  private send(method: RpcMethod, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    const req: RpcRequest = { id, kind: 'request', method, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      if (this.socket && this.socket.readyState === this.socket.OPEN) {
        this.socket.send(JSON.stringify(req));
      } else {
        // Queue and flush on (re)connect.
        this.queue.push(req);
      }
    });
  }

  private connect(url: string): void {
    if (this.closed) return;
    const ws = new this.webSocketCtor(url);
    this.socket = ws;
    ws.onopen = () => {
      this.backoffMs = this.initialBackoffMs;
      while (this.queue.length > 0) {
        const req = this.queue.shift()!;
        ws.send(JSON.stringify(req));
      }
    };
    ws.onmessage = (ev) => this.onMessage(ev.data);
    ws.onclose = () => {
      if (this.closed) return;
      setTimeout(() => this.connect(url), this.backoffMs);
      this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
    };
    ws.onerror = () => {
      // Let onclose drive reconnect; just close the socket if needed.
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };
  }

  private onMessage(raw: unknown): void {
    let frame: WsFrame;
    try {
      frame = JSON.parse(String(raw)) as WsFrame;
    } catch {
      return;
    }
    if (frame.kind === 'response') this.onResponse(frame);
    else if (frame.kind === 'event') this.onEvent(frame);
  }

  private onResponse(res: RpcResponse): void {
    const p = this.pending.get(res.id);
    if (!p) return;
    this.pending.delete(res.id);
    if (res.ok) p.resolve(res.result);
    else p.reject(Object.assign(new Error(res.error.message), { code: res.error.code }));
  }

  private onEvent(ev: ServerEvent): void {
    const listeners = this.eventListeners.get(ev.type);
    if (!listeners) return;
    for (const listener of listeners) listener(ev.payload);
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  // Browser-friendly: btoa(String.fromCharCode(...bytes)) for small bytes; for
  // large chunks, encode in pieces to avoid argument-count limits.
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return globalThis.btoa ? globalThis.btoa(s) : Buffer.from(bytes).toString('base64');
}

function base64ToBytes(b64: string): Uint8Array {
  if (globalThis.atob) {
    const s = globalThis.atob(b64);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(b64, 'base64'));
}
