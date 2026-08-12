import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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

const assertCoreDeclarationIsTransportNeutral = (file, text) => {
  assertion(!/\/\/\/\s*<reference\s+types=["']node["']/.test(text),
    `${file} references Node ambient types`);
  assertion(!text.includes('@types/node'), `${file} depends on @types/node`);
  const preprocessed = typescript.preProcessFile(text, true, true);
  for (const reference of preprocessed.libReferenceDirectives) {
    assertion(/^es(?:\d+|next)(?:\.|$)/.test(reference.fileName),
      `${file} references non-core ambient library ${reference.fileName}`);
  }
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
};

assert.throws(
  () => assertCoreDeclarationIsTransportNeutral('dist/core/dom-leak.d.ts', '/// <reference lib="dom" />'),
  /non-core ambient library dom/,
  'the declaration checker must reject DOM triple-slash references',
);

const assertCoreDeclarationsAreTransportNeutral = (files, packageRoot) => {
  const coreDeclarations = files.filter((file) => file.startsWith('dist/core/')
    && file.endsWith('.d.ts'));
  for (const file of coreDeclarations) {
    assertCoreDeclarationIsTransportNeutral(file, source(join(packageRoot, file)));
  }
};

const assertMapLibreDeclarationIsNodeFree = (file, text) => {
  assertion(!/\/\/\/\s*<reference\s+types=["']node["']/.test(text),
    `${file} references Node ambient types`);
  assertion(!text.includes('@types/node'), `${file} depends on @types/node`);
  const preprocessed = typescript.preProcessFile(text, true, true);
  for (const reference of preprocessed.typeReferenceDirectives) {
    assertion(reference.fileName !== 'node' && !reference.fileName.includes('@types/node'),
      `${file} references Node ambient types through ${reference.fileName}`);
  }
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
};

const assertMapLibreDeclarationsAreNodeFree = (files, packageRoot) => {
  const declarations = files.filter((file) =>
    file.startsWith('dist/adapters/maplibre/') && file.endsWith('.d.ts'));
  for (const file of declarations) {
    assertMapLibreDeclarationIsNodeFree(file, source(join(packageRoot, file)));
  }
};

const packedModules = [
  'adapters/maplibre/feature-query',
  'adapters/maplibre/geojson-diff',
  'adapters/maplibre/index',
  'adapters/maplibre/map-adapter',
  'adapters/maplibre/runtime-commands',
  'adapters/maplibre/schemas',
  'adapters/maplibre/style-hash',
  'adapters/maplibre/types',
  'ai-sdk/compact-tools',
  'ai-sdk/compatibility',
  'ai-sdk/full-tools',
  'ai-sdk/index',
  'ai-sdk/result',
  'ai-sdk/schemas',
  'ai-sdk/tool-contracts',
  'core/canonical-json',
  'core/context',
  'core/diff',
  'core/errors',
  'core/geojson-analysis',
  'core/geojson',
  'core/index',
  'core/json-pointer',
  'core/operations/compatibility',
  'core/operations/filters',
  'core/operations/layers',
  'core/operations/root',
  'core/operations/shared',
  'core/operations/sources',
  'core/schemas',
  'core/search',
  'core/transaction',
  'core/types',
  'core/utf8',
  'core/validation',
  'engine/style-context',
  'engine/style-operations',
  'index',
  'tools/compact-tools',
  'types',
];
const packedModuleExtensions = ['.d.ts', '.d.ts.map', '.js', '.js.map'];
const exactPackedFiles = [
  'README.md',
  'package.json',
  ...packedModules.flatMap((module) =>
    packedModuleExtensions.map((extension) => `dist/${module}${extension}`)),
].sort();

const coreConsumer = `import {
  DEFAULT_MAX_DIFF_BYTES,
  DEFAULT_MAX_OPERATIONS,
  DEFAULT_MAX_STYLE_BYTES,
  applyStyleTransaction,
  validateStyleDocument,
} from 'maplibre-style-tools/core';
import type {
  GeoJsonAnalysis,
  GeoJsonAnalysisAvailable,
  GeoJsonAnalysisUnavailable,
  GeoJsonFeature,
  GeoJsonFeatureCollection,
  GeoJsonGeometry,
  GeoJsonGeometryCollection,
  GeoJsonLineString,
  GeoJsonMultiLineString,
  GeoJsonMultiPoint,
  GeoJsonMultiPolygon,
  GeoJsonPoint,
  GeoJsonPolygon,
  InlineGeoJson,
  JsonObject,
  StyleDocument,
  StyleTransaction,
  StyleTransactionResult,
} from 'maplibre-style-tools/core';

type AssertTrue<Value extends true> = Value;
type GeoJsonDtos =
  | GeoJsonPoint
  | GeoJsonMultiPoint
  | GeoJsonLineString
  | GeoJsonMultiLineString
  | GeoJsonPolygon
  | GeoJsonMultiPolygon
  | GeoJsonGeometryCollection
  | GeoJsonFeature
  | GeoJsonFeatureCollection;
type GeoJsonDtosAreJsonObjects = AssertTrue<GeoJsonDtos extends JsonObject ? true : false>;

const point: GeoJsonPoint = {
  type: 'Point',
  coordinates: [1, 2, 3],
  foreignMember: { retained: true },
};
const geometry: GeoJsonGeometry = point;
const feature: GeoJsonFeature<GeoJsonPoint> = {
  type: 'Feature',
  id: 'one',
  geometry: point,
  properties: { name: 'one' },
  foreignMember: ['retained'],
};
const collection: GeoJsonFeatureCollection = {
  type: 'FeatureCollection',
  features: [feature],
  bbox: [1, 2, 1, 2],
};
const inline: InlineGeoJson = collection;
const available: GeoJsonAnalysisAvailable = {
  available: true,
  featureCount: 1,
  geometryTypes: { Point: 1 },
  properties: [],
  warnings: [],
};
const unavailable: GeoJsonAnalysisUnavailable = {
  available: false,
  reason: 'remote-url',
  warnings: [],
};
const narrowAnalysis = (analysis: GeoJsonAnalysis): number | string => {
  if (analysis.available) return analysis.featureCount;
  return analysis.reason;
};

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
// @ts-expect-error /core must not load the DOM document global.
void document;
// @ts-expect-error /core must not load the DOM Window interface.
type CoreMustNotLoadDom = Window;
void [
  false as GeoJsonDtosAreJsonObjects,
  geometry,
  inline,
  available,
  unavailable,
  narrowAnalysis,
  result,
  validateStyleDocument(style),
  DEFAULT_MAX_STYLE_BYTES,
  DEFAULT_MAX_DIFF_BYTES,
  DEFAULT_MAX_OPERATIONS,
];
`;

const maplibreConsumer = `import {
  applyTransactionToMap,
  runtimeGeoJsonSourceDiffSchema,
  sanitizeRuntimeGeoJsonSourceDiff,
} from 'maplibre-style-tools/maplibre';
import type {
  MapStyleApplyResult,
  MapStyleCurrentResult,
  MapStylePreOperationResult,
  MapStyleUnavailableResult,
  PreparedMapStyleTransaction,
  // @ts-expect-error private prepared authority cannot be imported.
  PreparedMapStyleTransactionAuthority,
  PreparedMapStyleTransactionView,
  PreparedStyleApplyOptions,
  RuntimeGeoJsonFeaturePatch,
  RuntimeGeoJsonPropertyPatch,
  RuntimeGeoJsonSourceDiff,
} from 'maplibre-style-tools/maplibre';
import type { JsonObject } from 'maplibre-style-tools/core';
import type { GeoJSONSource, GeoJSONSourceDiff } from 'maplibre-gl';

type AssertTrue<Value extends true> = Value;
type AssertFalse<Value extends false> = Value;
type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
    (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
        (<Value>() => Value extends Left ? 1 : 2)
      ? true
      : false
    : false;
type IsAny<Value> = 0 extends (1 & Value) ? true : false;
type DiffIsJson = AssertTrue<RuntimeGeoJsonSourceDiff extends JsonObject ? true : false>;
type UpdateIsJson = AssertTrue<RuntimeGeoJsonFeaturePatch extends JsonObject ? true : false>;
type PropertyIsJson = AssertTrue<RuntimeGeoJsonPropertyPatch extends JsonObject ? true : false>;
type PropertyValueIsNotAny = AssertFalse<IsAny<
  NonNullable<
    NonNullable<RuntimeGeoJsonFeaturePatch['addOrUpdateProperties']>[number]
  >['value']
>>;
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
type PrivateValueNames =
  | 'preparedMapStyleTransactionBrand'
  | 'preparedMapStyleTransactionHandles'
  | 'preparedMapStyleTransactionAuthorities'
  | 'createPreparedMapStyleTransaction';
type PrivateValuesStayPrivate = AssertTrue<
  Extract<
    PrivateValueNames,
    keyof typeof import('maplibre-style-tools/maplibre')
  > extends never ? true : false
>;

const diff: RuntimeGeoJsonSourceDiff = {
  update: [{
    id: 1,
    addOrUpdateProperties: [{ key: 'name', value: { current: true } }],
  }],
};
const upstreamDiff: GeoJSONSourceDiff = diff;
// @ts-expect-error incremental diff envelopes are closed.
const extraDiff: RuntimeGeoJsonSourceDiff = { removeAll: true, extra: true };
// @ts-expect-error feature patch objects are closed.
const extraUpdate: RuntimeGeoJsonFeaturePatch = { id: 1, removeAllProperties: true, extra: true };
// @ts-expect-error property patch objects are closed.
const extraProperty: RuntimeGeoJsonPropertyPatch = { key: 'name', value: 'road', extra: true };

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
// @ts-expect-error the private brand prevents structural construction.
const forgedPrepared: PreparedMapStyleTransaction = { view: preparedView };
const invalidMaxStyle: PreparedStyleApplyOptions = {
  // @ts-expect-error execution limits are fixed during preparation.
  maxStyleBytes: 1,
};
const invalidMaxDiff: PreparedStyleApplyOptions = {
  // @ts-expect-error execution limits are fixed during preparation.
  maxDiffBytes: 1,
};
const invalidMaxOperations: PreparedStyleApplyOptions = {
  // @ts-expect-error execution limits are fixed during preparation.
  maxOperations: 1,
};
const invalidTimeout: PreparedStyleApplyOptions = {
  // @ts-expect-error timeout is fixed before phase-two apply.
  timeoutMs: 1,
};

declare const source: GeoJSONSource;
declare const prepared: PreparedMapStyleTransaction;
declare const privateAuthority: PreparedMapStyleTransactionAuthority;
if (false) {
  const promise: Promise<void> = source.updateData(upstreamDiff);
  // @ts-expect-error MapLibre 6.3 accepts exactly one updateData argument.
  void source.updateData(upstreamDiff, true);
  // @ts-expect-error the prepared view is readonly.
  prepared.view.baselineHash = 'changed';
  // @ts-expect-error nested prepared Style data is readonly.
  prepared.view.transactionResult.style.layers = [];
  // @ts-expect-error nested prepared options are readonly.
  prepared.view.limitOptions.maxStyleBytes = 1;
  void promise;
  void privateAuthority;
}

type MapFailureError = Extract<MapStyleApplyResult, { ok: false }>['error'];
const requireError = (error: MapFailureError): void => { void error.code; };
const consumeCurrent = (result: MapStyleCurrentResult): void => { void result.style; };
const inspectResult = (result: MapStyleApplyResult): void => {
  switch (result.styleAuthority) {
    case 'current':
      consumeCurrent(result);
      if (result.ok) {
        // @ts-expect-error success has no error member.
        void result.error;
      } else {
        requireError(result.error);
      }
      break;
    case 'pre-operation': {
      const failed: false = result.ok;
      const stale: MapStylePreOperationResult = result;
      requireError(stale.error);
      void stale.style;
      // @ts-expect-error stale state is not current authority.
      consumeCurrent(stale);
      void failed;
      break;
    }
    case 'unavailable': {
      const failed: false = result.ok;
      const unavailable: MapStyleUnavailableResult = result;
      requireError(unavailable.error);
      // @ts-expect-error unavailable state has no Style.
      void unavailable.style;
      // @ts-expect-error unavailable state is not current authority.
      consumeCurrent(unavailable);
      void failed;
      break;
    }
    default: {
      const exhaustive: never = result;
      void exhaustive;
    }
  }
};

// @ts-expect-error /maplibre must not load the Node Buffer global.
void Buffer;
// @ts-expect-error /maplibre must not load the NodeJS namespace.
type MapLibreMustNotLoadNode = NodeJS.Process;
void [
  false as DiffIsJson,
  false as UpdateIsJson,
  false as PropertyIsJson,
  false as PropertyValueIsNotAny,
  false as UpdateDataParametersAreExact,
  false as UpdateDataReturnsPromise,
  false as PreparedStringKeysAreViewOnly,
  false as PrivateValuesStayPrivate,
  extraDiff,
  extraUpdate,
  extraProperty,
  forgedPrepared,
  invalidMaxStyle,
  invalidMaxDiff,
  invalidMaxOperations,
  invalidTimeout,
  inspectResult,
  applyTransactionToMap,
  runtimeGeoJsonSourceDiffSchema,
  sanitizeRuntimeGeoJsonSourceDiff,
];
`;

const rootConsumer = `import {
  createCompactMapLibreStyleTools,
  createMapLibreStyleTools,
} from 'maplibre-style-tools';
import type {
  CreateMapLibreStyleToolsOptions,
  StyleOperation as LegacyStyleOperation,
} from 'maplibre-style-tools';
import {
  createCompactMapLibreStyleTools as createCompactFromAi,
  createMapLibreStyleTools as createFullFromAi,
} from 'maplibre-style-tools/ai';
import type {
  CommonResultInput,
  ParseResult,
} from 'maplibre-style-tools/ai';
import type {
  MapStyleApplyResult,
  MapStyleCurrentResult,
} from 'maplibre-style-tools/maplibre';

const legacy: LegacyStyleOperation = { layerId: 'roads', paint: {} };
type RootOptions = CreateMapLibreStyleToolsOptions;
type RootNodeAmbient = Buffer;
declare const rootOptions: RootOptions;
declare const rootNodeAmbient: RootNodeAmbient;

type MapFailureError = Extract<MapStyleApplyResult, { ok: false }>['error'];
const requireError = (error: MapFailureError): void => { void error.code; };
const consumeCurrent = (result: MapStyleCurrentResult): void => { void result.style; };
const inspectAiEnvelope = (
  envelope: CommonResultInput<MapStyleApplyResult>,
  parsed: ParseResult<string>,
): void => {
  if (envelope.success) {
    // @ts-expect-error successful AI envelopes have no error member.
    void envelope.error;
    const result = envelope.data;
    if (result !== undefined && result.styleAuthority === 'current') {
      consumeCurrent(result);
      if (result.ok) {
        // @ts-expect-error successful Map results have no error member.
        void result.error;
      } else {
        requireError(result.error);
      }
    }
  } else {
    void envelope.error.code;
  }

  if (parsed.ok) {
    // @ts-expect-error successful parse results have no error member.
    void parsed.error;
  } else {
    void parsed.error.code;
  }
};

void createMapLibreStyleTools;
void createCompactMapLibreStyleTools;
void createFullFromAi;
void createCompactFromAi;
void inspectAiEnvelope;
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

const maplibreConfig = `{
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
  "include": ["maplibre-consumer.ts"]
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
  finalizeStyleReplacement,
  inlineGeoJsonSchema,
} from 'maplibre-style-tools/core';
import {
  applyTransactionToMap,
  runtimeGeoJsonSourceDiffSchema,
  sanitizeRuntimeGeoJsonSourceDiff,
} from 'maplibre-style-tools/maplibre';
import {
  createCompactMapLibreStyleTools as createCompactFromAi,
  createMapLibreStyleTools as createFullFromAi,
} from 'maplibre-style-tools/ai';

assert.equal(typeof createMapLibreStyleTools, 'function');
assert.equal(typeof createCompactMapLibreStyleTools, 'function');
assert.equal(createMapLibreStyleTools, createFullFromAi);
assert.equal(createCompactMapLibreStyleTools, createCompactFromAi);
assert.equal(typeof finalizeStyleReplacement, 'function');
assert.equal(typeof inlineGeoJsonSchema.safeParse, 'function');
assert.equal(typeof applyTransactionToMap, 'function');
assert.equal(typeof runtimeGeoJsonSourceDiffSchema.safeParse, 'function');
assert.equal(typeof sanitizeRuntimeGeoJsonSourceDiff, 'function');
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

  const maplibre = await import('maplibre-style-tools/maplibre');
  assertion(typeof maplibre.applyTransactionToMap === 'function',
    'MapLibre transaction adapter is missing');
  assertion(typeof maplibre.runtimeGeoJsonSourceDiffSchema?.safeParse === 'function',
    'MapLibre runtime GeoJSON schema is missing');
  assertion(typeof maplibre.sanitizeRuntimeGeoJsonSourceDiff === 'function',
    'MapLibre runtime GeoJSON sanitizer is missing');

  const ai = await import('maplibre-style-tools/ai');
  assertion(typeof ai.createMapLibreStyleTools === 'function', 'AI full factory is missing');
  assertion(typeof ai.createCompactMapLibreStyleTools === 'function', 'AI compact factory is missing');

  const packed = JSON.parse(command('npm', [
    'pack', '--json', '--ignore-scripts', '--pack-destination', temporary,
  ]));
  assertion(Array.isArray(packed) && packed.length === 1 && Array.isArray(packed[0].files),
    'npm pack did not return a usable JSON file list');
  const packedFiles = packed[0].files.map((file) => file.path).sort();
  for (const required of [
    'dist/index.js',
    'dist/index.d.ts',
    'dist/core/index.js',
    'dist/core/index.d.ts',
    'dist/core/types.d.ts',
    'dist/core/geojson.d.ts',
    'dist/core/geojson-analysis.d.ts',
    'dist/adapters/maplibre/index.js',
    'dist/adapters/maplibre/index.d.ts',
    'dist/adapters/maplibre/geojson-diff.d.ts',
    'dist/ai-sdk/index.js',
    'dist/ai-sdk/index.d.ts',
  ]) assertion(packedFiles.includes(required), `packed tarball is missing ${required}`);
  for (const file of packedFiles) {
    assertion(!file.startsWith('src/') && !file.startsWith('.tmp/') && !file.startsWith('examples/'),
      `packed tarball contains source artifact ${file}`);
    assertion(
      !file.includes('.test.')
        && !file.includes('stale')
        && !file.includes('node_modules/')
        && !file.includes('.gitnexus/')
        && !file.includes('.claude/')
        && !file.includes('.codex/'),
      `packed tarball contains test, cache, or stale artifact ${file}`,
    );
  }
  assert.deepEqual(packedFiles, exactPackedFiles, 'npm pack file list changed');
  assert.deepEqual(
    readdirSync(temporary).filter((file) => file.endsWith('.tgz')),
    [packed[0].filename],
    'package check must create exactly one real tarball',
  );
  const unpacked = join(temporary, 'unpacked');
  command('tar', ['-xzf', join(temporary, packed[0].filename), '-C', temporary]);
  command('mv', [join(temporary, 'package'), unpacked]);
  const rootDeclaration = source(join(unpacked, 'dist/index.d.ts'));
  assertion(rootDeclaration.startsWith('/// <reference types="node" preserve="true" />\n/// <reference types="geojson" preserve="true" />'),
    'root declaration references must preserve node then geojson');
  const aiDeclaration = source(join(unpacked, 'dist/ai-sdk/index.d.ts'));
  assertion(aiDeclaration.startsWith('/// <reference types="node" preserve="true" />\n'),
    'AI declaration must preserve its own root-level node reference');
  assertion(source(join(unpacked, 'dist/core/types.d.ts')).startsWith('/// <reference types="geojson" preserve="true" />'),
    'core type declaration must preserve geojson');
  const nodeReferenceFiles = packedFiles
    .filter((file) => file.endsWith('.d.ts'))
    .filter((file) => /\/\/\/\s*<reference\s+types=["']node["']/.test(
      source(join(unpacked, file)),
    ));
  assert.deepEqual(nodeReferenceFiles, [
    'dist/ai-sdk/full-tools.d.ts',
    'dist/ai-sdk/index.d.ts',
    'dist/index.d.ts',
  ], 'only root and AI declarations may reference Node ambient types');
  assertCoreDeclarationsAreTransportNeutral(packedFiles, unpacked);
  assertMapLibreDeclarationsAreNodeFree(packedFiles, unpacked);

  const consumer = join(temporary, 'consumer');
  command('mkdir', ['-p', consumer]);
  writeFileSync(join(consumer, 'package.json'), '{\n  "private": true,\n  "type": "module"\n}\n');
  command('npm', [
    'install', '--no-save', '--package-lock=false', '--ignore-scripts', '--no-audit', '--no-fund',
    join(temporary, packed[0].filename),
  ], consumer);
  writeFileSync(join(consumer, 'core-consumer.ts'), coreConsumer);
  writeFileSync(join(consumer, 'maplibre-consumer.ts'), maplibreConsumer);
  writeFileSync(join(consumer, 'root-consumer.ts'), rootConsumer);
  writeFileSync(join(consumer, 'tsconfig.core-consumer.json'), coreConfig);
  writeFileSync(join(consumer, 'tsconfig.maplibre-consumer.json'), maplibreConfig);
  writeFileSync(join(consumer, 'tsconfig.root-consumer.json'), rootConfig);
  const installedManifest = JSON.parse(source(join(consumer, 'node_modules/maplibre-style-tools/package.json')));
  assert.equal(installedManifest.dependencies['@types/geojson'], '^7946.0.16');
  assert.equal(installedManifest.dependencies['@types/json-schema'], '^7.0.15');
  assert.equal(installedManifest.dependencies['@types/node'], '^22.20.1');
  assert.deepEqual(installedManifest.exports, {
    '.': {
      types: './dist/index.d.ts',
      import: './dist/index.js',
      default: './dist/index.js',
    },
    './core': {
      types: './dist/core/index.d.ts',
      import: './dist/core/index.js',
      default: './dist/core/index.js',
    },
    './maplibre': {
      types: './dist/adapters/maplibre/index.d.ts',
      import: './dist/adapters/maplibre/index.js',
      default: './dist/adapters/maplibre/index.js',
    },
    './ai': {
      types: './dist/ai-sdk/index.d.ts',
      import: './dist/ai-sdk/index.js',
      default: './dist/ai-sdk/index.js',
    },
  });
  assertion(installedManifest.devDependencies?.['@types/node'] === undefined,
    'the packed manifest must not retain @types/node in devDependencies');
  for (const dependencyType of ['peerDependencies', 'devDependencies', 'optionalDependencies']) {
    assertion(installedManifest[dependencyType]?.['@types/json-schema'] === undefined,
      `the packed manifest must not duplicate @types/json-schema in ${dependencyType}`);
  }
  assert.deepEqual(JSON.parse(source(join(consumer, 'package.json'))), {
    private: true,
    type: 'module',
  });
  const parsedCoreConfig = JSON.parse(coreConfig);
  const parsedMapLibreConfig = JSON.parse(maplibreConfig);
  const parsedRootConfig = JSON.parse(rootConfig);
  for (const [name, config] of [
    ['core', parsedCoreConfig],
    ['maplibre', parsedMapLibreConfig],
    ['root', parsedRootConfig],
  ]) {
    assert.deepEqual(config.compilerOptions.types, [], `${name} consumer must isolate ambient types`);
    assert.equal(config.compilerOptions.skipLibCheck, false,
      `${name} consumer must typecheck every declaration`);
    assert.equal(config.compilerOptions.noEmit, true, `${name} consumer must not emit`);
  }
  assert.equal(parsedCoreConfig.compilerOptions.module, 'NodeNext');
  assert.deepEqual(parsedCoreConfig.compilerOptions.lib, ['ES2023']);
  assert.equal(parsedMapLibreConfig.compilerOptions.module, 'ESNext');
  assert.equal(parsedMapLibreConfig.compilerOptions.moduleResolution, 'Bundler');
  assert.deepEqual(parsedMapLibreConfig.include, ['maplibre-consumer.ts']);
  assert.equal(parsedRootConfig.compilerOptions.module, 'ESNext');
  assert.equal(parsedRootConfig.compilerOptions.moduleResolution, 'Bundler');
  for (const consumerSource of [coreConsumer, maplibreConsumer, rootConsumer]) {
    assertion(!consumerSource.includes('/dist/') && !consumerSource.includes('/src/'),
      'consumer source must use package specifiers rather than internal paths');
  }
  assertion(!coreConsumer.includes('maplibre-style-tools/maplibre')
      && !coreConsumer.includes('maplibre-style-tools/ai')
      && !coreConsumer.includes("from 'maplibre-style-tools';"),
  'core consumer must import only the transport-neutral core subpath');
  assertion(!maplibreConsumer.includes('maplibre-style-tools/ai')
      && !maplibreConsumer.includes("from 'maplibre-style-tools';"),
  'MapLibre consumer must not import the root or AI entry point');
  command(process.execPath, [tsc, '-p', 'tsconfig.core-consumer.json', '--noEmit'], consumer);
  command(process.execPath, [tsc, '-p', 'tsconfig.maplibre-consumer.json', '--noEmit'], consumer);
  command(process.execPath, [tsc, '-p', 'tsconfig.root-consumer.json', '--noEmit'], consumer);
  writeFileSync(join(consumer, 'runtime-smoke.mjs'), runtimeSmoke);
  command(process.execPath, ['runtime-smoke.mjs'], consumer);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
