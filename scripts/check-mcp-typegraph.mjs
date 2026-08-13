import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { relative, resolve, sep } from 'node:path';

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
