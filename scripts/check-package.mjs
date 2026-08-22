import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { builtinModules, createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const typescript = require('typescript');
const tsc = require.resolve('typescript/bin/tsc');
const root = process.cwd();
const assertion = (condition, message) => assert.ok(condition, message);
const source = (file) => readFileSync(file, 'utf8');

const browserClosureRequiredModules = [
  'dist/bridge/index.js',
  'dist/bridge/client.js',
  'dist/bridge/protocol.js',
  'dist/bridge/codec.js',
  'dist/bridge/capabilities.js',
  'dist/bridge/outbound.js',
  'dist/bridge/resource-policy.js',
  'dist/bridge/browser-runtime.js',
];

const builtinSpecifiers = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

const isInside = (parent, candidate) => {
  const child = relative(parent, candidate);
  return child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child));
};

const assertBrowserClosure = ({
  entry,
  packageRoot,
  requireProductionModules,
}) => {
  const canonicalPackageRoot = realpathSync(packageRoot);
  const canonicalEntry = realpathSync(entry);
  assertion(isInside(canonicalPackageRoot, canonicalEntry),
    `browser closure entry escapes package root: ${entry}`);
  const visited = new Set();

  const visitFile = (file) => {
    const canonicalFile = realpathSync(file);
    assertion(isInside(canonicalPackageRoot, canonicalFile),
      `browser closure edge escapes package root: ${file}`);
    if (visited.has(canonicalFile)) return;
    assertion(statSync(canonicalFile).isFile(),
      `browser closure edge is not a file: ${file}`);
    visited.add(canonicalFile);
    const document = typescript.createSourceFile(
      canonicalFile,
      source(canonicalFile),
      typescript.ScriptTarget.Latest,
      true,
      typescript.ScriptKind.JS,
    );

    const follow = (specifier) => {
      assertion(!specifier.startsWith('node:') && !builtinSpecifiers.has(specifier),
        `${relative(canonicalPackageRoot, canonicalFile)} imports Node builtin ${specifier}`);
      assertion(specifier !== 'ws' && !specifier.startsWith('ws/'),
        `${relative(canonicalPackageRoot, canonicalFile)} imports forbidden browser dependency ${specifier}`);
      if (!specifier.startsWith('.')) return;
      const target = resolve(dirname(canonicalFile), specifier);
      assertion(existsSync(target),
        `${relative(canonicalPackageRoot, canonicalFile)} has unresolved relative import ${specifier}`);
      visitFile(target);
    };

    const visitNode = (node) => {
      if ((typescript.isImportDeclaration(node) || typescript.isExportDeclaration(node))
        && node.moduleSpecifier !== undefined) {
        assertion(typescript.isStringLiteral(node.moduleSpecifier),
          `${relative(canonicalPackageRoot, canonicalFile)} has a non-literal module specifier`);
        follow(node.moduleSpecifier.text);
      } else if (typescript.isCallExpression(node) && typescript.isImportCall(node)) {
        const [argument] = node.arguments;
        assertion(argument !== undefined && typescript.isStringLiteral(argument),
          `${relative(canonicalPackageRoot, canonicalFile)} has a non-literal dynamic import`);
        follow(argument.text);
      }
      typescript.forEachChild(node, visitNode);
    };
    visitNode(document);
  };

  visitFile(canonicalEntry);
  const files = [...visited]
    .map((file) => relative(canonicalPackageRoot, file).split(sep).join('/'))
    .sort();
  if (requireProductionModules) {
    for (const required of browserClosureRequiredModules) {
      assertion(files.includes(required), `browser closure did not reach ${required}`);
    }
    assertion(files.some((file) => file.startsWith('dist/adapters/maplibre/')),
      'browser closure did not reach a MapLibre adapter module');
  }
  return files;
};

if (process.argv[2] === '--check-browser-closure') {
  const arguments_ = process.argv.slice(3);
  let entryArgument;
  let json = false;
  for (const argument of arguments_) {
    if (argument === '--json' && !json) json = true;
    else if (entryArgument === undefined && !argument.startsWith('--')) entryArgument = argument;
    else throw new TypeError(`invalid browser closure argument: ${argument}`);
  }
  const productionEntry = resolve(root, 'dist/bridge/index.js');
  const entry = entryArgument === undefined ? productionEntry : resolve(root, entryArgument);
  const production = entry === productionEntry;
  const packageRoot = production ? root : dirname(entry);
  if (!production) {
    assertion(isInside(resolve(root, '.tmp'), entry),
      'explicit browser closure fixtures must live under repository .tmp');
  }
  const files = assertBrowserClosure({
    entry,
    packageRoot,
    requireProductionModules: production,
  });
  if (json) process.stdout.write(`${JSON.stringify({ files })}\n`);
  process.exit(0);
}

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

const packageJson = JSON.parse(source(join(root, 'package.json')));

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
  'ai/index',
  'ai/tools',
  'capabilities/authority',
  'capabilities/boundary',
  'capabilities/contracts',
  'capabilities/index',
  'capabilities/inspect',
  'capabilities/map-authority',
  'capabilities/mutate',
  'capabilities/openai-tools',
  'capabilities/registry',
  'capabilities/runtime',
  'capabilities/schemas',
  'capabilities/shared',
  'bridge/browser-runtime',
  'bridge/capabilities',
  'bridge/client',
  'bridge/codec',
  'bridge/index',
  'bridge/outbound',
  'bridge/protocol',
  'bridge/registry',
  'bridge/resource-policy',
  'bridge/server',
  'cli/args',
  'cli/file-authority',
  'cli/file-output',
  'cli/input',
  'cli/main',
  'cli/output',
  'cli/run',
  'cli/types',
  'core/canonical-json',
  'core/context',
  'core/diff',
  'core/errors',
  'core/geojson-analysis',
  'core/geojson',
  'core/index',
  'core/json-pointer',
  'core/operations/definitions',
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
  'index',
  'mcp/bridge-authority',
  'mcp/bridge-options',
  'mcp/core-adapters',
  'mcp/create-server',
  'mcp/http',
  'mcp/live-extension',
  'mcp/live-resources',
  'mcp/main',
  'mcp/message-boundary',
  'mcp/output',
  'mcp/resources',
  'mcp/server-extension',
  'mcp/session-authority',
  'mcp/session-store',
  'mcp/stdio',
  'mcp/tool-handlers',
  'mcp/types',
  'mcp/version.generated',
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
import {
  BRIDGE_PROTOCOL_VERSION,
  canonicalizeJson,
  connectMapLibreBridge,
  sha256CanonicalJson,
} from 'maplibre-style-tools/bridge';
import type {
  BridgeCommand,
  ConnectMapLibreBridgeOptions,
  MapLibreBridgeConnection,
  MapLibreBridgeStatus,
  ResourcePolicy,
} from 'maplibre-style-tools/bridge';
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
const bridgeOptions: ConnectMapLibreBridgeOptions = {
  mapId: 'consumer-map',
  url: 'ws://127.0.0.1:7788',
  token: 't'.repeat(32),
  capabilities: ['style.read'],
  allowedResourceOrigins: ['https://maps.example'],
};
const bridgeStatus: MapLibreBridgeStatus = 'connected';
const bridgeCommand: BridgeCommand = { type: 'getStyle' };
const resourcePolicy: ResourcePolicy = {
  baseUrl: 'https://maps.example/style.json',
  allowedResourceOrigins: ['https://maps.example'],
};
declare const bridgeConnection: MapLibreBridgeConnection;
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
  bridgeOptions,
  bridgeStatus,
  bridgeCommand,
  resourcePolicy,
  bridgeConnection,
  BRIDGE_PROTOCOL_VERSION,
  canonicalizeJson,
  connectMapLibreBridge,
  sha256CanonicalJson,
  applyTransactionToMap,
  runtimeGeoJsonSourceDiffSchema,
  sanitizeRuntimeGeoJsonSourceDiff,
];
`;

const rootConsumer = `import { createMapLibreStyleTools } from 'maplibre-style-tools/ai';
import type {
  AiStyleToolResult,
  CreateMapLibreStyleToolsOptions,
  InspectStyleInput,
  MapLibreStyleTools,
} from 'maplibre-style-tools/ai';
// @ts-expect-error root AI factory was removed.
import { createMapLibreStyleTools as rootFactory } from 'maplibre-style-tools';
// @ts-expect-error root legacy AI options were removed.
import type { CreateMapLibreStyleToolsOptions as RootOptions } from 'maplibre-style-tools';
// @ts-expect-error root legacy style accessor was removed.
import type { StyleAccessor } from 'maplibre-style-tools';
// @ts-expect-error root legacy operation type was removed.
import type { StyleOperation } from 'maplibre-style-tools';
// @ts-expect-error root legacy operation result was removed.
import type { StyleOperationResult } from 'maplibre-style-tools';
// @ts-expect-error root legacy result wrapper was removed.
import type { ToolCallResult } from 'maplibre-style-tools';
// @ts-expect-error compact AI factory was removed.
import { createCompactMapLibreStyleTools } from 'maplibre-style-tools/ai';
// @ts-expect-error legacy AI names were removed.
import { FULL_LEGACY_TOOL_NAMES } from 'maplibre-style-tools/ai';
// @ts-expect-error legacy parser export was removed.
import type { parseStrictJson } from 'maplibre-style-tools/ai';
// @ts-expect-error legacy result converter was removed.
import type { toAiToolResult } from 'maplibre-style-tools/ai';

declare const options: CreateMapLibreStyleToolsOptions;
declare const tools: MapLibreStyleTools;
declare const result: AiStyleToolResult<unknown>;
declare const inspect: InspectStyleInput;
void [
  createMapLibreStyleTools, rootFactory, createCompactMapLibreStyleTools,
  FULL_LEGACY_TOOL_NAMES, options, tools, result, inspect,
];
`;

const mcpConsumer = `import {
  MAX_MCP_MESSAGE_BYTES,
  MAX_STYLE_SESSION_ID_BYTES,
  MCP_CAPABILITY_TOOL_NAMES,
  BridgeMapAuthority,
  SessionStyleAuthority,
  buildLiveMapMetadataUri,
  buildLiveMapStyleUri,
  createLiveMapMcpExtension,
  createMapLibreStyleMcpServer,
  createMcpToolHandlers,
  createStyleSessionStore,
  openStyleSessionInputSchema,
  resolveMcpMessagePolicy,
  runStdioMcp,
  startStreamableHttpMcp,
} from 'maplibre-style-tools/mcp';
import type {
  CreateMapLibreStyleMcpServerOptions,
  McpMessagePolicy,
  McpServerExtension,
  McpServerExtensionContext,
  ResourceUriAdmission,
  RunStdioMcpOptions,
  StartStreamableHttpMcpOptions,
  StyleSessionStore,
} from 'maplibre-style-tools/mcp';

declare global {
  type HeadersInit =
    | readonly (readonly [string, string])[]
    | Readonly<Record<string, string | readonly string[]>>
    | Headers;
}

const policy: McpMessagePolicy = resolveMcpMessagePolicy();
const admission: ResourceUriAdmission = {
  scheme: 'example',
  authority: 'styles',
  assertCanonical(rawUri: string): void { void rawUri; },
};
const extension: McpServerExtension = (
  server,
  context: McpServerExtensionContext,
) => {
  context.registerResourceUriAdmission(admission);
  context.responseBoundary.requireToolSuccess({ ready: true });
  void server;
  return undefined;
};
const store = createStyleSessionStore();
const options: CreateMapLibreStyleMcpServerOptions = { store, extensions: [extension] };
const stdio: RunStdioMcpOptions = { startupDiagnosticLine: null };
const http: StartStreamableHttpMcpOptions = { bearerToken: 'secret' };
const created = createMapLibreStyleMcpServer(options);
const sessionOpen = openStyleSessionInputSchema.parse({
  style: { version: 8, sources: {}, layers: [] },
});
const capabilityNames: readonly string[] = MCP_CAPABILITY_TOOL_NAMES;
void [SessionStyleAuthority, BridgeMapAuthority, createMcpToolHandlers];
if (buildLiveMapMetadataUri('consumer-map') !== 'maplibre-style://maps/~consumer-map') {
  throw new Error('unexpected live map metadata URI');
}
if (buildLiveMapStyleUri('consumer-map') !== 'maplibre-style://maps/~consumer-map/style') {
  throw new Error('unexpected live map Style URI');
}
declare const transport: Parameters<typeof created.connect>[0];
if (false) void created.connect(transport);
void created.server.server;

const plainStore = {
  size: 0,
  limits: store.limits,
  open: store.open,
  close: store.close,
  read: store.read,
  readRevision: store.readRevision,
  apply: store.apply,
  export: store.export,
  dispose: store.dispose,
};
// @ts-expect-error only a factory-created branded store can be injected.
const forgedStore: StyleSessionStore = plainStore;
// @ts-expect-error MCP extensions must be synchronous.
const asyncExtension: McpServerExtension = async () => undefined;
void [
  policy,
  stdio,
  http,
  forgedStore,
  asyncExtension,
  sessionOpen,
  capabilityNames,
  createLiveMapMcpExtension,
  MAX_MCP_MESSAGE_BYTES,
  MAX_STYLE_SESSION_ID_BYTES,
  runStdioMcp,
  startStreamableHttpMcp,
];
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

const mcpConfig = `{
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
  "include": ["mcp-consumer.ts"]
}
`;

const runtimeSmoke = `import assert from 'node:assert/strict';
import {
  finalizeStyleReplacement,
  inlineGeoJsonSchema,
} from 'maplibre-style-tools/core';
import {
  applyTransactionToMap,
  runtimeGeoJsonSourceDiffSchema,
  sanitizeRuntimeGeoJsonSourceDiff,
} from 'maplibre-style-tools/maplibre';
import { createMapLibreStyleTools } from 'maplibre-style-tools/ai';
import {
  buildLiveMapMetadataUri,
  buildLiveMapStyleUri,
  createMapLibreStyleMcpServer,
  createLiveMapMcpExtension,
  createMcpToolHandlers,
  MCP_CAPABILITY_TOOL_NAMES,
  resolveMcpMessagePolicy,
} from 'maplibre-style-tools/mcp';
import {
  BRIDGE_PROTOCOL_VERSION,
  canonicalizeJson,
  connectMapLibreBridge,
  sha256CanonicalJson,
} from 'maplibre-style-tools/bridge';

assert.equal(typeof createMapLibreStyleTools, 'function');
assert.equal(typeof finalizeStyleReplacement, 'function');
assert.equal(typeof inlineGeoJsonSchema.safeParse, 'function');
assert.equal(typeof applyTransactionToMap, 'function');
assert.equal(typeof runtimeGeoJsonSourceDiffSchema.safeParse, 'function');
assert.equal(typeof sanitizeRuntimeGeoJsonSourceDiff, 'function');
assert.equal(typeof createMapLibreStyleMcpServer, 'function');
assert.equal(typeof createLiveMapMcpExtension, 'function');
assert.equal(typeof createMcpToolHandlers, 'function');
assert.ok(MCP_CAPABILITY_TOOL_NAMES.includes('inspectStyle'));
assert.equal(resolveMcpMessagePolicy().maxMessageBytes, 5 * 1024 * 1024);
assert.equal(buildLiveMapMetadataUri('a.b'), 'maplibre-style://maps/~a.b');
assert.equal(buildLiveMapStyleUri('a.b'), 'maplibre-style://maps/~a.b/style');
assert.equal(typeof connectMapLibreBridge, 'function');
assert.equal(BRIDGE_PROTOCOL_VERSION, 2);
assert.equal(typeof canonicalizeJson, 'function');
assert.equal(typeof sha256CanonicalJson, 'function');
const finalized = finalizeStyleReplacement(
  { version: 8, sources: {}, layers: [] },
  { version: 8, sources: {}, layers: [], metadata: { owner: 'maps' } },
);
assert.equal(finalized.ok, true);
assert.deepEqual(finalized.diff.map(({ op, path }) => ({ op, path })), [{ op: 'add', path: '/metadata' }]);
`;

const packDirectory = mkdtempSync(join(tmpdir(), 'maplibre-style-tools-package-'));
const consumer = mkdtempSync(join(tmpdir(), 'maplibre-style-tools-consumer-'));
try {
  const workspace = await import('maplibre-style-tools');
  assertion(!('createMapLibreStyleTools' in workspace), 'root AI factory must be absent');
  assertion(!('createCompactMapLibreStyleTools' in workspace), 'root compact AI factory must be absent');

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
  assertion(typeof ai.createMapLibreStyleTools === 'function', 'AI unified factory is missing');
  assertion(!('createCompactMapLibreStyleTools' in ai), 'AI compact factory must be absent');

  const mcp = await import('maplibre-style-tools/mcp');
  assertion(typeof mcp.createMapLibreStyleMcpServer === 'function',
    'MCP server factory is missing');
  assertion(typeof mcp.createLiveMapMcpExtension === 'function',
    'MCP live extension is missing');

  const bridge = await import('maplibre-style-tools/bridge');
  assertion(typeof bridge.connectMapLibreBridge === 'function',
    'browser bridge client is missing');
  assertion(bridge.BRIDGE_PROTOCOL_VERSION === 2,
    'browser bridge protocol version is incorrect');
  assertion(typeof bridge.canonicalizeJson === 'function',
    'browser canonical JSON export is missing');
  assertion(typeof bridge.sha256CanonicalJson === 'function',
    'browser Style hash export is missing');
  assertion(!('createBridgeServer' in bridge) && !('LiveMapRegistry' in bridge),
    'browser bridge entry exposes Node server state');
  assertBrowserClosure({
    entry: join(root, 'dist/bridge/index.js'),
    packageRoot: root,
    requireProductionModules: true,
  });

  const packOutput = command('npm', [
    'pack', '--json', '--pack-destination', packDirectory,
  ]);
  const packJsonStart = packOutput.lastIndexOf('\n[');
  const packed = JSON.parse(packOutput.slice(packJsonStart < 0 ? 0 : packJsonStart + 1));
  assertion(Array.isArray(packed) && packed.length === 1,
    'npm pack must return exactly one result');
  const [packedResult] = packed;
  assertion(Array.isArray(packedResult.files),
    'npm pack did not return a usable JSON file list');
  const tarballPath = join(packDirectory, packedResult.filename);
  assertion(existsSync(tarballPath), 'npm pack did not create its reported tarball');
  assert.deepEqual(packageJson.bin, {
    'maplibre-style': './dist/cli/main.js',
    'maplibre-style-mcp': './dist/mcp/main.js',
  });
  const packedFiles = packedResult.files.map((file) => file.path).sort();
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
    'dist/ai/index.js',
    'dist/ai/index.d.ts',
    'dist/capabilities/index.js',
    'dist/capabilities/index.d.ts',
    'dist/cli/main.js',
    'dist/cli/main.d.ts',
    'dist/mcp/main.js',
    'dist/mcp/main.d.ts',
    'dist/mcp/http.js',
    'dist/mcp/stdio.js',
    'dist/bridge/index.js',
    'dist/bridge/index.d.ts',
  ]) assertion(packedFiles.includes(required), `packed tarball is missing ${required}`);
  for (const file of packedFiles) {
    assertion(
      !file.startsWith('src/')
        && !file.startsWith('.tmp/')
        && file !== 'evals'
        && !file.startsWith('evals/')
        && !file.startsWith('examples/')
        && !file.startsWith('test-results/')
        && !file.startsWith('playwright-report/'),
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
    readdirSync(packDirectory).filter((file) => file.endsWith('.tgz')),
    [packedResult.filename],
    'package check must create exactly one real tarball',
  );
  const unpacked = join(packDirectory, 'unpacked');
  command('tar', ['-xzf', tarballPath, '-C', packDirectory]);
  command('mv', [join(packDirectory, 'package'), unpacked]);
  const rootDeclaration = source(join(unpacked, 'dist/index.d.ts'));
  assertion(rootDeclaration.startsWith('/// <reference types="node" preserve="true" />\n/// <reference types="geojson" preserve="true" />'),
    'root declaration references must preserve node then geojson');
  const aiDeclaration = source(join(unpacked, 'dist/ai/index.d.ts'));
  assertion(aiDeclaration.startsWith('/// <reference types="node" preserve="true" />\n'),
    'AI declaration must preserve its own root-level node reference');
  assertion(source(join(unpacked, 'dist/core/types.d.ts')).startsWith('/// <reference types="geojson" preserve="true" />'),
    'core type declaration must preserve geojson');
  assertion(/^\/\/\/ <reference types="node" preserve="true" \/>/m.test(
    source(join(unpacked, 'dist/mcp/main.d.ts')),
  ), 'MCP declaration must preserve its explicit Node type reference');
  const nodeReferenceFiles = packedFiles
    .filter((file) => file.endsWith('.d.ts'))
    .filter((file) => /\/\/\/\s*<reference\s+types=["']node["']/.test(
      source(join(unpacked, file)),
    ));
  assert.deepEqual(nodeReferenceFiles, [
    'dist/ai/index.d.ts',
    'dist/index.d.ts',
    'dist/mcp/http.d.ts',
    'dist/mcp/main.d.ts',
  ], 'only root, AI, and MCP transport declarations may reference Node ambient types');
  assertCoreDeclarationsAreTransportNeutral(packedFiles, unpacked);
  assertMapLibreDeclarationsAreNodeFree(packedFiles, unpacked);

  writeFileSync(join(consumer, 'package.json'), '{\n  "private": true,\n  "type": "module"\n}\n');
  command('npm', [
    'install', '--no-save', '--ignore-scripts', '--no-package-lock', '--no-audit', '--no-fund',
    tarballPath,
  ], consumer);
  writeFileSync(join(consumer, 'core-consumer.ts'), coreConsumer);
  writeFileSync(join(consumer, 'maplibre-consumer.ts'), maplibreConsumer);
  writeFileSync(join(consumer, 'root-consumer.ts'), rootConsumer);
  writeFileSync(join(consumer, 'mcp-consumer.ts'), mcpConsumer);
  writeFileSync(join(consumer, 'tsconfig.core-consumer.json'), coreConfig);
  writeFileSync(join(consumer, 'tsconfig.maplibre-consumer.json'), maplibreConfig);
  writeFileSync(join(consumer, 'tsconfig.root-consumer.json'), rootConfig);
  writeFileSync(join(consumer, 'tsconfig.mcp-consumer.json'), mcpConfig);
  const installedPackageRoot = join(consumer, 'node_modules/maplibre-style-tools');
  const installedManifest = JSON.parse(source(join(installedPackageRoot, 'package.json')));
  assertBrowserClosure({
    entry: join(installedPackageRoot, 'dist/bridge/index.js'),
    packageRoot: installedPackageRoot,
    requireProductionModules: true,
  });
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
      types: './dist/ai/index.d.ts',
      import: './dist/ai/index.js',
      default: './dist/ai/index.js',
    },
    './capabilities': {
      types: './dist/capabilities/index.d.ts',
      import: './dist/capabilities/index.js',
      default: './dist/capabilities/index.js',
    },
    './mcp': {
      types: './dist/mcp/main.d.ts',
      import: './dist/mcp/main.js',
      default: './dist/mcp/main.js',
    },
    './bridge': {
      types: './dist/bridge/index.d.ts',
      import: './dist/bridge/index.js',
      default: './dist/bridge/index.js',
    },
  });
  assert.deepEqual(installedManifest.bin, {
    'maplibre-style': './dist/cli/main.js',
    'maplibre-style-mcp': './dist/mcp/main.js',
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
  const installedBinary = join(consumer, 'node_modules/.bin/maplibre-style');
  const runInstalledBinary = (arguments_) => {
    const result = spawnSync(installedBinary, arguments_, {
      cwd: consumer,
      encoding: 'utf8',
    });
    if (result.error || result.status !== 0 || result.stderr !== '') {
      throw new Error([
        `Installed CLI failed: ${arguments_.join(' ')}`,
        result.error?.message,
        result.stdout,
        result.stderr,
      ].filter(Boolean).join('\n'));
    }
    return result.stdout;
  };
  const help = JSON.parse(runInstalledBinary(['--help']));
  assert.equal(help.ok, true);
  assertion(help.usage.includes('maplibre-style validate STYLE'),
    'installed CLI help is missing validate usage');
  const fixture = join(consumer, 'style.json');
  writeFileSync(fixture, '{"version":8,"sources":{},"layers":[]}');
  const validation = JSON.parse(runInstalledBinary(['validate', 'style.json']));
  assert.equal(validation.success, true);
  const installedMcpBinary = join(
    consumer, 'node_modules/.bin/maplibre-style-mcp',
  );
  const mcpHelp = spawnSync(installedMcpBinary, ['--help'], {
    cwd: consumer,
    encoding: 'utf8',
  });
  if (mcpHelp.error || mcpHelp.status !== 0 || mcpHelp.stdout !== '') {
    throw new Error([
      'Installed MCP binary failed: --help',
      mcpHelp.error?.message,
      mcpHelp.stdout,
      mcpHelp.stderr,
    ].filter(Boolean).join('\n'));
  }
  assert.match(mcpHelp.stderr, /Usage: maplibre-style-mcp/);
  const installedMcpVersion = command(process.execPath, [
    '--input-type=module',
    '--eval',
    "import('maplibre-style-tools/mcp').then(m => process.stdout.write(m.MCP_SERVER_VERSION))",
  ], consumer);
  assert.equal(installedMcpVersion, installedManifest.version);
  const parsedCoreConfig = JSON.parse(coreConfig);
  const parsedMapLibreConfig = JSON.parse(maplibreConfig);
  const parsedRootConfig = JSON.parse(rootConfig);
  const parsedMcpConfig = JSON.parse(mcpConfig);
  for (const [name, config] of [
    ['core', parsedCoreConfig],
    ['maplibre', parsedMapLibreConfig],
    ['root', parsedRootConfig],
    ['mcp', parsedMcpConfig],
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
  assert.equal(parsedMcpConfig.compilerOptions.module, 'NodeNext');
  assert.equal(parsedMcpConfig.compilerOptions.moduleResolution, 'NodeNext');
  assert.deepEqual(parsedMcpConfig.compilerOptions.lib, ['ES2023']);
  for (const consumerSource of [coreConsumer, maplibreConsumer, rootConsumer, mcpConsumer]) {
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
  assertion(!mcpConsumer.includes('maplibre-style-tools/ai')
      && !mcpConsumer.includes('maplibre-style-tools/maplibre')
      && !mcpConsumer.includes("from 'maplibre-style-tools';"),
  'MCP consumer must not import root, AI, or MapLibre entry points');
  command(process.execPath, [tsc, '-p', 'tsconfig.core-consumer.json', '--noEmit'], consumer);
  command(process.execPath, [tsc, '-p', 'tsconfig.maplibre-consumer.json', '--noEmit'], consumer);
  command(process.execPath, [tsc, '-p', 'tsconfig.root-consumer.json', '--noEmit'], consumer);
  const mcpListFiles = command(process.execPath, [
    tsc,
    '-p', 'tsconfig.mcp-consumer.json',
    '--noEmit',
    '--listFiles',
  ], consumer);
  const forbiddenMcpDeclaration = /node_modules\/maplibre-style-tools\/dist\/(?:index\.(?:d\.ts|js)|ai\/|capabilities\/map-authority|adapters\/maplibre\/(?:map-adapter|runtime-commands|feature-query)\.)[^\n]*/m
    .exec(mcpListFiles)?.[0];
  assertion(forbiddenMcpDeclaration === undefined,
    `MCP declaration graph leaked ${forbiddenMcpDeclaration ?? 'a forbidden entry point'}`);
  assertion(!/lib\.dom\.d\.ts/.test(mcpListFiles),
    'MCP declaration graph leaked DOM ambient types');
  writeFileSync(join(consumer, 'runtime-smoke.mjs'), runtimeSmoke);
  command(process.execPath, ['runtime-smoke.mjs'], consumer);
} finally {
  rmSync(packDirectory, { recursive: true, force: true });
  rmSync(consumer, { recursive: true, force: true });
}
