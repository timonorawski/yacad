import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocketServer, WebSocket as NodeWebSocket } from 'ws';
import { MemoryVfs } from '@yacad/vfs';
import { RemoteVfs } from './remote-vfs';
import { RemoteVfsServer } from './remote-vfs-server';

const ENC = new TextEncoder();
const DEC = new TextDecoder();

describe('RemoteVfs ↔ RemoteVfsServer', () => {
  let wss: WebSocketServer;
  let server: RemoteVfsServer;
  let backingVfs: MemoryVfs;
  let port: number;

  beforeEach(async () => {
    backingVfs = new MemoryVfs();
    server = new RemoteVfsServer({ vfs: backingVfs });
    wss = new WebSocketServer({ port: 0 });
    server.attach(wss);
    // Random port assignment surfaces via the address() call after listen.
    await new Promise<void>((res) => wss.once('listening', () => res()));
    port = (wss.address() as { port: number }).port;
  });

  afterEach(async () => {
    await new Promise<void>((res) => wss.close(() => res()));
  });

  function makeClient(): RemoteVfs {
    return new RemoteVfs({
      url: `ws://127.0.0.1:${port}`,
      // ws's NodeWebSocket is a structural match for the platform WebSocket.
      webSocketCtor: NodeWebSocket as unknown as typeof WebSocket,
    });
  }

  async function flush(): Promise<void> {
    // Tiny tick to let WS events propagate.
    await new Promise<void>((res) => setTimeout(res, 25));
  }

  it('write through the client lands in the backing VFS', async () => {
    const client = makeClient();
    await client.write('/x', ENC.encode('hi'));
    expect(DEC.decode((await backingVfs.read('/x'))!)).toBe('hi');
    client.close();
  });

  it('read returns bytes the backing VFS already holds', async () => {
    await backingVfs.write('/y', ENC.encode('there'));
    const client = makeClient();
    const got = await client.read('/y');
    expect(DEC.decode(got!)).toBe('there');
    client.close();
  });

  it('list returns matching keys', async () => {
    await backingVfs.write('/docs/a', ENC.encode('a'));
    await backingVfs.write('/docs/b', ENC.encode('b'));
    await backingVfs.write('/other', ENC.encode('c'));
    const client = makeClient();
    const keys = await client.list('/docs/');
    expect([...keys].sort()).toEqual(['/docs/a', '/docs/b']);
    client.close();
  });

  it('readOnly server rejects writes with viewer-read-only', async () => {
    await new Promise<void>((res) => wss.close(() => res()));
    server = new RemoteVfsServer({ vfs: backingVfs, readOnly: true });
    wss = new WebSocketServer({ port: 0 });
    server.attach(wss);
    await new Promise<void>((res) => wss.once('listening', () => res()));
    port = (wss.address() as { port: number }).port;

    const client = makeClient();
    await expect(client.write('/x', ENC.encode('nope'))).rejects.toMatchObject({
      code: 'viewer-read-only',
    });
    client.close();
  });

  it('broadcast event reaches an attached listener', async () => {
    const client = makeClient();
    const received: unknown[] = [];
    client.on('doc-changed', (p) => received.push(p));
    // Wait for the client to fully connect before broadcasting; otherwise the
    // broadcast goes to zero clients.
    await flush();
    server.broadcast('doc-changed', { id: 'abc', doc: { type: 'box' } });
    await flush();
    expect(received).toEqual([{ id: 'abc', doc: { type: 'box' } }]);
    client.close();
  });

  it('queued requests issued before connect are flushed on open', async () => {
    const client = makeClient();
    // Fire a request immediately — connection is not yet open.
    const p = client.write('/queued', ENC.encode('q'));
    await p;
    expect(DEC.decode((await backingVfs.read('/queued'))!)).toBe('q');
    client.close();
  });
});
