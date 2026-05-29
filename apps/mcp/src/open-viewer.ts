import { spawn as nodeSpawn } from 'node:child_process';

export interface OpenCommand {
  readonly command: string;
  readonly args: readonly string[];
}

type SpawnLike = (
  command: string,
  args: readonly string[],
  options: { detached: boolean; stdio: 'ignore' },
) => { unref?: () => void };

export function viewerOpenCommand(platform: NodeJS.Platform, url: string): OpenCommand {
  if (platform === 'darwin') return { command: 'open', args: [url] };
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', url] };
  return { command: 'xdg-open', args: [url] };
}

export async function openViewerUrl(
  url: string,
  opts: {
    platform?: NodeJS.Platform;
    spawn?: SpawnLike;
  } = {},
): Promise<boolean> {
  const { command, args } = viewerOpenCommand(opts.platform ?? process.platform, url);
  const spawn = opts.spawn ?? (nodeSpawn as SpawnLike);
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore' });
    child.unref?.();
    return true;
  } catch {
    return false;
  }
}
