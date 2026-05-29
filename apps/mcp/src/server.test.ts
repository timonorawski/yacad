import { describe, expect, it } from 'vitest';
import { defaultRunArgs, parseFlags } from './server';

describe('server flags', () => {
  it('keeps fixed port and closed browser as conservative server defaults', () => {
    expect(parseFlags([])).toMatchObject({
      port: 5179,
      openViewer: false,
      noViewer: false,
    });
  });

  it('accepts port auto and open-viewer', () => {
    expect(parseFlags(['--port', 'auto', '--open-viewer'])).toMatchObject({
      port: 'auto',
      openViewer: true,
    });
  });

  it('run.sh defaults to auto port and open viewer without overriding explicit args', () => {
    expect(defaultRunArgs([])).toEqual(['--port', 'auto', '--open-viewer']);
    expect(defaultRunArgs(['--port', '6000'])).toEqual(['--port', '6000', '--open-viewer']);
    expect(defaultRunArgs(['--no-viewer'])).toEqual(['--port', 'auto', '--no-viewer']);
    expect(defaultRunArgs(['--port=6000', '--open-viewer'])).toEqual([
      '--port=6000',
      '--open-viewer',
    ]);
  });
});
