import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const typescript = require('typescript');
const tsc = require.resolve('typescript/bin/tsc');
const root = process.cwd();

const command = (program, args, cwd = root) => {
  const result = spawnSync(program, args, { cwd, encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error([
      `Command failed: ${program} ${args.join(' ')}`,
      result.error?.message,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  return result.stdout;
};

const assertion = (condition, message) => assert.ok(condition, message);
const source = (file) => readFileSync(file, 'utf8');

const declarationSpecifier = (node) => {
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

const assertCoreDeclarationsAreTransportNeutral = (files, packageRoot) => {
  const coreDeclarations = files.filter((file) => file.startsWith('dist/core/')
    && file.endsWith('.d.ts'));
  for (const file of coreDeclarations) {
    const text = source(join(packageRoot, file));
    assertion(!/\/\/\/\s*<reference\s+types=["']node["']/.test(text),
      `${file} references Node ambient types`);
    assertion(!text.includes('@types/node'), `${file} depends on @types/node`);
    const document = typescript.createSourceFile(file, text,
      typescript.ScriptTarget.Latest, true);
    const visit = (node) => {
      const specifier = declarationSpecifier(node);
      if (specifier !== undefined) {
        assertion(!specifier.startsWith('node:') && !require('node:module').isBuiltin(specifier),
          `${file} leaks Node builtin ${specifier}`);
      }
      typescript.forEachChild(node, visit);
    };
    visit(document);
  }
};

const coreConsumer = `import {
  DEFAULT_MAX_DIFF_BYTES,
  DEFAULT_MAX_OPERATIONS,
  DEFAULT_MAX_STYLE_BYTES,
  applyStyleTransaction,
  validateStyleDocument,
} from 'maplibre-style-tools/core';
import type {
  StyleDocument,
  StyleTransaction,
  StyleTransactionResult,
} from 'maplibre-style-tools/core';

const style: StyleDocument = { version: 8, sources: {}, layers: [] };
const transaction: StyleTransaction = {
  operations: [{
    op: 'setLayerProperties',
    layerId: 'roads',
    paint: { 'line-color': '#ffffff' },
  }],
};
const result: StyleTransactionResult = applyStyleTransaction(style, transaction);
// @ts-expect-error /core must not load the Node Buffer global.
void Buffer;
// @ts-expect-error /core must not load the NodeJS namespace.
type CoreMustNotLoadNode = NodeJS.Process;
void result;
void validateStyleDocument(style);
void DEFAULT_MAX_STYLE_BYTES;
void DEFAULT_MAX_DIFF_BYTES;
void DEFAULT_MAX_OPERATIONS;
`;

const rootConsumer = `import {
  createCompactMapLibreStyleTools,
  createMapLibreStyleTools,
} from 'maplibre-style-tools';
import type {
  CreateMapLibreStyleToolsOptions,
  StyleOperation as LegacyStyleOperation,
} from 'maplibre-style-tools';

const legacy: LegacyStyleOperation = { layerId: 'roads', paint: {} };
type RootOptions = CreateMapLibreStyleToolsOptions;
type RootNodeAmbient = Buffer;
declare const rootOptions: RootOptions;
declare const rootNodeAmbient: RootNodeAmbient;

void createMapLibreStyleTools;
void createCompactMapLibreStyleTools;
void rootOptions;
void rootNodeAmbient;
void legacy;
`;

const coreConfig = `{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true,
    "types": [],
    "skipLibCheck": false,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force"
  },
  "include": ["core-consumer.ts"]
}
`;

const rootConfig = `{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "types": [],
    "skipLibCheck": false,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force"
  },
  "include": ["root-consumer.ts"]
}
`;

const runtimeSmoke = `import assert from 'node:assert/strict';
import {
  createCompactMapLibreStyleTools,
  createMapLibreStyleTools,
} from 'maplibre-style-tools';
import {
  DEFAULT_MAX_DIFF_BYTES,
  DEFAULT_MAX_OPERATIONS,
  DEFAULT_MAX_STYLE_BYTES,
  applyStyleTransaction,
  finalizeStyleReplacement,
  jsonUtf8ByteLength,
  validateStyleDocument,
} from 'maplibre-style-tools/core';

assert.equal(typeof createMapLibreStyleTools, 'function');
assert.equal(typeof createCompactMapLibreStyleTools, 'function');
for (const value of [applyStyleTransaction, finalizeStyleReplacement, validateStyleDocument, jsonUtf8ByteLength]) {
  assert.equal(typeof value, 'function');
}
assert.equal(DEFAULT_MAX_STYLE_BYTES, 5 * 1024 * 1024);
assert.equal(DEFAULT_MAX_DIFF_BYTES, 1 * 1024 * 1024);
assert.equal(DEFAULT_MAX_OPERATIONS, 100);
const finalized = finalizeStyleReplacement(
  { version: 8, sources: {}, layers: [] },
  { version: 8, sources: {}, layers: [], metadata: { owner: 'maps' } },
);
assert.equal(finalized.ok, true);
assert.deepEqual(finalized.diff.map(({ op, path }) => ({ op, path })), [{ op: 'add', path: '/metadata' }]);
`;

const temporary = mkdtempSync(join(tmpdir(), 'maplibre-style-tools-package-'));
try {
  const workspace = await import('maplibre-style-tools');
  assertion(typeof workspace.createMapLibreStyleTools === 'function', 'root full factory is missing');
  assertion(typeof workspace.createCompactMapLibreStyleTools === 'function', 'root compact factory is missing');

  const core = await import('maplibre-style-tools/core');
  for (const name of ['applyStyleTransaction', 'finalizeStyleReplacement', 'validateStyleDocument', 'jsonUtf8ByteLength']) {
    assertion(typeof core[name] === 'function', `core ${name} is missing`);
  }
  assertion(core.DEFAULT_MAX_STYLE_BYTES === 5 * 1024 * 1024, 'incorrect core style byte default');
  assertion(core.DEFAULT_MAX_DIFF_BYTES === 1 * 1024 * 1024, 'incorrect core diff byte default');
  assertion(core.DEFAULT_MAX_OPERATIONS === 100, 'incorrect core operation default');
  const finalized = core.finalizeStyleReplacement(
    { version: 8, sources: {}, layers: [] },
    { version: 8, sources: {}, layers: [], metadata: { owner: 'maps' } },
  );
  assertion(finalized.ok, 'core replacement should succeed');
  assert.deepEqual(finalized.diff.map(({ op, path }) => ({ op, path })), [{ op: 'add', path: '/metadata' }]);

  const packed = JSON.parse(command('npm', [
    'pack', '--json', '--ignore-scripts', '--pack-destination', temporary,
  ]));
  assertion(Array.isArray(packed) && packed.length === 1 && Array.isArray(packed[0].files),
    'npm pack did not return a usable JSON file list');
  const packedFiles = packed[0].files.map((file) => file.path).sort();
  for (const required of [
    'dist/index.js', 'dist/index.d.ts', 'dist/core/index.js', 'dist/core/index.d.ts', 'dist/core/types.d.ts',
  ]) assertion(packedFiles.includes(required), `packed tarball is missing ${required}`);
  for (const file of packedFiles) {
    assertion(!file.startsWith('src/') && !file.startsWith('.tmp/') && !file.startsWith('examples/'),
      `packed tarball contains source artifact ${file}`);
    assertion(!file.includes('.test.') && !file.includes('stale'),
      `packed tarball contains test or stale artifact ${file}`);
  }
  const unpacked = join(temporary, 'unpacked');
  command('tar', ['-xzf', join(temporary, packed[0].filename), '-C', temporary]);
  command('mv', [join(temporary, 'package'), unpacked]);
  const rootDeclaration = source(join(unpacked, 'dist/index.d.ts'));
  assertion(rootDeclaration.startsWith('/// <reference types="node" preserve="true" />\n/// <reference types="geojson" preserve="true" />'),
    'root declaration references must preserve node then geojson');
  assertion(source(join(unpacked, 'dist/core/types.d.ts')).startsWith('/// <reference types="geojson" preserve="true" />'),
    'core type declaration must preserve geojson');
  assertCoreDeclarationsAreTransportNeutral(packedFiles, unpacked);

  const consumer = join(temporary, 'consumer');
  command('mkdir', ['-p', consumer]);
  writeFileSync(join(consumer, 'package.json'), '{\n  "private": true,\n  "type": "module"\n}\n');
  command('npm', [
    'install', '--no-save', '--package-lock=false', '--ignore-scripts', '--no-audit', '--no-fund',
    join(temporary, packed[0].filename),
  ], consumer);
  writeFileSync(join(consumer, 'core-consumer.ts'), coreConsumer);
  writeFileSync(join(consumer, 'root-consumer.ts'), rootConsumer);
  writeFileSync(join(consumer, 'tsconfig.core-consumer.json'), coreConfig);
  writeFileSync(join(consumer, 'tsconfig.root-consumer.json'), rootConfig);
  const installedManifest = JSON.parse(source(join(consumer, 'node_modules/maplibre-style-tools/package.json')));
  assert.equal(installedManifest.dependencies['@types/geojson'], '^7946.0.16');
  assert.equal(installedManifest.dependencies['@types/node'], '^22.20.1');
  assertion(installedManifest.devDependencies?.['@types/node'] === undefined,
    'the packed manifest must not retain @types/node in devDependencies');
  command(process.execPath, [tsc, '-p', 'tsconfig.core-consumer.json', '--noEmit'], consumer);
  command(process.execPath, [tsc, '-p', 'tsconfig.root-consumer.json', '--noEmit'], consumer);
  writeFileSync(join(consumer, 'runtime-smoke.mjs'), runtimeSmoke);
  command(process.execPath, ['runtime-smoke.mjs'], consumer);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
