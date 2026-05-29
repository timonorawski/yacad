import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const RUN_SH = new URL('../run.sh', import.meta.url);

function runWrapper(args: readonly string[]): {
  args: readonly string[];
  stdout: string;
  stderr: string;
  buildLog: string;
} {
  const dir = mkdtempSync(join(tmpdir(), 'yacad-mcp-run-sh-'));
  try {
    const out = join(dir, 'node-args.txt');
    const logDir = join(dir, 'logs');
    const buildLog = join(logDir, 'startup-build.log');
    writeFileSync(
      join(dir, 'pnpm'),
      '#!/usr/bin/env bash\nprintf "pnpm build output on stdout\\n"\nprintf "pnpm build warning on stderr\\n" >&2\nexit 0\n',
      'utf8',
    );
    writeFileSync(
      join(dir, 'node'),
      '#!/usr/bin/env bash\nprintf "%s\\n" "$@" > "$YACAD_RUN_SH_ARGS_FILE"\n',
      'utf8',
    );
    chmodSync(join(dir, 'pnpm'), 0o755);
    chmodSync(join(dir, 'node'), 0o755);
    // Put both fake binaries directly on PATH; no mkdir needed.
    const result = spawnSync('bash', [RUN_SH.pathname, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH ?? ''}`,
        YACAD_RUN_SH_ARGS_FILE: out,
        YACAD_MCP_LOG_DIR: logDir,
      },
    });
    if (result.status !== 0) {
      throw new Error(`run.sh failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    }
    return {
      args: readFileSync(out, 'utf8').trim().split('\n'),
      stdout: result.stdout,
      stderr: result.stderr,
      buildLog: readFileSync(buildLog, 'utf8'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('run.sh', () => {
  it('starts with default auto port and browser-opening args when no args are supplied', () => {
    const { args } = runWrapper([]);

    expect(args.slice(1)).toEqual(['--port', 'auto', '--open-viewer']);
  });

  it('preserves explicit port and no-viewer overrides', () => {
    const { args } = runWrapper(['--port', '6000', '--no-viewer']);

    expect(args.slice(1)).toEqual(['--port', '6000', '--no-viewer']);
  });

  it('keeps startup build output off stdout for stdio MCP launchers', () => {
    const result = runWrapper([]);

    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
    expect(result.buildLog).toContain('pnpm build output on stdout');
    expect(result.buildLog).toContain('pnpm build warning on stderr');
  });
});
