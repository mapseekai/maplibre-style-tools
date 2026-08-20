import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = process.cwd();
const typescript = require('typescript');
const tsc = require.resolve('typescript/bin/tsc');
const normalize = (value) => value.split(sep).join('/');
const relativeToRoot = (value) => normalize(relative(root, resolve(value)));

const approvedSdkSpecifiers = Object.freeze([
  '@modelcontextprotocol/sdk/client/index.js',
  '@modelcontextprotocol/sdk/client/stdio.js',
  '@modelcontextprotocol/sdk/client/streamableHttp.js',
  '@modelcontextprotocol/sdk/inMemory.js',
  '@modelcontextprotocol/sdk/server/mcp.js',
  '@modelcontextprotocol/sdk/server/stdio.js',
  '@modelcontextprotocol/sdk/server/streamableHttp.js',
  '@modelcontextprotocol/sdk/types.js',
]);

const sourceFilesBelow = (directory) => readdirSync(directory, { withFileTypes: true })
  .flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFilesBelow(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });

const staticModuleSpecifier = (node) => {
  if ((typescript.isImportDeclaration(node) || typescript.isExportDeclaration(node))
    && node.moduleSpecifier && typescript.isStringLiteral(node.moduleSpecifier)) {
    return node.moduleSpecifier.text;
  }
  if (typescript.isImportEqualsDeclaration(node)
    && typescript.isExternalModuleReference(node.moduleReference)
    && node.moduleReference.expression
    && typescript.isStringLiteral(node.moduleReference.expression)) {
    return node.moduleReference.expression.text;
  }
  if (typescript.isImportTypeNode(node)
    && typescript.isLiteralTypeNode(node.argument)
    && typescript.isStringLiteral(node.argument.literal)) {
    return node.argument.literal.text;
  }
  if (typescript.isCallExpression(node)
    && typescript.isImportCall(node)
    && typescript.isStringLiteral(node.arguments[0])) {
    return node.arguments[0].text;
  }
  return undefined;
};

const checkApprovedSdkSpecifiers = () => {
  const sdkSpecifiers = new Set();
  for (const file of sourceFilesBelow(resolve(root, 'src/mcp'))) {
    const document = typescript.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      typescript.ScriptTarget.Latest,
      true,
    );
    const visit = (node) => {
      const specifier = staticModuleSpecifier(node);
      if (specifier?.split('/').slice(0, 2).join('/') === '@modelcontextprotocol/sdk') {
        assert.ok(
          approvedSdkSpecifiers.includes(specifier),
          `MCP source imports unapproved SDK subpath ${specifier} in ${relativeToRoot(file)}`,
        );
        sdkSpecifiers.add(specifier);
      }
      typescript.forEachChild(node, visit);
    };
    visit(document);
  }
  assert.deepEqual([...sdkSpecifiers].sort(), [...approvedSdkSpecifiers].sort());
};

const approvedBridgeFiles = Object.freeze([
  'capabilities.ts',
  'codec.ts',
  'outbound.ts',
  'protocol.ts',
  'registry.ts',
  'server.ts',
]);

const isMapLibreDeclaration = (normalized) =>
  normalized.includes('/maplibre-gl/dist/') && normalized.endsWith('.d.ts');
export const forbiddenProjectPathReason = (file) => {
  const normalized = `/${normalize(file)}`;
  if (normalized.includes('/src/capabilities/map-authority.ts')) return '/src/capabilities/map-authority.ts';
  if (normalized.includes('/src/capabilities/')) return undefined;
  if ([
    '/src/adapters/maplibre/types.ts',
    '/src/adapters/maplibre/schemas.ts',
    '/src/adapters/maplibre/geojson-diff.ts',
    '/src/adapters/maplibre/style-hash.ts',
  ].some((suffix) => normalized.endsWith(suffix))) return undefined;
  const bridgeMarker = '/src/bridge/';
  const bridgeIndex = normalized.lastIndexOf(bridgeMarker);
  if (bridgeIndex >= 0) {
    const relativeBridge = normalized.slice(bridgeIndex + bridgeMarker.length);
    return approvedBridgeFiles.includes(relativeBridge)
      ? undefined
      : 'unapproved bridge module';
  }
  for (const fragment of [
    '/src/ai/',
    '/src/ai-sdk/',
    '/src/tools/',
    '/src/engine/',
    '/examples/',
    '/src/adapters/maplibre/map-adapter.ts',
    '/src/adapters/maplibre/runtime-commands.ts',
    '/src/adapters/maplibre/feature-query.ts',
    '/src/adapters/maplibre/',
    '/maplibre-gl/dist/',
  ]) {
    if (normalized.includes(fragment) && !isMapLibreDeclaration(normalized)) return fragment;
  }
  if (/\/typescript\/lib\/lib\.dom(?:\.iterable)?\.d\.ts$/.test(normalized)) return 'DOM lib';
  return undefined;
};

const requiredMcpClosureFiles = Object.freeze([
  '/src/adapters/maplibre/style-hash.ts',
  '/src/bridge/protocol.ts',
  '/src/bridge/registry.ts',
  '/src/bridge/server.ts',
]);

export const assertMcpTypeGraphFiles = (files) => {
  assert.ok(files.some((file) => normalize(file).includes('/src/mcp/')),
    'MCP type graph has no MCP source.');
  assert.ok(files.some((file) => normalize(file).includes('/src/core/')),
    'MCP type graph has no core source.');
  for (const suffix of requiredMcpClosureFiles) {
    assert.ok(files.some((file) => `/${normalize(file)}`.endsWith(suffix)),
      `MCP type graph is missing required ${suffix}.`);
  }
  for (const file of files) {
    const reason = forbiddenProjectPathReason(file);
    assert.equal(reason, undefined, `MCP type graph includes forbidden ${reason}: ${file}`);
  }
};

export const runMcpTypegraphCheck = () => {
  checkApprovedSdkSpecifiers();
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
  assertMcpTypeGraphFiles(files);
};

const directPath = process.argv[1];
if (directPath !== undefined && resolve(directPath) === fileURLToPath(import.meta.url)) {
  runMcpTypegraphCheck();
}
