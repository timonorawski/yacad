import { describe, expect, it, vi } from 'vitest';
import { openViewerUrl, viewerOpenCommand } from './open-viewer';

describe('viewer opener', () => {
  it('builds a platform-specific open command', () => {
    expect(viewerOpenCommand('darwin', 'http://localhost:1/')).toEqual({
      command: 'open',
      args: ['http://localhost:1/'],
    });
    expect(viewerOpenCommand('win32', 'http://localhost:1/')).toEqual({
      command: 'cmd',
      args: ['/c', 'start', '', 'http://localhost:1/'],
    });
    expect(viewerOpenCommand('linux', 'http://localhost:1/')).toEqual({
      command: 'xdg-open',
      args: ['http://localhost:1/'],
    });
  });

  it('returns false instead of throwing when spawning fails', async () => {
    const spawn = vi.fn(() => {
      throw new Error('no opener');
    });

    await expect(openViewerUrl('http://localhost:1/', { platform: 'linux', spawn })).resolves.toBe(
      false,
    );
  });
});
