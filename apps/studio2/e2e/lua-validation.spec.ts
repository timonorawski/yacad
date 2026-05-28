import { test, expect } from '@playwright/test';

const FIRST_LOAD_TIMEOUT = 60_000;

test('LuaInspector mounts without console errors when a Lua scene is loaded', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');

  // Wait for the seeder to finish by waiting for the Lua: parametric gear option.
  await expect(page.locator('option', { hasText: 'Lua: parametric gear' })).toHaveCount(1, {
    timeout: FIRST_LOAD_TIMEOUT,
  });

  // Select the Lua gear scene.
  await page.getByLabel('Document').selectOption({ label: 'Lua: parametric gear' });

  // Wait for the tree to populate.
  await expect(page.locator('.tree-row').first()).toBeVisible({ timeout: FIRST_LOAD_TIMEOUT });

  // Click the root lua node in the tree.
  await page.locator('.tree-row').first().locator('.row-label').click();

  // LuaInspector should mount and show the "lua" heading and definitionHash summary.
  await expect(page.locator('.inspector-pane h3')).toHaveText('lua', { timeout: 5_000 });
  await expect(page.locator('.inspector-pane .summary')).toContainText('definitionHash', {
    timeout: 5_000,
  });

  // No runtime errors should have been thrown.
  expect(errors).toEqual([]);
});
