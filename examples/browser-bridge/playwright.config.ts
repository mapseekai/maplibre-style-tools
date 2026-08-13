import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  testDir: './e2e',
  outputDir: path.join(repoRoot, '.tmp/playwright-output/browser-bridge'),
  reporter: [
    ['line'],
    ['html', {
      outputFolder: path.join(repoRoot, '.tmp/playwright-report/browser-bridge'),
      open: 'never',
    }],
  ],
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
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
