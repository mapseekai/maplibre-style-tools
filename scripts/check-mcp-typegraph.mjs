import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { relative, resolve, sep } from 'node:path';

const require = createRequire(import.meta.url);
const root = process.cwd();
const tsc = require.resolve('typescript/bin/tsc');

const normalize = (value) => value.split(sep).join('/');
const relativeToRoot = (value) => normalize(relative(root, resolve(value)));

const forbiddenProjectPathReason = (file) => {
  const normalized = `/${normalize(file)}`;
  if (normalized.endsWith('/src/adapters/maplibre/style-hash.ts')) return undefined;
  for (const fragment of [
    '/src/ai-sdk/',
    '/src/tools/',
    '/src/engine/',
    '/examples/',
    '/src/adapters/maplibre/',
    '/maplibre-gl/dist/',
  ]) {
    if (normalized.includes(fragment)) return fragment;
  }
  if (/\/typescript\/lib\/lib\.dom(?:\.iterable)?\.d\.ts$/.test(normalized)) return 'DOM lib';
  return undefined;
};

assert.equal(forbiddenProjectPathReason('/repo/src/adapters/maplibre/style-hash.ts'), undefined);
for (const fixture of [
  '/repo/src/adapters/maplibre/map-adapter.ts',
  '/repo/src/ai-sdk/index.ts',
  '/repo/src/tools/compact-tools.ts',
  '/repo/src/engine/style-context.ts',
  '/repo/examples/example.ts',
  '/repo/node_modules/maplibre-gl/dist/maplibre-gl.js',
  '/repo/node_modules/typescript/lib/lib.dom.d.ts',
]) {
  assert.ok(forbiddenProjectPathReason(fixture), `fixture must be rejected: ${fixture}`);
}

const result = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.mcp.json', '--listFiles'], {
  cwd: root,
  encoding: 'utf8',
});
if (result.error || result.status !== 0) {
  throw new Error([
    'MCP type graph compilation failed.',
    result.error?.message,
    result.stdout,
    result.stderr,
  ].filter(Boolean).join('\n'));
}

const files = result.stdout.split(/\r?\n/u).filter(Boolean);
assert.ok(files.some((file) => relativeToRoot(file).startsWith('src/mcp/')), 'MCP type graph has no MCP source.');
assert.ok(files.some((file) => relativeToRoot(file).startsWith('src/core/')), 'MCP type graph has no core source.');
for (const file of files) {
  const reason = forbiddenProjectPathReason(file);
  assert.equal(reason, undefined, `MCP type graph includes forbidden ${reason}: ${file}`);
}
