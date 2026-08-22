import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);

const temporaryEsmClosure = (t, files) => {
  const temporaryRoot = join(repoRoot, '.tmp');
  mkdirSync(temporaryRoot, { recursive: true });
  const directory = mkdtempSync(join(temporaryRoot, 'check-package-closure-'));
  t.after(() => { rmSync(directory, { recursive: true, force: true }); });
  for (const [name, contents] of Object.entries(files)) {
    const target = join(directory, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  return { directory, entry: join(directory, 'index.js') };
};

const runClosureCheck = (entry, ...extraArguments) => spawnSync(
  process.execPath,
  ['scripts/check-package.mjs', '--check-browser-closure', entry, ...extraArguments],
  { cwd: repoRoot, encoding: 'utf8' },
);

const temporaryEsmPackage = (t, files) => {
  const temporaryRoot = join(repoRoot, '.tmp');
  mkdirSync(temporaryRoot, { recursive: true });
  const directory = mkdtempSync(join(temporaryRoot, 'check-package-cjs-'));
  t.after(() => { rmSync(directory, { recursive: true, force: true }); });
  for (const [name, contents] of Object.entries(files)) {
    const target = join(directory, 'node_modules/esm-fixture', name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  return directory;
};

const runCjsRequireCheck = (cwd, ...arguments_) => spawnSync(
  process.execPath,
  [resolve(repoRoot, 'scripts/check-package.mjs'), '--check-cjs-require', ...arguments_],
  { cwd, encoding: 'utf8' },
);
test('CommonJS require checker accepts ESM package root and subpath exports', (t) => {
  const directory = temporaryEsmPackage(t, {
    'package.json': JSON.stringify({
      name: 'esm-fixture',
      type: 'module',
      exports: {
        '.': { import: './index.js', default: './index.js' },
        './core': { import: './core.js', default: './core.js' },
      },
    }),
    'index.js': 'export const rootExport = () => undefined;',
    'core.js': 'export const coreExport = () => undefined;',
  });
  const result = runCjsRequireCheck(
    directory,
    'esm-fixture',
    'rootExport',
    'esm-fixture/core',
    'coreExport',
  );
  assert.equal(result.status, 0, result.stderr);
});

test('browser closure checker recursively reports the clean visited closure', (t) => {
  const fixture = temporaryEsmClosure(t, {
    'index.js': "export * from './nested.js';",
    'nested.js': "export * from './leaf.js';",
    'leaf.js': 'export const ok = true;',
  });
  const result = runClosureCheck(fixture.entry, '--json');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    JSON.parse(result.stdout).files,
    ['index.js', 'leaf.js', 'nested.js'],
  );
});

test('browser closure checker rejects every forbidden deep edge', (t) => {
  for (const [index, nestedSource] of [
    "import 'node:fs'; export const ok = true;",
    "import 'ws'; export const ok = true;",
    "export * from './missing.js';",
    "const name = './leaf.js'; export const load = () => import(name);",
  ].entries()) {
    const fixture = temporaryEsmClosure(t, {
      'index.js': "export * from './nested.js';",
      'nested.js': nestedSource,
      'leaf.js': 'export const ok = true;',
    });
    const result = runClosureCheck(fixture.entry);
    assert.notEqual(
      result.status,
      0,
      `unexpected success for fixture ${index}: ${relative(repoRoot, fixture.directory)}`,
    );
  }
});
