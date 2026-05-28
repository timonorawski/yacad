import { test, expect, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Generous timeout for the first evaluation: WASM loads cold.
const FIRST_EVAL_TIMEOUT = 60_000;
// Re-eval after a text change is fast (cache hit on unchanged subtrees).
const REEVAL_TIMEOUT = 30_000;

// ─── helpers ────────────────────────────────────────────────────────────────

/** Wait until .status reads "Ready" (evaluation finished, no errors). */
async function waitForReady(page: Page, timeout = FIRST_EVAL_TIMEOUT) {
  await expect(page.locator('.status')).toHaveText('Ready', { timeout });
}

/** Parse the stats panel. Returns { nodes, hits, misses, hitRate } */
async function readStats(page: Page) {
  const statsDiv = page.locator('.stats');
  await expect(statsDiv).toBeVisible({ timeout: FIRST_EVAL_TIMEOUT });
  const text = await statsDiv.innerText();
  const parse = (label: string) => {
    const m = new RegExp(`${label}\\s+(\\d+)`).exec(text);
    return m ? parseInt(m[1], 10) : 0;
  };
  return {
    nodes: parse('nodes'),
    hits: parse('hits'),
    misses: parse('misses'),
    hitRate: parse('hit-rate'),
  };
}

// ─── test: render & cold run ─────────────────────────────────────────────────

test('app loads, canvas is visible, status reaches Ready, cold run has misses', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');

  // Canvas must be present and sized.
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(0);
  expect(box!.height).toBeGreaterThan(0);

  // Wait for the first evaluation to finish (WASM cold start).
  await waitForReady(page, FIRST_EVAL_TIMEOUT);

  // No uncaught page errors.
  expect(errors).toHaveLength(0);

  // Cold run: there should be misses (nothing in cache yet).
  const stats = await readStats(page);
  expect(stats.nodes).toBeGreaterThan(0);
  expect(stats.misses).toBeGreaterThan(0);
});

// ─── test: incremental recompute ─────────────────────────────────────────────

test('incremental recompute: changing sphere radius hits box, recomputes sphere + root', async ({
  page,
}) => {
  await page.goto('/');
  await waitForReady(page, FIRST_EVAL_TIMEOUT);

  // Build a new document with a different sphere radius (19 → 15).
  const newDoc = JSON.stringify(
    {
      type: 'difference',
      children: [
        { type: 'box', params: { size: [30, 30, 30], center: true } },
        { type: 'sphere', params: { radius: 15, segments: 48 } },
      ],
    },
    null,
    2,
  );

  // Fill triggers Svelte's oninput → scheduleEvaluate → debounce → evaluate.
  const textarea = page.locator('textarea');
  await textarea.fill(newDoc);

  // Wait for the stats panel to show hits ≥ 1.  Playwright polls this
  // assertion repeatedly, so it will catch the update whenever it lands
  // (after the 150ms debounce + worker round-trip).
  const statsDiv = page.locator('.stats');
  await expect
    .poll(
      async () => {
        const text = await statsDiv.innerText();
        const m = /hits\s+(\d+)/.exec(text);
        return m ? parseInt(m[1], 10) : 0;
      },
      { timeout: REEVAL_TIMEOUT, message: 'expected hits ≥ 1 after incremental re-eval' },
    )
    .toBeGreaterThanOrEqual(1);

  // Status must be Ready (no error).
  await waitForReady(page, 5_000);

  // Per-node table: at least one node tagged "cached".
  const hitItems = page.locator('.node-table span.tag.hit');
  const hitCount = await hitItems.count();
  expect(hitCount).toBeGreaterThanOrEqual(1);
});

// ─── test: warm start (IndexedDB persistence) ────────────────────────────────

test('warm start: reload reuses IndexedDB, hit-rate near 100%', async ({ page }) => {
  // First load — populate the cache.
  await page.goto('/');
  await waitForReady(page, FIRST_EVAL_TIMEOUT);

  const firstStats = await readStats(page);
  expect(firstStats.misses).toBeGreaterThan(0); // was a cold run

  // Reload the page — L2 (IndexedDB) should warm the L1 cache.
  await page.reload();
  await waitForReady(page, FIRST_EVAL_TIMEOUT);

  const warmStats = await readStats(page);
  // After warm reload: all nodes should be hits.
  expect(warmStats.nodes).toBeGreaterThan(0);
  expect(warmStats.hits).toBe(warmStats.nodes);
  expect(warmStats.misses).toBe(0);
  // Hit-rate must be 100%.
  expect(warmStats.hitRate).toBe(100);
});

// ─── test: 2D rendering smoke ────────────────────────────────────────────────

test('renders a 2D scene without crashing', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  await waitForReady(page, FIRST_EVAL_TIMEOUT);

  // Switch to the 2D circle scene.
  await page.getByLabel('Sample scene').selectOption('2d-circle');
  await waitForReady(page, FIRST_EVAL_TIMEOUT);

  // Canvas must still be visible and non-zero.
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(0);
  expect(box!.height).toBeGreaterThan(0);

  // No uncaught page errors.
  expect(errors).toHaveLength(0);

  // Evaluation produced at least one node.
  const stats = await readStats(page);
  expect(stats.nodes).toBeGreaterThan(0);
});

test('renders a Lua-2D-extruded scene', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  await waitForReady(page, FIRST_EVAL_TIMEOUT);

  // The Lua flower hash is computed async on mount (SubtleCrypto SHA-256).
  // Wait until the option is present and has a non-placeholder label before selecting.
  const sceneSelect = page.getByLabel('Sample scene');
  await expect
    .poll(
      async () => {
        const opt = page.locator('option[value="lua-flower-extruded"]');
        const count = await opt.count();
        return count;
      },
      { timeout: FIRST_EVAL_TIMEOUT, message: 'lua-flower-extruded option not found' },
    )
    .toBeGreaterThan(0);

  await sceneSelect.selectOption('lua-flower-extruded');
  await waitForReady(page, FIRST_EVAL_TIMEOUT);

  // Canvas must still be visible.
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThan(0);
  expect(box!.height).toBeGreaterThan(0);

  // No uncaught page errors.
  expect(errors).toHaveLength(0);

  // Evaluation produced at least one node.
  const stats = await readStats(page);
  expect(stats.nodes).toBeGreaterThan(0);
});

test('switches between 2D and 3D scenes without console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  await waitForReady(page, FIRST_EVAL_TIMEOUT);

  const sceneSelect = page.getByLabel('Sample scene');

  // Switch to a 2D scene.
  await sceneSelect.selectOption('2d-circle');
  await waitForReady(page, FIRST_EVAL_TIMEOUT);

  // Switch back to a 3D scene.
  await sceneSelect.selectOption('box');
  await waitForReady(page, FIRST_EVAL_TIMEOUT);

  // Canvas must be visible throughout.
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();

  // No uncaught page errors during transitions.
  expect(errors).toHaveLength(0);
});

// ─── test: Export STL ────────────────────────────────────────────────────────

test('Export STL: download is a non-empty .stl file', async ({ page }) => {
  await page.goto('/');
  await waitForReady(page, FIRST_EVAL_TIMEOUT);

  const exportButton = page.getByRole('button', { name: 'Export STL' });
  await expect(exportButton).toBeEnabled();

  const [download] = await Promise.all([page.waitForEvent('download'), exportButton.click()]);

  expect(download.suggestedFilename()).toMatch(/\.stl$/i);

  // Save to a temp file and check size.
  const downloadPath = path.join(
    os.tmpdir(),
    `playwright-${Date.now()}-${download.suggestedFilename()}`,
  );
  await download.saveAs(downloadPath);

  const stat = fs.statSync(downloadPath);
  // Binary STL is at least 84 bytes (80-byte header + 4-byte triangle count).
  expect(stat.size).toBeGreaterThanOrEqual(84);

  // Clean up.
  fs.unlinkSync(downloadPath);
});

// ─── test: export button gating by geometry kind ─────────────────────────────

test('export buttons gate by geometry kind: 2D scene enables DXF/SVG/PNG, disables STL', async ({
  page,
}) => {
  await page.goto('/');
  await waitForReady(page, FIRST_EVAL_TIMEOUT);

  await page.getByLabel('Sample scene').selectOption('2d-circle');
  await waitForReady(page, REEVAL_TIMEOUT);

  await expect(page.getByRole('button', { name: 'Export DXF' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Export SVG' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Export PNG' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Export STL' })).toBeDisabled();
});

test('export buttons gate by geometry kind: 3D scene enables STL, disables DXF/SVG/PNG', async ({
  page,
}) => {
  await page.goto('/');
  await waitForReady(page, FIRST_EVAL_TIMEOUT);

  const sceneSelect = page.getByLabel('Sample scene');
  // Toggle to 2D then back to 3D to ensure the onchange handler fires for the
  // 3D scene (selectOption is a no-op when the value hasn't changed).
  await sceneSelect.selectOption('2d-circle');
  await waitForReady(page, REEVAL_TIMEOUT);
  await sceneSelect.selectOption('box');
  await waitForReady(page, REEVAL_TIMEOUT);

  await expect(page.getByRole('button', { name: 'Export STL' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Export DXF' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Export SVG' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Export PNG' })).toBeDisabled();
});
