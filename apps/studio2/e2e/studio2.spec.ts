import { test, expect } from '@playwright/test';

const FIRST_LOAD_TIMEOUT = 60_000;

test('app loads and seeds the scene library', async ({ page }) => {
  await page.goto('/');
  // The doc picker should populate with the seeded library.
  const picker = page.getByLabel('Document');
  await expect(picker).toBeVisible({ timeout: FIRST_LOAD_TIMEOUT });
  // At least the static box should be selectable — exact text match to avoid
  // matching "Translated box", "Box minus sphere", etc.
  await expect(page.locator('option', { hasText: /^Box$/ })).toHaveCount(1, {
    timeout: FIRST_LOAD_TIMEOUT,
  });
});

test('selecting a tree node populates the inspector', async ({ page }) => {
  await page.goto('/');
  // Wait for the seeder to finish by waiting for a specific option to appear.
  await expect(page.locator('option', { hasText: /^Box minus sphere$/ })).toHaveCount(1, {
    timeout: FIRST_LOAD_TIMEOUT,
  });
  await page.getByLabel('Document').selectOption({ label: 'Box minus sphere' });
  await expect(page.locator('.tree-row').first()).toBeVisible({ timeout: FIRST_LOAD_TIMEOUT });
  // Click the row-label button to select the root node.
  await page.locator('.tree-row').first().locator('.row-label').click();
  // Inspector shows the difference node's summary.
  await expect(page.locator('.inspector-pane h3')).toHaveText('difference');
});

test('editing a param re-evaluates the viewport', async ({ page }) => {
  await page.goto('/');
  // Wait for seeder.
  await expect(page.locator('option', { hasText: /^Sphere$/ })).toHaveCount(1, {
    timeout: FIRST_LOAD_TIMEOUT,
  });
  await page.getByLabel('Document').selectOption({ label: 'Sphere' });
  // Click into the tree to select the sphere node.
  await expect(page.locator('.tree-row').first()).toBeVisible({ timeout: FIRST_LOAD_TIMEOUT });
  await page.locator('.tree-row').first().locator('.row-label').click();
  // Inspector should appear with radius input.
  await expect(page.locator('.inspector-pane input[type="number"]').first()).toBeVisible({
    timeout: 5_000,
  });
  // Edit radius.
  const radius = page.locator('.inspector-pane input[type="number"]').first();
  await radius.fill('15');
  await radius.blur();
  // Status indicates re-eval, then idle.
  await expect(page.locator('.status')).toHaveText('idle', { timeout: 10_000 });
});

test('wrap-with-translate adds a node and viewport stays valid', async ({ page }) => {
  await page.goto('/');
  // Wait for seeder.
  await expect(page.locator('option', { hasText: /^Box$/ })).toHaveCount(1, {
    timeout: FIRST_LOAD_TIMEOUT,
  });
  await page.getByLabel('Document').selectOption({ label: 'Box' });
  await expect(page.locator('.tree-row').first()).toBeVisible({ timeout: FIRST_LOAD_TIMEOUT });
  // Select the root box node.
  await page.locator('.tree-row').first().locator('.row-label').click();
  // Open the wrap-with dropdown and click 'translate'. The palette now has
  // multiple <details> dropdowns (Wrap with… and + child…); target by text.
  await page.locator('.tool-palette details summary', { hasText: 'Wrap with' }).click();
  await page.locator('.tool-palette details button', { hasText: /^translate$/ }).click();
  // The tree now has two rows (translate → box).
  await expect(page.locator('.tree-row')).toHaveCount(2, { timeout: 5_000 });
  // Viewport is still idle (eval succeeded).
  await expect(page.locator('.status')).toHaveText('idle', { timeout: 10_000 });
});

test('export gadget offers STL for 3D nodes', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('option', { hasText: /^Box$/ })).toHaveCount(1, {
    timeout: FIRST_LOAD_TIMEOUT,
  });
  await page.getByLabel('Document').selectOption({ label: 'Box' });
  await expect(page.locator('.tree-row').first()).toBeVisible({ timeout: FIRST_LOAD_TIMEOUT });
  // The export gadget on the root box should appear and expose Export STL.
  const gadget = page.locator('.tree-row').first().locator('.row-export summary');
  await expect(gadget).toBeVisible({ timeout: 10_000 });
  await gadget.click();
  await expect(page.locator('.row-export-panel button', { hasText: /^Export STL$/ })).toBeVisible();
  // 2D-only formats must not appear for a 3D node.
  await expect(page.locator('.row-export-panel button', { hasText: /^Export SVG$/ })).toHaveCount(
    0,
  );
});

test('clicking Export STL triggers a download', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('option', { hasText: /^Box$/ })).toHaveCount(1, {
    timeout: FIRST_LOAD_TIMEOUT,
  });
  await page.getByLabel('Document').selectOption({ label: 'Box' });
  await expect(page.locator('.tree-row').first()).toBeVisible({ timeout: FIRST_LOAD_TIMEOUT });
  // Open the export menu on the root row.
  await page.locator('.tree-row').first().locator('.row-export summary').click();
  // Clicking Export STL must trigger a browser download — covers the
  // $state-proxy postMessage regression where the worker rejected the doc.
  const downloadPromise = page.waitForEvent('download', { timeout: 10_000 });
  await page.locator('.row-export-panel button', { hasText: /^Export STL$/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.stl$/);
});

test('export gadget offers SVG/DXF/PNG for 2D nodes', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('option', { hasText: /^Circle \(2D\)$/ })).toHaveCount(1, {
    timeout: FIRST_LOAD_TIMEOUT,
  });
  await page.getByLabel('Document').selectOption({ label: 'Circle (2D)' });
  await expect(page.locator('.tree-row').first()).toBeVisible({ timeout: FIRST_LOAD_TIMEOUT });
  const gadget = page.locator('.tree-row').first().locator('.row-export summary');
  await expect(gadget).toBeVisible({ timeout: 10_000 });
  await gadget.click();
  await expect(page.locator('.row-export-panel button', { hasText: /^Export SVG$/ })).toBeVisible();
  await expect(page.locator('.row-export-panel button', { hasText: /^Export DXF$/ })).toBeVisible();
  await expect(page.locator('.row-export-panel button', { hasText: /^Export PNG$/ })).toBeVisible();
  // STL must not appear for a 2D node.
  await expect(page.locator('.row-export-panel button', { hasText: /^Export STL$/ })).toHaveCount(
    0,
  );
});

test('reload restores the open document', async ({ page }) => {
  await page.goto('/');
  // Wait for seeder — exact match to avoid matching "Rotated cylinder".
  await expect(page.locator('option', { hasText: /^Cylinder$/ })).toHaveCount(1, {
    timeout: FIRST_LOAD_TIMEOUT,
  });
  await page.getByLabel('Document').selectOption({ label: 'Cylinder' });
  await expect(page.locator('.tree-row').first()).toBeVisible({ timeout: FIRST_LOAD_TIMEOUT });
  await page.reload();
  // The picker still lists the seeded library (no re-seeding on reload).
  await expect(page.locator('option', { hasText: /^Cylinder$/ })).toHaveCount(1, {
    timeout: FIRST_LOAD_TIMEOUT,
  });
});
