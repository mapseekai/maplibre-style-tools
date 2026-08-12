import assert from 'node:assert/strict';
import test from 'node:test';
import {
  analyzeGeoJson as publicAnalyzeGeoJson,
  geoJsonAnalysisInputSchema as publicGeoJsonAnalysisInputSchema,
  geoJsonAnalysisOptionsSchema as publicGeoJsonAnalysisOptionsSchema,
} from './index.js';
import {
  analyzeGeoJson,
  geoJsonAnalysisInputSchema,
  geoJsonAnalysisOptionsSchema,
} from './geojson-analysis.js';
import type {
  GeoJsonAnalysis,
  GeoJsonAnalysisAvailable,
  GeoJsonAnalysisInput,
  GeoJsonAnalysisOptions,
  GeoJsonAnalysisResult,
  GeoJsonAnalysisUnavailable,
  GeoJsonGeometryCounts,
  GeoJsonGeometryType,
  GeoJsonPropertyAnalysis,
  GeoJsonPropertyType,
} from './types.js';

const geometryType: GeoJsonGeometryType = 'Point';
const propertyType: GeoJsonPropertyType = 'number';
const geometryCounts: GeoJsonGeometryCounts = { Point: 1 };
const propertyAnalysis: GeoJsonPropertyAnalysis = {
  name: 'population',
  types: ['number'],
  numericRange: { min: 1, max: 2 },
  topValues: [{ value: 1, count: 1 }],
};
const options: GeoJsonAnalysisOptions = {
  topValueLimit: 2,
  limits: { maxFeatures: 10 },
};
const input: GeoJsonAnalysisInput = {
  type: 'Point', coordinates: [0, 0],
};
const unavailable: GeoJsonAnalysisUnavailable = {
  available: false,
  reason: 'remote-url',
  warnings: [],
};
const available: GeoJsonAnalysisAvailable = {
  available: true,
  featureCount: 0,
  geometryTypes: { Point: 1 },
  bbox: [0, 0, 0, 0],
  properties: [],
  warnings: [],
};
const analysis: GeoJsonAnalysis = available;
const result: GeoJsonAnalysisResult = { ok: true, analysis };

function assertAnalysisNarrowing(value: GeoJsonAnalysis): void {
  if (value.available) {
    const count: number = value.featureCount;
    void count;
    // @ts-expect-error -- unavailable-only discriminator field.
    void value.reason;
  } else {
    const reason: 'remote-url' = value.reason;
    void reason;
    // @ts-expect-error -- available-only analysis field.
    void value.featureCount;
  }
}

const compileAssertions = [
  geometryType === 'Point',
  propertyType === 'number',
  geometryCounts.Point === 1,
  propertyAnalysis.name === 'population',
  options.topValueLimit === 2,
  input.type === 'Point',
  unavailable.reason === 'remote-url',
  available.featureCount === 0,
  result.ok,
] as const;
assertAnalysisNarrowing(unavailable);

function assertInvalid(value: unknown, analysisOptions?: GeoJsonAnalysisOptions): void {
  const analyzed = analyzeGeoJson(value, analysisOptions);
  assert.equal(analyzed.ok, false);
  if (analyzed.ok) assert.fail('expected invalid input');
  assert.equal(analyzed.error.code, 'INVALID_INPUT');
  assert.equal(Object.hasOwn(analyzed, 'analysis'), false);
}

function transparent<Value extends object>(
  value: Value,
  onGet: () => void,
): Value {
  return new Proxy(value, {
    get() {
      onGet();
      throw new Error('must not invoke getter traps');
    },
  });
}

test('analyzes inline features with deterministic geometry, bbox, properties, and warnings', () => {
  const document = {
    type: 'FeatureCollection' as const,
    features: [
      {
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [4, 9, 99] },
        properties: {
          category: 'beta', mixed: 2, nullable: null, complex: [1],
          flag: true, score: 10,
        },
      },
      {
        type: 'Feature' as const,
        geometry: {
          type: 'LineString' as const,
          coordinates: [[-5, 7], [3, -2]],
        },
        properties: {
          category: 'alpha', mixed: 'two', nullable: 'present', complex: { value: 1 },
          flag: false, score: -5,
        },
      },
      {
        type: 'Feature' as const,
        geometry: {
          type: 'Polygon' as const,
          coordinates: [[[-2, -1], [8, -1], [8, 12], [-2, -1]]],
        },
        properties: {
          category: 'beta', mixed: 2, complex: [2], flag: true, score: 10,
        },
      },
      {
        type: 'Feature' as const,
        geometry: {
          type: 'GeometryCollection' as const,
          geometries: [
            { type: 'Point' as const, coordinates: [20, 30] },
            { type: 'MultiPoint' as const, coordinates: [[1, 40], [2, 5]] },
          ],
        },
        properties: {
          category: 'gamma', mixed: true, complex: null, flag: true, score: 4,
        },
      },
      {
        type: 'Feature' as const,
        geometry: null,
        properties: { category: 'alpha', mixed: null },
      },
    ],
  };

  assert.deepEqual(analyzeGeoJson(document, { topValueLimit: 2 }), {
    ok: true,
    analysis: {
      available: true,
      featureCount: 5,
      geometryTypes: {
        Point: 2,
        MultiPoint: 1,
        LineString: 1,
        Polygon: 1,
        GeometryCollection: 1,
      },
      bbox: [-5, -2, 20, 40],
      properties: [
        {
          name: 'category',
          types: ['string'],
          topValues: [
            { value: 'alpha', count: 2 },
            { value: 'beta', count: 2 },
          ],
        },
        {
          name: 'complex',
          types: ['null', 'array', 'object'],
          topValues: [{ value: null, count: 1 }],
        },
        {
          name: 'flag',
          types: ['boolean'],
          topValues: [
            { value: true, count: 3 },
            { value: false, count: 1 },
          ],
        },
        {
          name: 'mixed',
          types: ['string', 'number', 'boolean', 'null'],
          numericRange: { min: 2, max: 2 },
          topValues: [
            { value: 2, count: 2 },
            { value: null, count: 1 },
          ],
        },
        {
          name: 'nullable',
          types: ['string', 'null'],
          topValues: [
            { value: null, count: 1 },
            { value: 'present', count: 1 },
          ],
        },
        {
          name: 'score',
          types: ['number'],
          numericRange: { min: -5, max: 10 },
          topValues: [
            { value: 10, count: 2 },
            { value: -5, count: 1 },
          ],
        },
      ],
      warnings: [
        {
          code: 'GEOJSON_PROPERTY_UNSUPPORTED',
          message: 'Property "complex" contains array or object values.',
          path: '/properties/complex',
        },
        {
          code: 'GEOJSON_PROPERTY_MIXED_TYPES',
          message: 'Property "complex" contains mixed value types.',
          path: '/properties/complex',
        },
        {
          code: 'GEOJSON_PROPERTY_MIXED_TYPES',
          message: 'Property "mixed" contains mixed value types.',
          path: '/properties/mixed',
        },
        {
          code: 'GEOJSON_PROPERTY_MIXED_TYPES',
          message: 'Property "nullable" contains mixed value types.',
          path: '/properties/nullable',
        },
      ],
    },
  });
  assert.deepEqual(compileAssertions, [
    true, true, true, true, true, true, true, true, true,
  ]);
  assert.strictEqual(publicAnalyzeGeoJson, analyzeGeoJson);
  assert.strictEqual(publicGeoJsonAnalysisInputSchema, geoJsonAnalysisInputSchema);
  assert.strictEqual(publicGeoJsonAnalysisOptionsSchema, geoJsonAnalysisOptionsSchema);
});

test('returns immediate deterministic unavailability for non-empty string inputs', () => {
  const originalFetch = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  let fetchCalls = 0;
  const unexpectedFetch: typeof globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('remote GeoJSON must not be fetched');
  };
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true, value: unexpectedFetch, writable: true,
  });
  try {
    const url = '  https://example.test/data.geojson  ';
    assert.equal(geoJsonAnalysisInputSchema.parse(url), url);
    assert.deepEqual(analyzeGeoJson(url), {
      ok: true,
      analysis: {
        available: false,
        reason: 'remote-url',
        warnings: [{
          code: 'GEOJSON_ANALYSIS_UNAVAILABLE',
          message: 'Remote GeoJSON cannot be analyzed without fetching it.',
        }],
      },
    });
    assert.equal(fetchCalls, 0);
  } finally {
    if (originalFetch === undefined) {
      Reflect.deleteProperty(globalThis, 'fetch');
    } else {
      Object.defineProperty(globalThis, 'fetch', originalFetch);
    }
  }
});

test('rejects invalid inputs, options, and nested limits without partial analysis', () => {
  for (const value of ['', '   ', null, { type: 'Point', coordinates: [0] }]) {
    assertInvalid(value);
  }
  assertInvalid({
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: null, properties: null },
      { type: 'Feature', geometry: null, properties: null },
    ],
  }, { limits: { maxFeatures: 1 } });
  for (const topValueLimit of [
    0, -1, 1.5, 101, Number.NaN, Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assertInvalid({ type: 'Point', coordinates: [0, 0] }, { topValueLimit });
  }
  assertInvalid(
    { type: 'Point', coordinates: [0, 0] },
    { unknown: true } as unknown as GeoJsonAnalysisOptions,
  );
  assertInvalid(
    { type: 'Point', coordinates: [0, 0] },
    { limits: { maxFeatures: 0 } },
  );

  let inputGetCalls = 0;
  const unreadableInput = new Proxy({ type: 'Point', coordinates: [0, 0] }, {
    get() {
      inputGetCalls += 1;
      throw new Error('input must not be traversed when options are invalid');
    },
    ownKeys() {
      inputGetCalls += 1;
      throw new Error('input must not be traversed when options are invalid');
    },
  });
  assertInvalid(unreadableInput, { topValueLimit: 0 });
  assert.equal(inputGetCalls, 0);
});

test('analysis schemas reject hostile graphs without getters and snapshot safe proxies', () => {
  let getterCalls = 0;
  const accessor: Record<string, unknown> = {};
  Object.defineProperty(accessor, 'topValueLimit', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('must not run');
    },
  });
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const aliased = { maxFeatures: 1 };
  const dangerous: Record<string, unknown> = {};
  Object.defineProperty(dangerous, '__proto__', {
    configurable: true, enumerable: true, value: true, writable: true,
  });
  const hostileOptions: readonly unknown[] = [
    accessor,
    cyclic,
    { limits: aliased, repeated: aliased },
    { limits: new Date() },
    dangerous,
  ];
  for (const value of hostileOptions) {
    assert.equal(geoJsonAnalysisOptionsSchema.safeParse(value).success, false);
  }

  const inputCycle: Record<string, unknown> = {
    type: 'Point', coordinates: [0, 0],
  };
  inputCycle.self = inputCycle;
  const propertyAlias = { value: true };
  const hostileInputs: readonly unknown[] = [
    accessor,
    inputCycle,
    {
      type: 'Feature', geometry: null,
      properties: { first: propertyAlias, second: propertyAlias },
    },
    { type: 'Point', coordinates: [0, 0], foreign: new Date() },
    dangerous,
  ];
  for (const value of hostileInputs) {
    assert.equal(geoJsonAnalysisInputSchema.safeParse(value).success, false);
  }
  assert.equal(getterCalls, 0);

  let proxyGetCalls = 0;
  const parsedOptions = geoJsonAnalysisOptionsSchema.parse(transparent({
    topValueLimit: 3,
    limits: transparent({ maxFeatures: 4 }, () => { proxyGetCalls += 1; }),
  }, () => { proxyGetCalls += 1; }));
  assert.equal(proxyGetCalls, 0);
  assert.deepEqual(parsedOptions, { topValueLimit: 3, limits: { maxFeatures: 4 } });
  assert.equal(Object.getPrototypeOf(parsedOptions), Object.prototype);
  assert.equal(Object.getPrototypeOf(parsedOptions.limits), Object.prototype);
  assert.deepEqual(geoJsonAnalysisOptionsSchema.parse({}), { topValueLimit: 10 });

  const originalInput = {
    type: 'Point' as const,
    coordinates: transparent([1, 2], () => { proxyGetCalls += 1; }),
  };
  const parsedInput = geoJsonAnalysisInputSchema.parse(
    transparent(originalInput, () => { proxyGetCalls += 1; }),
  );
  assert.equal(proxyGetCalls, 0);
  assert.deepEqual(parsedInput, { type: 'Point', coordinates: [1, 2] });
  assert.notStrictEqual(parsedInput, originalInput);
  assert.equal(typeof parsedInput === 'string', false);
  if (typeof parsedInput !== 'string') {
    assert.equal(Object.getPrototypeOf(parsedInput), Object.prototype);
  }
});

test('uses UTF-16 code-unit ordering independent of feature and key encounter order', () => {
  const composed = '\u00e9';
  const decomposed = 'e\u0301';
  const feature = (
    firstName: string,
    secondName: string,
    firstValue: string,
    secondValue: string,
  ) => ({
    type: 'Feature' as const,
    geometry: null,
    properties: {
      [firstName]: firstName,
      [secondName]: secondName,
      category: firstValue,
      repeated: secondValue,
    },
  });
  const forward = {
    type: 'FeatureCollection' as const,
    features: [
      feature(composed, decomposed, composed, decomposed),
      feature(decomposed, composed, decomposed, composed),
    ],
  };
  const reverse = {
    type: 'FeatureCollection' as const,
    features: [
      feature(composed, decomposed, decomposed, composed),
      feature(decomposed, composed, composed, decomposed),
    ],
  };

  const first = analyzeGeoJson(forward);
  const second = analyzeGeoJson(reverse);
  assert.deepEqual(first, second);
  assert.equal(first.ok, true);
  if (!first.ok || !first.analysis.available) {
    assert.fail('expected inline analysis');
  }
  assert.deepEqual(first.analysis.properties.map((property) => property.name), [
    'category', decomposed, 'repeated', composed,
  ]);
  assert.deepEqual(
    first.analysis.properties.find((property) => property.name === 'category')?.topValues,
    [
      { value: decomposed, count: 1 },
      { value: composed, count: 1 },
    ],
  );
});

test('escapes property names in warning JSON Pointer paths', () => {
  const propertyName = 'a/b~c';
  const result = analyzeGeoJson({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature', geometry: null,
        properties: { [propertyName]: [] },
      },
      {
        type: 'Feature', geometry: null,
        properties: { [propertyName]: 'value' },
      },
    ],
  });
  assert.equal(result.ok, true);
  if (!result.ok || !result.analysis.available) assert.fail('expected inline analysis');
  assert.deepEqual(result.analysis.warnings, [
    {
      code: 'GEOJSON_PROPERTY_UNSUPPORTED',
      message: 'Property "a/b~c" contains array or object values.',
      path: '/properties/a~1b~0c',
    },
    {
      code: 'GEOJSON_PROPERTY_MIXED_TYPES',
      message: 'Property "a/b~c" contains mixed value types.',
      path: '/properties/a~1b~0c',
    },
  ]);
});

test('analyzes 4000 nested geometry collections within a raised depth limit', {
  timeout: 5_000,
}, () => {
  let geometry: unknown = { type: 'Point', coordinates: [0, 0] };
  for (let depth = 0; depth < 4_000; depth += 1) {
    geometry = { type: 'GeometryCollection', geometries: [geometry] };
  }
  assert.deepEqual(analyzeGeoJson(geometry, {
    limits: { maxGeometryDepth: 4_001 },
  }), {
    ok: true,
    analysis: {
      available: true,
      featureCount: 0,
      geometryTypes: { Point: 1, GeometryCollection: 4_000 },
      bbox: [0, 0, 0, 0],
      properties: [],
      warnings: [],
    },
  });
});
