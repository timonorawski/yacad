/**
 * WS-RPC protocol between the MCP server (host) and a browser studio2 viewer.
 *
 * - Client → server: `Request` frames with correlated `id`. Server replies with
 *   `Response` carrying the same `id`.
 * - Server → client: `Event` frames (no correlation id) for broadcast updates.
 *
 * v1 viewer is read-only; `vfs.write` and `vfs.delete` are part of the
 * protocol for forward compatibility but the server rejects them with the
 * `viewer-read-only` error code when issued by a viewer-class client.
 */

export interface RpcRequest {
  readonly id: number;
  readonly kind: 'request';
  readonly method: RpcMethod;
  readonly params: unknown;
}

export type RpcMethod =
  | 'library.list'
  | 'library.openSession'
  | 'vfs.read'
  | 'vfs.write'
  | 'vfs.list'
  | 'vfs.delete';

export interface RpcOk {
  readonly id: number;
  readonly kind: 'response';
  readonly ok: true;
  readonly result: unknown;
}

export interface RpcErr {
  readonly id: number;
  readonly kind: 'response';
  readonly ok: false;
  readonly error: { readonly code: string; readonly message: string };
}

export type RpcResponse = RpcOk | RpcErr;

export interface ServerEvent {
  readonly kind: 'event';
  readonly type: EventType;
  readonly payload: unknown;
}

export type EventType =
  | 'current-doc-changed'
  | 'doc-changed'
  | 'blob-added'
  | 'meta-changed'
  | 'library-changed';

export type WsFrame = RpcRequest | RpcResponse | ServerEvent;
