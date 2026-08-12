import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GeoJSONSource, GeoJSONSourceDiff } from 'maplibre-gl';
import type {
  GeoJsonAnalysis,
  GeoJsonAnalysisAvailable,
  GeoJsonAnalysisUnavailable,
  GeoJsonBbox,
  GeoJsonBbox2D,
  GeoJsonBbox3D,
  GeoJsonFeature,
  GeoJsonFeatureCollection,
  GeoJsonFeatureId,
  GeoJsonGeometry,
  GeoJsonGeometryCollection,
  GeoJsonLineCoordinates,
  GeoJsonLineString,
  GeoJsonLinearRing,
  GeoJsonMultiLineString,
  GeoJsonMultiPoint,
  GeoJsonMultiPolygon,
  GeoJsonPoint,
  GeoJsonPolygon,
  GeoJsonPolygonCoordinates,
  GeoJsonPosition,
  InlineGeoJson,
  JsonObject,
  StyleDocument,
  StyleToolError,
} from 'maplibre-style-tools/core';
import type {
  MapStyleApplyResult,
  MapStyleCurrentResult,
  MapStylePreOperationResult,
  MapStyleUnavailableResult,
  PreparedMapStyleTransaction,
  // @ts-expect-error prepared authority is module-private and cannot be imported.
  PreparedMapStyleTransactionAuthority,
  PreparedMapStyleTransactionView,
  PreparedStyleApplyOptions,
  RuntimeGeoJsonFeaturePatch,
  RuntimeGeoJsonPropertyPatch,
  RuntimeGeoJsonSourceDiff,
} from 'maplibre-style-tools/maplibre';
import type {
  CommonResultInput,
  ParseResult,
} from 'maplibre-style-tools/ai';

type AssertTrue<Value extends true> = Value;
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
    (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
        (<Value>() => Value extends Left ? 1 : 2)
      ? true
      : false
    : false;

type DiffIsJson = AssertTrue<RuntimeGeoJsonSourceDiff extends JsonObject ? true : false>;
type FeaturePatchIsJson = AssertTrue<
  RuntimeGeoJsonFeaturePatch extends JsonObject ? true : false
>;
type PropertyPatchIsJson = AssertTrue<
  RuntimeGeoJsonPropertyPatch extends JsonObject ? true : false
>;
type UpdateDataParametersAreExact = AssertTrue<Equal<
  Parameters<GeoJSONSource['updateData']>,
  [diff: GeoJSONSourceDiff]
>>;
type UpdateDataReturnsPromise = AssertTrue<Equal<
  ReturnType<GeoJSONSource['updateData']>,
  Promise<void>
>>;
type PreparedStringKeysAreViewOnly = AssertTrue<Equal<
  Extract<keyof PreparedMapStyleTransaction, string>,
  'view'
>>;
type PrivateMapLibreValueNames =
  | 'preparedMapStyleTransactionBrand'
  | 'preparedMapStyleTransactionHandles'
  | 'preparedMapStyleTransactionAuthorities'
  | 'createPreparedMapStyleTransaction';
type PrivateMapLibreValuesStayPrivate = AssertTrue<
  Extract<
    PrivateMapLibreValueNames,
    keyof typeof import('maplibre-style-tools/maplibre')
  > extends never ? true : false
>;

const staticAssertions: [
  DiffIsJson,
  FeaturePatchIsJson,
  PropertyPatchIsJson,
  UpdateDataParametersAreExact,
  UpdateDataReturnsPromise,
  PreparedStringKeysAreViewOnly,
  PrivateMapLibreValuesStayPrivate,
] = [true, true, true, true, true, true, true];

const position: GeoJsonPosition = [0, 1, 2];
const bbox2D: GeoJsonBbox2D = [0, 1, 2, 3];
const bbox3D: GeoJsonBbox3D = [0, 1, 2, 3, 4, 5];
const bbox: GeoJsonBbox = bbox2D;
const lineCoordinates: GeoJsonLineCoordinates = [[0, 0], [1, 1]];
const linearRing: GeoJsonLinearRing = [
  [0, 0], [1, 0], [1, 1], [0, 0],
];
const polygonCoordinates: GeoJsonPolygonCoordinates = [linearRing];
const point: GeoJsonPoint = {
  type: 'Point', coordinates: position, bbox, vendor: { retained: true },
};
const multiPoint: GeoJsonMultiPoint = {
  type: 'MultiPoint', coordinates: [[0, 0], [1, 1]], bbox: bbox3D,
};
const lineString: GeoJsonLineString = {
  type: 'LineString', coordinates: lineCoordinates,
};
const multiLineString: GeoJsonMultiLineString = {
  type: 'MultiLineString', coordinates: [lineCoordinates],
};
const polygon: GeoJsonPolygon = {
  type: 'Polygon', coordinates: polygonCoordinates,
};
const multiPolygon: GeoJsonMultiPolygon = {
  type: 'MultiPolygon', coordinates: [polygonCoordinates],
};
const geometryCollection: GeoJsonGeometryCollection = {
  type: 'GeometryCollection', geometries: [point, polygon],
};
const geometry: GeoJsonGeometry = geometryCollection;
const featureId: GeoJsonFeatureId = 'feature-1';
const feature: GeoJsonFeature<GeoJsonPoint> = {
  type: 'Feature', id: featureId, geometry: point, properties: { name: 'one' },
};
const featureCollection: GeoJsonFeatureCollection = {
  type: 'FeatureCollection', features: [feature], bbox: bbox2D,
};
const inlineGeoJson: InlineGeoJson = featureCollection;
const availableAnalysis: GeoJsonAnalysisAvailable = {
  available: true,
  featureCount: 1,
  geometryTypes: { Point: 1 },
  bbox: [0, 0, 1, 1],
  properties: [],
  warnings: [],
};
const unavailableAnalysis: GeoJsonAnalysisUnavailable = {
  available: false,
  reason: 'remote-url',
  warnings: [],
};

function narrowAnalysis(analysis: GeoJsonAnalysis): number | string {
  if (analysis.available) {
    const narrowed: GeoJsonAnalysisAvailable = analysis;
    return narrowed.featureCount;
  }
  const narrowed: GeoJsonAnalysisUnavailable = analysis;
  return narrowed.reason;
}

// @ts-expect-error incremental diff envelopes are closed.
const extraDiff: RuntimeGeoJsonSourceDiff = { removeAll: true, extra: true };
const extraFeaturePatch: RuntimeGeoJsonFeaturePatch = {
  id: 1,
  removeAllProperties: true,
  // @ts-expect-error feature patch objects are closed.
  extra: true,
};
const extraPropertyPatch: RuntimeGeoJsonPropertyPatch = {
  key: 'name',
  value: 'road',
  // @ts-expect-error property patch objects are closed.
  extra: true,
};

const preparedView: PreparedMapStyleTransactionView = {
  baselineHash: 'baseline',
  transactionResult: {
    ok: true,
    style: { version: 8, sources: {}, layers: [] },
    changedLayers: [],
    changedSources: [],
    diff: [],
    warnings: [],
  },
  limitOptions: {},
};
// @ts-expect-error the module-private brand prevents structural construction.
const forgedPrepared: PreparedMapStyleTransaction = { view: preparedView };
const maxStyleOptions: PreparedStyleApplyOptions = {
  // @ts-expect-error execution limits are fixed during preparation.
  maxStyleBytes: 1,
};
const maxDiffOptions: PreparedStyleApplyOptions = {
  // @ts-expect-error execution limits are fixed during preparation.
  maxDiffBytes: 1,
};
const maxOperationOptions: PreparedStyleApplyOptions = {
  // @ts-expect-error execution limits are fixed during preparation.
  maxOperations: 1,
};
const timeoutOptions: PreparedStyleApplyOptions = {
  // @ts-expect-error execution timeout is fixed before phase-two apply.
  timeoutMs: 1,
};

declare const prepared: PreparedMapStyleTransaction;
declare const privateAuthority: PreparedMapStyleTransactionAuthority;

function inspectPreparedContract(): void {
  // @ts-expect-error the public inspection view is deeply readonly.
  prepared.view.baselineHash = 'changed';
  // @ts-expect-error nested transaction data is deeply readonly.
  prepared.view.transactionResult.style.layers = [];
  // @ts-expect-error nested limit options are deeply readonly.
  prepared.view.limitOptions.maxStyleBytes = 1;
  void privateAuthority;
}

function compileUpdateDataContract(
  source: GeoJSONSource,
  diff: RuntimeGeoJsonSourceDiff,
): Promise<void> {
  const compatible: GeoJSONSourceDiff = diff;
  // @ts-expect-error MapLibre 6.3 accepts exactly one updateData argument.
  void source.updateData(compatible, true);
  return source.updateData(compatible);
}

function requireAuthenticError(error: StyleToolError): StyleToolError {
  return error;
}

function consumeAuthoritativeMapResult(result: MapStyleCurrentResult): StyleDocument {
  return result.style;
}

function inspectMapResult(result: MapStyleApplyResult): StyleDocument | undefined {
  switch (result.styleAuthority) {
    case 'current': {
      consumeAuthoritativeMapResult(result);
      if (result.ok) {
        // @ts-expect-error successful results have no error member.
        void result.error;
      } else {
        requireAuthenticError(result.error);
      }
      return result.style;
    }
    case 'pre-operation': {
      const failed: false = result.ok;
      const stale: MapStylePreOperationResult = result;
      requireAuthenticError(stale.error);
      // @ts-expect-error stale pre-operation state is not current authority.
      consumeAuthoritativeMapResult(stale);
      void failed;
      return stale.style;
    }
    case 'unavailable': {
      const failed: false = result.ok;
      const unavailable: MapStyleUnavailableResult = result;
      requireAuthenticError(unavailable.error);
      // @ts-expect-error unavailable results have no style member.
      void unavailable.style;
      // @ts-expect-error unavailable state is not current authority.
      consumeAuthoritativeMapResult(unavailable);
      void failed;
      return undefined;
    }
    default: {
      const exhaustive: never = result;
      return exhaustive;
    }
  }
}

function inspectAiContracts(
  parsed: ParseResult<string>,
  common: CommonResultInput<{ count: number }, StyleDocument>,
  error: StyleToolError,
): void {
  const parseSuccess: ParseResult<string> = { ok: true, value: 'value' };
  const parseFailure: ParseResult<string> = { ok: false, error };
  if (parsed.ok) {
    // @ts-expect-error successful parse results have no error member.
    void parsed.error;
  } else {
    requireAuthenticError(parsed.error);
  }
  if (common.success) {
    // @ts-expect-error successful common results have no error member.
    void common.error;
  } else {
    requireAuthenticError(common.error);
  }
  void parseSuccess;
  void parseFailure;
}

void [
  staticAssertions,
  bbox3D,
  multiPoint,
  lineString,
  multiLineString,
  multiPolygon,
  geometry,
  inlineGeoJson,
  availableAnalysis,
  unavailableAnalysis,
  narrowAnalysis,
  extraDiff,
  extraFeaturePatch,
  extraPropertyPatch,
  forgedPrepared,
  maxStyleOptions,
  maxDiffOptions,
  maxOperationOptions,
  timeoutOptions,
  inspectPreparedContract,
  compileUpdateDataContract,
  inspectMapResult,
  inspectAiContracts,
];

test('loads transport-neutral core without MapLibre or AI SDK side effects', async () => {
  const core = await import('maplibre-style-tools/core');
  assert.equal(typeof core.applyStyleTransaction, 'function');
  assert.equal(typeof core.finalizeStyleReplacement, 'function');
  assert.equal(typeof core.analyzeGeoJson, 'function');
  assert.equal(typeof core.inlineGeoJsonSchema?.safeParse, 'function');
  assert.equal(typeof core.geoJsonAnalysisInputSchema?.safeParse, 'function');
  assert.equal(typeof core.listSourceLayers, 'function');
});

test('loads explicit AI and MapLibre entry points', async () => {
  const ai = await import('maplibre-style-tools/ai');
  const maplibre = await import('maplibre-style-tools/maplibre');
  assert.equal(typeof ai.createMapLibreStyleTools, 'function');
  assert.equal(typeof ai.createCompactMapLibreStyleTools, 'function');
  assert.equal(typeof maplibre.applyTransactionToMap, 'function');
  assert.equal(typeof maplibre.runtimeGeoJsonSourceDiffSchema?.safeParse, 'function');
  assert.equal(typeof maplibre.sanitizeRuntimeGeoJsonSourceDiff, 'function');
});

test('keeps package-owned runtime GeoJSON diff schemas closed', async () => {
  const maplibre = await import('maplibre-style-tools/maplibre');
  const cases = [
    { removeAll: true, extra: true },
    { update: [{ id: 1, removeAllProperties: true, extra: true }] },
    {
      update: [{
        id: 1,
        addOrUpdateProperties: [{ key: 'name', value: 'road', extra: true }],
      }],
    },
  ];
  for (const value of cases) {
    assert.equal(maplibre.runtimeGeoJsonSourceDiffSchema.safeParse(value).success, false);
  }

  const validated = maplibre.runtimeGeoJsonSourceDiffSchema.safeParse({ removeAll: true });
  assert.equal(validated.success, true);
  if (!validated.success) return;
  const compatible: GeoJSONSourceDiff = validated.data;
  assert.deepEqual(compatible, { removeAll: true });
});
