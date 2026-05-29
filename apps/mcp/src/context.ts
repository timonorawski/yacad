import type { DocLibrary, DocSession } from '@yacad/doc-store';
import type { Engine } from '@yacad/engine';
import type { LuaDefinition } from '@yacad/lua';
import type { RemoteVfsServer } from '@yacad/remote-vfs';

/**
 * Shared mutable state for tool handlers. The MCP server instantiates one Ctx
 * at startup and passes it to every tool dispatch.
 *
 * `currentDocId` is the doc the viewer focuses on; mutation tools target it
 * unless they take an explicit doc id. The open `sessions` map keeps multiple
 * sessions live so `setCurrentDoc` is cheap.
 *
 * `viewer` is populated by the HTTP+WS server when it starts (Task 16); it
 * exposes the URL-builder and the token-rotation function the server tools
 * call. Undefined when running with --no-viewer.
 */
export interface ViewerHandle {
  /** Returns the current viewer URL with the active token (if any). */
  url(): string;
  /** Returns the current access token, or undefined for localhost-only mode. */
  currentToken(): string | undefined;
  /**
   * Generates a new random token, invalidates the old one, drops every
   * connected WS client (they will reconnect using the new URL). Returns the
   * new token. Throws with code `not-applicable` when called on a localhost-
   * only server (no token mode is active).
   */
  rotateToken(): string;
}

export interface Ctx {
  readonly library: DocLibrary;
  readonly engine: Engine;
  readonly luaDefs: Map<string, LuaDefinition>;
  readonly meshBlobs: Map<string, Uint8Array>;
  readonly sessions: Map<string, DocSession>;
  currentDocId: string | undefined;
  vfsServer: RemoteVfsServer | undefined;
  viewer: ViewerHandle | undefined;
}
