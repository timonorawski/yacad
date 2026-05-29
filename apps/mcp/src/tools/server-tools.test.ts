import { describe, expect, it } from 'vitest';
import type { Ctx, ViewerHandle } from '../context';
import { getViewerUrl, rotateAccessToken } from './server-tools';

function ctxWithViewer(viewer: ViewerHandle | undefined): Ctx {
  return {
    library: undefined as never,
    engine: undefined as never,
    luaDefs: new Map(),
    meshBlobs: new Map(),
    sessions: new Map(),
    currentDocId: undefined,
    vfsServer: undefined,
    viewer,
  };
}

describe('server tools', () => {
  it('getViewerUrl returns the current URL', async () => {
    const ctx = ctxWithViewer({
      url: () => 'http://localhost:5179/?backend=remote&ws=ws://localhost:5179/ws',
      currentToken: () => undefined,
      rotateToken: () => {
        throw new Error('not called');
      },
    });
    const out = await getViewerUrl(ctx, {});
    expect(out).toEqual({
      ok: true,
      data: { url: 'http://localhost:5179/?backend=remote&ws=ws://localhost:5179/ws' },
    });
  });

  it('getViewerUrl when --no-viewer returns no-viewer', async () => {
    const out = await getViewerUrl(ctxWithViewer(undefined), {});
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('no-viewer');
  });

  it('rotateAccessToken on localhost-only returns not-applicable', async () => {
    const ctx = ctxWithViewer({
      url: () => 'http://localhost:5179/?backend=remote&ws=ws://localhost:5179/ws',
      currentToken: () => undefined,
      rotateToken: () => {
        const e = new Error('localhost-only server has no token');
        (e as Error & { code?: string }).code = 'not-applicable';
        throw e;
      },
    });
    const out = await rotateAccessToken(ctx, {});
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.code).toBe('not-applicable');
  });

  it('rotateAccessToken returns the new url + token when token mode is active', async () => {
    let token = 'old-token-deadbeef';
    const ctx = ctxWithViewer({
      url: () => `http://0.0.0.0:5179/?backend=remote&ws=ws://0.0.0.0:5179/ws&token=${token}`,
      currentToken: () => token,
      rotateToken: () => {
        token = 'new-token-cafebabe';
        return token;
      },
    });
    const out = await rotateAccessToken(ctx, {});
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.data.token).toBe('new-token-cafebabe');
      expect(out.data.url).toContain('token=new-token-cafebabe');
    }
  });
});
