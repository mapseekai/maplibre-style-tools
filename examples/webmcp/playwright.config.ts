import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  outputDir: path.join(repoRoot, '.tmp/playwright-output/webmcp'),
  reporter: [['line'], ['html', {
    outputFolder: path.join(repoRoot, '.tmp/playwright-report/webmcp'),
    open: 'never',
  }]],
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:4175',
    browserName: 'chromium',
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-webgl', '--enable-unsafe-swiftshader'],
    },
  },
  webServer: {
    command: 'pnpm exec vite preview --config examples/webmcp/vite.config.ts --host 127.0.0.1 --port 4175',
    cwd: repoRoot,
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: false,
  },
});
