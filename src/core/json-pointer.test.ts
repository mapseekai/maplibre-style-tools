import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toJsonPointer } from './json-pointer.js';

test('escapes slash and tilde using RFC 6901', () => {
  assert.equal(toJsonPointer(['sources', 'a/b~c', 'tiles', 0]), '/sources/a~1b~0c/tiles/0');
});

test('represents the document root with an empty pointer', () => {
  assert.equal(toJsonPointer([]), '');
});
