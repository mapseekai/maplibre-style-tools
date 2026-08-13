import assert from 'node:assert/strict';
import test from 'node:test';

import type { StyleDocument, StyleToolError } from '../core/index.js';
import {
  assertRuntimeImageResourcePolicy,
  assertStyleResourcePolicy,
  collectStyleResourceReferences,
  normalizeResourcePolicy,
  redactResourceUrl,
  type ResourcePolicy,
} from './resource-policy.js';

const emptyStyle = (): StyleDocument => ({ version: 8, sources: {}, layers: [] }) as StyleDocument;
const denyAllPolicy: ResourcePolicy = {
  baseUrl: 'https://app.example/maps/',
  allowedResourceOrigins: [],
};
const networkCapabilities = ['style.write', 'network.load'] as const;

const withGlyphs = (base: StyleDocument, glyphs: string): StyleDocument => ({
  ...base,
  glyphs,
}) as StyleDocument;

const hasCode = (code: StyleToolError['code'], reason?: string) => (error: StyleToolError) =>
  error.code === code && (reason === undefined || error.details?.reason === reason);

test('collects all Style resource-bearing fields with RFC 6901 paths', () => {
  const style = {
    version: 8,
    glyphs: 'https://fonts.example/{fontstack}/{range}.pbf',
    sprite: [{ id: 'base', url: 'https://sprites.example/base' }],
    imports: [{ id: 'theme', url: 'https://styles.example/theme.json' }],
    sources: {
      'vector/a~b': {
        type: 'vector', url: 'https://tiles.example/index.json',
        tiles: ['custom://tiles/{z}/{x}/{y}'],
      },
      geojson: {
        type: 'geojson',
        data: 'data:application/geo+json,%7B%22type%22%3A%22FeatureCollection%22%2C%22features%22%3A%5B%5D%7D',
      },
      image: {
        type: 'image', url: 'https://images.example/overlay.png',
        coordinates: [[0, 0], [1, 0], [1, 1], [0, 1]],
      },
      video: {
        type: 'video', urls: ['https://video.example/a.mp4'],
        coordinates: [[0, 0], [1, 0], [1, 1], [0, 1]],
      },
    },
    layers: [],
    metadata: { ignored: 'https://secret.example/not-a-resource' },
  } as unknown as StyleDocument;
  assert.deepEqual(
    collectStyleResourceReferences(style).map(({ path, value }) => [path, value]),
    [
      ['/glyphs', 'https://fonts.example/{fontstack}/{range}.pbf'],
      ['/imports/0/url', 'https://styles.example/theme.json'],
      ['/sources/geojson/data', 'data:application/geo+json,%7B%22type%22%3A%22FeatureCollection%22%2C%22features%22%3A%5B%5D%7D'],
      ['/sources/image/url', 'https://images.example/overlay.png'],
      ['/sources/vector~1a~0b/tiles/0', 'custom://tiles/{z}/{x}/{y}'],
      ['/sources/vector~1a~0b/url', 'https://tiles.example/index.json'],
      ['/sources/video/urls/0', 'https://video.example/a.mp4'],
      ['/sprite/0/url', 'https://sprites.example/base'],
    ],
  );
});

test('retains only unchanged baseline path-plus-value resources without network.load', () => {
  const baseline = withGlyphs(emptyStyle(), 'https://fonts.example/{fontstack}/{range}.pbf');
  assert.doesNotThrow(() => assertStyleResourcePolicy({
    baseline,
    candidate: structuredClone(baseline),
    capabilities: ['style.write'],
    policy: denyAllPolicy,
  }));
  const copied = {
    ...baseline,
    sources: {
      copy: { type: 'vector', url: baseline.glyphs },
    },
  } as unknown as StyleDocument;
  assert.throws(() => assertStyleResourcePolicy({
    baseline, candidate: copied, capabilities: ['style.write'], policy: denyAllPolicy,
  }), hasCode('CAPABILITY_DENIED'));
});

test('requires network.load and a matching HTTP origin for a new field', () => {
  const baseline = emptyStyle();
  const candidate = withGlyphs(baseline, 'https://fonts.example/{fontstack}/{range}.pbf');
  assert.throws(() => assertStyleResourcePolicy({
    baseline, candidate, capabilities: ['style.write'],
    policy: { ...denyAllPolicy, allowedResourceOrigins: ['https://fonts.example'] },
  }), hasCode('CAPABILITY_DENIED'));
  assert.throws(() => assertStyleResourcePolicy({
    baseline, candidate, capabilities: networkCapabilities, policy: denyAllPolicy,
  }), hasCode('CAPABILITY_DENIED'));
  assert.doesNotThrow(() => assertStyleResourcePolicy({
    baseline, candidate, capabilities: networkCapabilities,
    policy: { ...denyAllPolicy, allowedResourceOrigins: ['https://fonts.example'] },
  }));
});

test('rejects lossy origin entries and validates URL prefixes separately', () => {
  for (const origin of [
    'https://example.test/safe/path?x=1',
    'https://user:password@example.test',
    'https://example.test/#fragment',
    'data:text/plain,opaque',
    'https://*.example.test',
  ]) {
    assert.throws(() => normalizeResourcePolicy({
      ...denyAllPolicy, allowedResourceOrigins: [origin],
    }), /origin/i);
  }
  assert.doesNotThrow(() => normalizeResourcePolicy({
    ...denyAllPolicy,
    allowedResourceOrigins: ['https://example.test/'],
    allowedUrlPrefixes: ['https://example.test/safe/path/'],
  }));
  for (const prefix of [
    'https://user:password@example.test/safe/',
    'https://example.test/safe/#fragment',
  ]) {
    assert.throws(() => normalizeResourcePolicy({
      ...denyAllPolicy, allowedUrlPrefixes: [prefix],
    }), /prefix/i);
  }
});

test('URL prefixes enforce component and path-segment boundaries', () => {
  const policy = {
    ...denyAllPolicy,
    allowedUrlPrefixes: ['https://example.test/safe/path'],
  };
  const baseline = emptyStyle();
  assert.doesNotThrow(() => assertStyleResourcePolicy({
    baseline,
    candidate: withGlyphs(baseline, 'https://example.test/safe/path/font.pbf'),
    capabilities: networkCapabilities,
    policy,
  }));
  assert.throws(() => assertStyleResourcePolicy({
    baseline,
    candidate: withGlyphs(baseline, 'https://example.test/safe/pathology/font.pbf'),
    capabilities: networkCapabilities,
    policy,
  }), hasCode('CAPABILITY_DENIED'));
});

test('data URLs require opt-in and enforce decoded size', () => {
  const baseline = emptyStyle();
  const check = (value: string, policy: ResourcePolicy) => assertStyleResourcePolicy({
    baseline,
    candidate: {
      ...baseline,
      sources: { geojson: { type: 'geojson', data: value } },
    } as unknown as StyleDocument,
    capabilities: networkCapabilities,
    policy,
  });
  assert.throws(() => check('data:text/plain,small', denyAllPolicy), hasCode('CAPABILITY_DENIED'));
  assert.doesNotThrow(() => check('data:text/plain,small', {
    ...denyAllPolicy, allowDataUrls: true, maxDataUrlBytes: 32,
  }));
  assert.throws(() => check(`data:text/plain;base64,${Buffer.alloc(33).toString('base64')}`, {
    ...denyAllPolicy, allowDataUrls: true, maxDataUrlBytes: 32,
  }), /data/i);
  assert.throws(() => check('data:text/plain,%GG', {
    ...denyAllPolicy, allowDataUrls: true, maxDataUrlBytes: 32,
  }), /data/i);
});

test('custom protocols require allowlisting and host registration', () => {
  const baseline = emptyStyle();
  const candidate = {
    ...baseline,
    sources: { tiles: { type: 'vector', tiles: ['pmtiles://catalog/world.pmtiles/{z}/{x}/{y}'] } },
  } as unknown as StyleDocument;
  assert.throws(() => assertStyleResourcePolicy({
    baseline, candidate, capabilities: networkCapabilities,
    policy: { ...denyAllPolicy, allowedProtocols: ['pmtiles'] },
  }), hasCode('CAPABILITY_DENIED'));
  assert.doesNotThrow(() => assertStyleResourcePolicy({
    baseline, candidate, capabilities: networkCapabilities,
    policy: {
      ...denyAllPolicy,
      allowedProtocols: ['pmtiles'],
      isProtocolRegistered: (scheme) => scheme === 'pmtiles',
    },
  }));
});

test('new or changed relative Style URLs are denied under every base configuration', () => {
  const baseline = emptyStyle();
  for (const value of [
    './fonts/{fontstack}/{range}.pbf',
    '../fonts/{fontstack}/{range}.pbf',
    '/fonts/{fontstack}/{range}.pbf',
    '//cdn.example/fonts/{fontstack}/{range}.pbf',
  ]) {
    const candidate = withGlyphs(baseline, value);
    for (const capabilities of [networkCapabilities, ['style.write'] as const]) {
      assert.throws(() => assertStyleResourcePolicy({
        baseline,
        candidate,
        capabilities,
        policy: {
          ...denyAllPolicy,
          baseUrl: 'https://allowed.example/app/',
          allowedResourceOrigins: ['https://allowed.example'],
        },
      }), hasCode('INVALID_INPUT', 'relative-style-url'));
    }
  }
  const retained = withGlyphs(emptyStyle(), './fonts/{fontstack}/{range}.pbf');
  assert.doesNotThrow(() => assertStyleResourcePolicy({
    baseline: retained,
    candidate: structuredClone(retained),
    capabilities: ['style.write'],
    policy: denyAllPolicy,
  }));
});

test('runtime image policy resolves once and returns the canonical authorized URL', () => {
  const decision = assertRuntimeImageResourcePolicy({
    imageId: 'marker/a~b',
    url: './images/marker.png',
    capabilities: networkCapabilities,
    policy: {
      ...denyAllPolicy,
      baseUrl: 'https://allowed.example/app/',
      allowedResourceOrigins: ['https://allowed.example'],
    },
  });
  assert.deepEqual(decision, { resolvedUrl: 'https://allowed.example/app/images/marker.png' });
});

test('redaction strips credentials, query, and fragment without disclosing opaque values', () => {
  assert.equal(
    redactResourceUrl('https://user:pass@example.test/path?q=secret#fragment'),
    'https://example.test/path',
  );
  assert.equal(
    redactResourceUrl('pmtiles://catalog/world.pmtiles?token=secret'),
    'pmtiles://catalog/world.pmtiles',
  );
  assert.equal(redactResourceUrl('data:text/plain,secret'), 'data:[redacted]');
  assert.equal(redactResourceUrl('not a url'), '[redacted]');
});
