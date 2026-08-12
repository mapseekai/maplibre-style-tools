import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseCliArgs } from './args.js';
import { CliArgumentError } from './types.js';

describe('parseCliArgs', () => {
  it('parses validate, inspect, and apply', () => {
    assert.deepEqual(parseCliArgs(['validate', 'style.json']), {
      kind: 'validate', styleInput: 'style.json',
    });
    assert.deepEqual(parseCliArgs(['inspect', '-', '--query', 'road']), {
      kind: 'inspect', styleInput: '-', query: 'road',
    });
    assert.deepEqual(parseCliArgs([
      'apply', 'style.json', '--operations', 'ops.json', '--dry-run',
    ]), {
      kind: 'apply', styleInput: 'style.json', operationsInput: 'ops.json',
      dryRun: true, inPlace: false, backup: false,
    });
  });

  it('rejects incompatible inputs and output modes', () => {
    const invalid = [
      ['apply', '-', '--operations', '-'],
      ['apply', 'style.json', '--operations', 'ops.json', '--output', 'out.json', '--in-place'],
      ['apply', 'style.json', '--operations', 'ops.json', '--backup'],
      ['apply', 'style.json', '--operations', 'ops.json', '--dry-run', '--output', 'out.json'],
      ['inspect', 'style.json', '--layer', 'roads', '--source', 'basemap'],
    ];
    for (const argv of invalid) {
      assert.throws(() => parseCliArgs(argv), CliArgumentError);
    }
  });
});
