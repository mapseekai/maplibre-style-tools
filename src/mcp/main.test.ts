import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';

import * as mcp from './main.js';

test('MCP public module is importable without starting a server', () => {
  assert.equal(typeof mcp, 'object');
  assert.equal(process.stdout.listenerCount('data'), 0);
});

test('MCP binary help writes only stderr and exits without connecting', async () => {
  const child = spawn(process.execPath, [new URL('./main.js', import.meta.url).pathname, '--help'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => { stdout.push(chunk); });
  child.stderr.on('data', (chunk: Buffer) => { stderr.push(chunk); });
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  assert.equal(code, 0);
  assert.equal(Buffer.concat(stdout).toString(), '');
  assert.match(Buffer.concat(stderr).toString(), /maplibre-style-mcp/u);
});
