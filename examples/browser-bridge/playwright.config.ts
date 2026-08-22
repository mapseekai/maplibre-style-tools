import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  outputDir: path.join(repoRoot, '.tmp/playwright-output/browser-bridge'),
  reporter: [
    ['line'],
    ['html', {
      outputFolder: path.join(repoRoot, '.tmp/playwright-report/browser-bridge'),
      open: 'never',
    }],
  ],
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-webgl', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    command: 'pnpm exec vite preview --config examples/browser-bridge/vite.config.ts --host 127.0.0.1 --port 4173',
    cwd: repoRoot,
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
  },
});
