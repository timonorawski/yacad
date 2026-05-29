import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket as NodeWebSocket } from 'ws';
import { RemoteVfsServer } from '@yacad/remote-vfs';
import { FilesystemVfs } from '@yacad/vfs-fs';
import type { ViewerHandle } from './context';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json',
};

const LOCALHOST_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export interface HttpServerOptions {
  readonly port: number;
  /** Bind address. Non-localhost binding turns on token enforcement. */
  readonly host: string;
  readonly libraryDir: string;
}

export interface HttpServerHandle {
  readonly vfsServer: RemoteVfsServer;
  readonly viewer: ViewerHandle;
  close(): Promise<void>;
}

const HERE = dirname(fileURLToPath(import.meta.url));
const STUDIO_DIST = resolve(HERE, '../../studio2/dist');

function newToken(): string {
  // 16 random bytes → 32 hex chars; URL-safe by construction.
  return randomBytes(16).toString('hex');
}

export async function startHttpServer(opts: HttpServerOptions): Promise<HttpServerHandle> {
  const needsToken = !LOCALHOST_HOSTS.has(opts.host);
  let token: string | undefined = needsToken ? newToken() : undefined;

  const vfs = new FilesystemVfs({ rootDir: opts.libraryDir });
  const vfsServer = new RemoteVfsServer({ vfs, readOnly: true });

  const http = createServer(async (req, res) => {
    if (!req.url) {
      res.writeHead(400);
      return res.end();
    }
    const url = new URL(req.url, `http://${opts.host}:${opts.port}`);
    // Token enforcement on HTTP: required for every request when in token mode.
    if (token !== undefined && url.searchParams.get('token') !== token) {
      res.writeHead(401, { 'content-type': 'text/plain' });
      return res.end('unauthorized');
    }
    let path = url.pathname;
    if (path === '/') path = '/index.html';
    const fsPath = join(STUDIO_DIST, path);
    try {
      const s = await stat(fsPath);
      if (!s.isFile()) throw new Error('not a file');
      const bytes = await readFile(fsPath);
      const type = MIME[extname(fsPath)] ?? 'application/octet-stream';
      res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
      return res.end(bytes);
    } catch {
      res.writeHead(404);
      return res.end('not found');
    }
  });

  // WS is mounted manually (noServer + handleUpgrade) so we can inspect the
  // upgrade URL's query string for the token before accepting the socket.
  const wss = new WebSocketServer({ noServer: true });
  http.on('upgrade', (req, socket, head) => {
    if (!req.url) {
      socket.destroy();
      return;
    }
    const url = new URL(req.url, `http://${opts.host}:${opts.port}`);
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    if (token !== undefined && url.searchParams.get('token') !== token) {
      // Close with policy-violation code per RFC 6455 (4001 is in the private range).
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  vfsServer.attach(wss);

  await new Promise<void>((resolveListen) =>
    http.listen(opts.port, opts.host, () => resolveListen()),
  );

  const buildUrl = (): string => {
    const tokenSuffix = token !== undefined ? `&token=${token}` : '';
    return (
      `http://${opts.host}:${opts.port}/` +
      `?backend=remote&ws=ws://${opts.host}:${opts.port}/ws${tokenSuffix}`
    );
  };

  const viewer: ViewerHandle = {
    url: buildUrl,
    currentToken: () => token,
    rotateToken: () => {
      if (token === undefined) {
        const e = new Error(
          'rotateAccessToken is not applicable: the server is bound to a localhost-only host. Re-launch with --host to enable token mode.',
        );
        (e as Error & { code?: string }).code = 'not-applicable';
        throw e;
      }
      token = newToken();
      // Drop every existing socket; they'll reconnect with the new URL.
      for (const client of wss.clients) {
        if (client.readyState === NodeWebSocket.OPEN) client.close(4001, 'token rotated');
      }
      return token;
    },
  };

  return {
    vfsServer,
    viewer,
    async close() {
      await new Promise<void>((res) => wss.close(() => res()));
      await new Promise<void>((res) => http.close(() => res()));
    },
  };
}
