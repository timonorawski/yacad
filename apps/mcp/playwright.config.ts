import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: process.env['CI'] ? 2 : 0,
  reporter: [['list']],
  use: {
    launchOptions: {
      args: ['--disable-gpu-sandbox', '--use-gl=swiftshader', '--enable-webgl'],
    },
  },
  // The server is started manually in beforeAll inside the test because we
  // need to drive the in-process tool handlers, not just stdio.
});
