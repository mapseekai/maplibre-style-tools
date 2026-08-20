import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { assertMcpTypeGraphFiles, forbiddenProjectPathReason } from './check-mcp-typegraph.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const normalize = (value) => value.split(sep).join('/');

test('MCP type graph admits capability and neutral bridge closure only', () => {
  assert.doesNotThrow(() => assertMcpTypeGraphFiles([
    '/repo/src/mcp/main.ts', '/repo/src/core/index.ts', '/repo/src/capabilities/registry.ts',
    '/repo/src/adapters/maplibre/types.ts', '/repo/src/adapters/maplibre/geojson-diff.ts',
    '/repo/src/adapters/maplibre/style-hash.ts',
    '/repo/src/bridge/protocol.ts', '/repo/src/bridge/registry.ts', '/repo/src/bridge/server.ts',
  ]));
  for (const fixture of [
    '/repo/src/ai/tools.ts', '/repo/src/capabilities/map-authority.ts',
    '/repo/src/adapters/maplibre/map-adapter.ts', '/repo/src/adapters/maplibre/runtime-commands.ts',
    '/repo/src/adapters/maplibre/feature-query.ts', '/repo/node_modules/maplibre-gl/dist/maplibre-gl.js',
    '/repo/node_modules/typescript/lib/lib.dom.d.ts',
  ]) assert.ok(forbiddenProjectPathReason(fixture), `fixture must be rejected: ${fixture}`);
});

test('real MCP graph contains capabilities and excludes prohibited implementations', () => {
  const result = spawnSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.mcp.json', '--listFiles'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const files = result.stdout.split(/\r?\n/u).filter(Boolean);
  assertMcpTypeGraphFiles(files);
  const project = files
    .map((file) => normalize(relative(resolve(root), resolve(file))))
    .filter((file) => file.startsWith('src/'));
  for (const required of ['src/capabilities/registry.ts', 'src/mcp/session-authority.ts', 'src/mcp/bridge-authority.ts', 'src/mcp/tool-handlers.ts']) assert.ok(project.includes(required));
  for (const forbidden of ['src/capabilities/map-authority.ts', 'src/adapters/maplibre/map-adapter.ts', 'src/adapters/maplibre/runtime-commands.ts', 'src/adapters/maplibre/feature-query.ts']) assert.ok(!project.includes(forbidden));
});
