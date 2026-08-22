import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';

test('recursive test runner discovers nested tests', async () => {
  // Node's test runner skips nested `node --test` invocations inside a test
  // file via the NODE_TEST_CONTEXT env var; strip it so the runner under test
  // executes for real. Discovery is proven by exit codes: a failing fixture
  // two directories deep must fail the runner's own run.
  const fixtureName = `recursive runner nested fixture ${process.pid}`;
  const fixtureRoot = join(
    process.cwd(),
    '.tmp',
    'test-dist',
    `recursive-runner-fixture-${process.pid}`,
  );
  const fixturePath = join(fixtureRoot, 'nested', 'fixture.test.js');
  const runRunner = () => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    return spawnSync(
      process.execPath,
      ['scripts/run-tests.mjs', '--test-name-pattern', `^${fixtureName}$`],
      { cwd: process.cwd(), encoding: 'utf8', env },
    );
  };
  await mkdir(join(fixtureRoot, 'nested'), { recursive: true });
  try {
    await writeFile(
      fixturePath,
      `import { test } from 'node:test';\ntest(${JSON.stringify(fixtureName)}, () => {});\n`,
    );
    const passed = runRunner();
    assert.equal(passed.status, 0, passed.stderr);
    assert.match(passed.stdout, new RegExp(`# Subtest: ${fixtureName}`));
    await writeFile(
      fixturePath,
      `import { test } from 'node:test';\nimport assert from 'node:assert/strict';\ntest(${JSON.stringify(fixtureName)}, () => { assert.fail('fixture failure'); });\n`,
    );
    const failed = runRunner();
    assert.notEqual(failed.status, 0, 'a failing nested fixture must fail the runner run');
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
