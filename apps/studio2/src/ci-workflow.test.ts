import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const workflowPath = fileURLToPath(
  new URL('../../../.github/workflows/browser-e2e.yml', import.meta.url),
);
const packageJsonPath = fileURLToPath(new URL('../../../package.json', import.meta.url));

describe('browser e2e workflow', () => {
  it('runs the active studio2 Playwright suite and publishes its report', () => {
    const workflow = readFileSync(workflowPath, 'utf8');

    expect(workflow).toContain('pnpm --filter @yacad/studio2 exec playwright install');
    expect(workflow).toContain('pnpm --filter @yacad/studio2 exec playwright test');
    expect(workflow).toContain('apps/studio2/playwright-report/results.json');
    expect(workflow).toContain('apps/studio2/playwright-report/');
    expect(workflow).not.toContain('pnpm --filter @yacad/studio exec playwright test');
  });

  it('build:app targets the active studio2 app', () => {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(pkg.scripts?.['build:app']).toBe('pnpm --filter @yacad/studio2 build');
  });

  it('root dev targets studio2 and keeps v1 behind explicit legacy scripts', () => {
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts?: Record<string, string>;
    };

    expect(pkg.scripts?.['dev']).toBe('pnpm --filter @yacad/studio2 dev');
    expect(pkg.scripts?.['dev:v2']).toBe('pnpm --filter @yacad/studio2 dev');
    expect(pkg.scripts?.['dev:legacy']).toBe('pnpm --filter @yacad/studio dev');
  });
});
