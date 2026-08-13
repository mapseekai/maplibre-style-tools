import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  assertMcpTypeGraphFiles,
  forbiddenProjectPathReason,
} from './check-mcp-typegraph.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const normalize = (value) => value.split(sep).join('/');

test('MCP type graph predicate admits only the exact neutral bridge closure', () => {
  assert.doesNotThrow(() => assertMcpTypeGraphFiles([
    '/repo/src/mcp/main.ts',
    '/repo/src/core/index.ts',
    '/repo/src/adapters/maplibre/style-hash.ts',
    '/repo/src/bridge/protocol.ts',
    '/repo/src/bridge/registry.ts',
    '/repo/src/bridge/server.ts',
  ]));
  for (const fixture of [
    '/repo/src/adapters/maplibre/map-adapter.ts',
    '/repo/src/bridge/browser-runtime.ts',
    '/repo/src/bridge/client.ts',
    '/repo/node_modules/maplibre-gl/dist/maplibre-gl.js',
    '/repo/node_modules/typescript/lib/lib.dom.d.ts',
  ]) {
    assert.ok(forbiddenProjectPathReason(fixture), `fixture must be rejected: ${fixture}`);
  }
});

const expectedProjectClosure = Object.freeze([
  'src/adapters/maplibre/style-hash.ts',
  'src/bridge/capabilities.ts',
  'src/bridge/codec.ts',
  'src/bridge/outbound.ts',
  'src/bridge/protocol.ts',
  'src/bridge/registry.ts',
  'src/bridge/server.ts',
  'src/core/canonical-json.ts',
  'src/core/context.ts',
  'src/core/diff.ts',
  'src/core/errors.ts',
  'src/core/geojson-analysis.ts',
  'src/core/geojson.ts',
  'src/core/index.ts',
  'src/core/json-pointer.ts',
  'src/core/operations/compatibility.ts',
  'src/core/operations/filters.ts',
  'src/core/operations/layers.ts',
  'src/core/operations/root.ts',
  'src/core/operations/shared.ts',
  'src/core/operations/sources.ts',
  'src/core/schemas.ts',
  'src/core/search.ts',
  'src/core/transaction.ts',
  'src/core/types.ts',
  'src/core/utf8.ts',
  'src/core/validation.ts',
  'src/mcp/core-adapters.ts',
  'src/mcp/create-server.ts',
  'src/mcp/document-handlers.ts',
  'src/mcp/http.ts',
  'src/mcp/live-extension.ts',
  'src/mcp/live-resources.ts',
  'src/mcp/live-tools.ts',
  'src/mcp/main.ts',
  'src/mcp/message-boundary.ts',
  'src/mcp/output.ts',
  'src/mcp/resources.ts',
  'src/mcp/schemas.ts',
  'src/mcp/server-extension.ts',
  'src/mcp/session-store.ts',
  'src/mcp/stdio.ts',
  'src/mcp/types.ts',
  'src/mcp/version.generated.ts',
].sort());

test('real tsc MCP graph equals the pinned project closure', () => {
  const result = spawnSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.mcp.json', '--listFiles'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const files = result.stdout.split(/\r?\n/u).filter(Boolean);
  assertMcpTypeGraphFiles(files);
  const project = files
    .map((file) => normalize(relative(resolve(root), resolve(file))))
    .filter((file) => file.startsWith('src/'))
    .sort();
  assert.deepEqual(project, expectedProjectClosure);
});
