import { describe, expect, it } from 'vitest';
import { startHttpServer } from './http-server';

describe('HTTP viewer server', () => {
  it('uses the OS-assigned port in viewer URLs when port is auto', async () => {
    const handle = await startHttpServer({
      port: 'auto',
      host: '127.0.0.1',
      libraryDir: './.yacad-mcp-test/vfs',
    });
    try {
      const url = handle.viewer.url();
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
      expect(url).not.toContain(':0/');
      expect(url).not.toContain(':auto/');
      expect(url).toContain('ws=ws://127.0.0.1:');
    } finally {
      await handle.close();
    }
  });
});
