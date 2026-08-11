import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const collect = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collect(path)));
    if (entry.isFile() && entry.name.endsWith('.test.js')) files.push(path);
  }
  return files;
};

const tests = (await collect('.tmp/test-dist')).sort();
if (tests.length === 0) throw new Error('No compiled test files found.');
const nodeTestOptions = process.argv.slice(2);
const result = spawnSync(process.execPath, ['--test', ...nodeTestOptions, ...tests], { stdio: 'inherit' });
process.exit(result.status ?? 1);
