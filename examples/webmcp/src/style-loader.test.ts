import assert from 'node:assert/strict';
import test from 'node:test';

import type { StyleDocument } from 'maplibre-style-tools/core';

import { parseStyleJson, parseStyleUrl, styleForExport } from './style-loader.js';

test('parseStyleUrl accepts http(s) URLs and normalizes them', () => {
  assert.deepEqual(parseStyleUrl('  https://example.test/style.json  '), { ok: true, url: 'https://example.test/style.json' });
  assert.deepEqual(parseStyleUrl('http://127.0.0.1:5175/style.json'), { ok: true, url: 'http://127.0.0.1:5175/style.json' });
});

test('parseStyleUrl rejects empty, malformed, and non-http values', () => {
  assert.deepEqual(parseStyleUrl('   '), { ok: false, error: '请输入样式 URL。' });
  assert.deepEqual(parseStyleUrl('not a url'), { ok: false, error: '样式 URL 无效。' });
  assert.deepEqual(parseStyleUrl('file:///etc/passwd'), { ok: false, error: '样式 URL 必须使用 http 或 https 协议。' });
});

test('parseStyleJson accepts a minimal valid style document', () => {
  const result = parseStyleJson('{ "version": 8, "sources": {}, "layers": [] }');
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.style, { version: 8, sources: {}, layers: [] });
});

test('parseStyleJson rejects empty, invalid, and non-style documents', () => {
  assert.deepEqual(parseStyleJson(' '), { ok: false, error: '请粘贴样式 JSON 文档。' });
  assert.deepEqual(parseStyleJson('{ nope'), { ok: false, error: '样式 JSON 不是合法的 JSON。' });
  assert.deepEqual(parseStyleJson('[1]'), { ok: false, error: '样式 JSON 必须是 JSON 对象。' });
  assert.deepEqual(parseStyleJson('{"layers": []}'), { ok: false, error: '样式 JSON 必须声明 "version": 8。' });
  assert.deepEqual(parseStyleJson('{"version": 8}'), { ok: false, error: '样式 JSON 必须包含 "layers" 数组。' });
});

test('styleForExport removes internal highlight overlay layers only', () => {
  const style = {
    version: 8,
    sources: { maplibre: { type: 'vector', url: 'https://demotiles.maplibre.org/tiles/tiles.json' } },
    layers: [
      { id: 'background', type: 'background' },
      { id: 'countries-fill', type: 'fill', source: 'maplibre', 'source-layer': 'countries' },
      { id: 'webmcp-comment-highlight:maplibre:countries:Polygon', type: 'fill', source: 'maplibre', 'source-layer': 'countries' },
      { id: 'webmcp-comment-highlight:match:draft', type: 'line', source: 'maplibre' },
    ],
  } as unknown as StyleDocument;
  const exported = styleForExport(style);
  assert.deepEqual(exported.layers.map((layer) => layer.id), ['background', 'countries-fill']);
  // Input is not mutated.
  assert.equal(style.layers.length, 4);
  assert.equal(exported.version, 8);
  assert.deepEqual(exported.sources, style.sources);
});
