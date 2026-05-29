import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { setupRuntime } from '../src/library-setup';
import { startHttpServer } from '../src/http-server';
import { createDoc } from '../src/tools/library-tools';
import { setParam } from '../src/tools/mutate-tools';
import { subscribeSession, broadcastCurrentDocChanged } from '../src/broadcaster';
import type { Ctx } from '../src/context';

let browser: Browser;
let page: Page;
let dir: string;
let ctx: Ctx;
let handle: Awaited<ReturnType<typeof startHttpServer>>;

test.beforeAll(async () => {
  browser = await chromium.launch();
  dir = mkdtempSync(join(tmpdir(), 'yacad-mcp-e2e-'));
  const rt = await setupRuntime(dir);
  const port = 5180 + Math.floor(Math.random() * 100);
  handle = await startHttpServer({ port, host: '127.0.0.1', libraryDir: dir });
  ctx = {
    ...rt,
    sessions: new Map(),
    currentDocId: undefined,
    vfsServer: handle.vfsServer,
    viewer: handle.viewer,
  };
  await createDoc(ctx, {
    name: 'box',
    initialDoc: { type: 'box', params: { size: [10, 10, 10], center: true } },
  });
  for (const s of ctx.sessions.values()) subscribeSession(s, handle.vfsServer);
  broadcastCurrentDocChanged(ctx);
}, 120_000);

test.afterAll(async () => {
  // Close the page before the server so the WS connection is gone cleanly.
  await page?.close();
  await browser.close();
  await handle.close();
  rmSync(dir, { recursive: true, force: true });
});

test('viewer renders the seeded doc and updates after setParam', async () => {
  page = await browser.newPage();
  await page.goto(handle.viewer.url());
  // Wait for the studio2 viewer to render the tree.
  await expect(page.locator('.tree-row').first()).toBeVisible({ timeout: 30_000 });
  // The tree should show a 'box' node.
  await expect(page.locator('.tree-row .row-label').first()).toContainText('box');

  // Click into the tree so the inspector pane shows the current params.
  await page.locator('.tree-row .row-label').first().click();
  // Verify initial state is visible (size 10).
  await expect(page.locator('.inspector-pane')).toContainText('10', { timeout: 10_000 });

  // Mutate via the tool handler; broadcast happens automatically through the
  // session subscription set up in beforeAll.
  const r = await setParam(ctx, { path: '$', key: 'size', value: [20, 20, 20] });
  expect(r.ok).toBe(true);

  // Wait for the broadcast to propagate to the viewer (WS push → Svelte reactive update).
  await expect(page.locator('.inspector-pane')).toContainText('20', { timeout: 10_000 });
});
