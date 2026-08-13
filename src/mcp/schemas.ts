import { z } from 'zod';

import {
  jsonValueSchema,
  styleDocumentSchema,
} from '../core/schemas.js';
import type {
  GeoJsonAnalysisResult,
  JsonObject,
  LayerSearchQuery,
  LayerSearchResult,
  SourceLayerUsage,
  StyleContext,
  StyleDocument,
  StyleLayer,
  StyleSource,
} from '../core/types.js';
import type { StyleValidationResult } from '../core/validation.js';
import { parseMcpToolEnvelope, styleToolErrorWireSchema } from './output.js';
import type {
  ApplySessionTransactionResult,
  CloseStyleSessionResult,
  ExportStyleSessionResult,
  OpenStyleSessionResult,
  StyleInspectResult,
} from './types.js';
import { MAX_STYLE_SESSION_ID_BYTES } from './types.js';

const MAX_DOCUMENT_IDENTIFIER_BYTES = 1024;
const MAX_SEARCH_TEXT_BYTES = 1024;
const MAX_VALIDATION_ISSUES = 100;
const MAX_LAYER_SEARCH_RESULTS = 120;

const hasScalarUnicode = (value: string): boolean => {
  try {
    return encodeURIComponent(value).length >= 0;
  } catch {
    return false;
  }
};

const boundedString = (maxBytes: number, description: string) => z.string()
  .min(1)
  .refine((value) => hasScalarUnicode(value) && Buffer.byteLength(value, 'utf8') <= maxBytes, {
    message: `Must be a non-empty Unicode scalar string of at most ${maxBytes} UTF-8 bytes.`,
  })
  .describe(description);

const sessionIdSchema = boundedString(
  MAX_STYLE_SESSION_ID_BYTES,
  `Style session ID (1-${MAX_STYLE_SESSION_ID_BYTES} UTF-8 bytes), for example "session-1".`,
);
const layerIdSchema = boundedString(
  MAX_DOCUMENT_IDENTIFIER_BYTES,
  `MapLibre layer ID (1-${MAX_DOCUMENT_IDENTIFIER_BYTES} UTF-8 bytes), for example "roads".`,
);
const sourceIdSchema = boundedString(
  MAX_DOCUMENT_IDENTIFIER_BYTES,
  `MapLibre source ID (1-${MAX_DOCUMENT_IDENTIFIER_BYTES} UTF-8 bytes), for example "streets".`,
);
const revisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
  .describe('Exact non-negative safe-integer session revision, for example 0.');

const validationDisplayOptionsSchema = z.strictObject({
  maxIssues: z.number().int().min(1).max(MAX_VALIDATION_ISSUES)
    .describe(`Maximum validation issues to report (1-${MAX_VALIDATION_ISSUES}).`),
}).describe('Bounded validation display options.');

const optionalSearchText = (description: string) => z.string().refine(
  (value) => Buffer.byteLength(value, 'utf8') <= MAX_SEARCH_TEXT_BYTES,
  { message: `Must be at most ${MAX_SEARCH_TEXT_BYTES} UTF-8 bytes.` },
).describe(description).optional();

const layerSearchQuerySchema: z.ZodType<LayerSearchQuery> = z.strictObject({
  query: optionalSearchText('Case-insensitive text matched across layer summary fields.'),
  type: optionalSearchText('Exact MapLibre layer type, for example "line".'),
  source: optionalSearchText('Exact source ID, for example "streets".'),
  sourceLayer: optionalSearchText('Case-insensitive source-layer text.'),
  limit: z.number().int().min(1).max(MAX_LAYER_SEARCH_RESULTS)
    .describe(`Maximum returned layer summaries (1-${MAX_LAYER_SEARCH_RESULTS}).`)
    .optional(),
});

export const styleSessionOpenInputSchema = z.strictObject({
  style: jsonValueSchema.describe('Inline MapLibre Style JSON to validate and store.'),
}).describe('Open one bounded in-memory Style session from inline JSON.');

export const styleSessionCloseInputSchema = z.strictObject({
  sessionId: sessionIdSchema,
}).describe('Close one active Style session.');

export const styleValidateInputSchema = z.strictObject({
  target: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('inline').describe('Validate inline Style JSON.'),
      style: jsonValueSchema.describe('Inline MapLibre Style JSON.'),
    }),
    z.strictObject({
      kind: z.literal('session').describe('Validate an atomic session snapshot.'),
      sessionId: sessionIdSchema,
    }),
  ]).describe('Choose exactly one inline or session validation target.'),
  options: validationDisplayOptionsSchema.optional(),
}).describe('Validate inline Style JSON or one open session snapshot.');

export const styleInspectInputSchema = z.strictObject({
  sessionId: sessionIdSchema,
  selection: z.discriminatedUnion('view', [
    z.strictObject({
      view: z.literal('context').describe('Return the bounded Style context summary.'),
    }),
    z.strictObject({
      view: z.literal('layer').describe('Return one exact layer definition.'),
      layerId: layerIdSchema,
    }),
    z.strictObject({
      view: z.literal('source').describe('Return one exact source definition.'),
      sourceId: sourceIdSchema,
    }),
    z.strictObject({
      view: z.literal('sourceLayers').describe('List source-layer usages.'),
      sourceId: sourceIdSchema.optional(),
    }),
  ]).describe('Choose exactly one context, layer, source, or sourceLayers view.'),
}).describe('Inspect one atomic session snapshot.');

export const styleSearchLayersInputSchema = z.strictObject({
  sessionId: sessionIdSchema,
  query: layerSearchQuerySchema.optional().default({})
    .describe('Bounded layer-summary search filters.'),
}).describe('Search layer summaries in one atomic session snapshot.');

export const styleAnalyzeGeoJsonInputSchema = z.strictObject({
  target: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('inline').describe('Analyze inline GeoJSON or a remote URL string.'),
      data: jsonValueSchema.describe('Inline GeoJSON value or URL string.'),
    }),
    z.strictObject({
      kind: z.literal('sessionSource').describe('Analyze one GeoJSON session source.'),
      sessionId: sessionIdSchema,
      sourceId: sourceIdSchema,
    }),
  ]).describe('Choose exactly one inline or sessionSource analysis target.'),
}).describe('Analyze inline GeoJSON or one session GeoJSON source without fetching URLs.');

export const styleApplyTransactionInputSchema = z.strictObject({
  sessionId: sessionIdSchema,
  expectedRevision: revisionSchema,
  transaction: z.unknown().describe(
    'Opaque MapLibre StyleTransaction {operations:[...]}; core validates its shape and limits.',
  ),
  dryRun: z.boolean().describe('Preview without committing a revision when true.').optional(),
}).describe('Apply or preview one core-validated Style transaction atomically.');

export const styleExportInputSchema = z.strictObject({
  sessionId: sessionIdSchema,
  revision: revisionSchema.optional()
    .describe('Exact retained revision; omit for the current revision.'),
}).describe('Export a current or exact retained Style revision.');

export const DOCUMENT_TOOL_NAMES = Object.freeze([
  'style_session_open',
  'style_session_close',
  'style_validate',
  'style_inspect',
  'style_search_layers',
  'style_analyze_geojson',
  'style_apply_transaction',
  'style_export',
] as const);

export type DocumentToolName = (typeof DOCUMENT_TOOL_NAMES)[number];

export const documentToolInputSchemas = Object.freeze({
  style_session_open: styleSessionOpenInputSchema,
  style_session_close: styleSessionCloseInputSchema,
  style_validate: styleValidateInputSchema,
  style_inspect: styleInspectInputSchema,
  style_search_layers: styleSearchLayersInputSchema,
  style_analyze_geojson: styleAnalyzeGeoJsonInputSchema,
  style_apply_transaction: styleApplyTransactionInputSchema,
  style_export: styleExportInputSchema,
});

const jsonObjectSchema = jsonValueSchema.refine(
  (value): value is JsonObject => typeof value === 'object'
    && value !== null && !Array.isArray(value),
);
const styleResponseSchema = styleDocumentSchema as unknown as z.ZodType<StyleDocument>;
const warningSchema = z.strictObject({
  code: z.string(),
  message: z.string(),
  path: z.string().optional(),
});
const layerSummarySchema = z.strictObject({
  id: z.string(), type: z.string(), source: z.string().optional(),
  sourceLayer: z.string().optional(), minzoom: z.number().optional(),
  maxzoom: z.number().optional(), visibility: jsonValueSchema.optional(),
});
const styleContextSchema: z.ZodType<StyleContext> = z.strictObject({
  activeSourceId: z.string().nullable().optional(),
  selectedLayerId: z.string().nullable().optional(),
  layerCount: z.number().int().nonnegative(),
  sourceCount: z.number().int().nonnegative(),
  layerTypes: z.record(z.string(), z.number().int().nonnegative()),
  layers: z.array(layerSummarySchema),
});
const styleLayerSchema = jsonObjectSchema.refine(
  (value): value is StyleLayer => typeof value.id === 'string' && typeof value.type === 'string',
);
const styleSourceSchema = jsonObjectSchema.refine(
  (value): value is StyleSource => typeof value.type === 'string',
);
const sourceLayerUsageSchema: z.ZodType<SourceLayerUsage> = z.strictObject({
  sourceId: z.string(),
  sourceLayer: z.string(),
  layers: z.array(z.strictObject({ id: z.string(), type: z.string() })),
});

export const styleSessionOpenDataSchema: z.ZodType<OpenStyleSessionResult> = z.strictObject({
  sessionId: z.string(), revision: revisionSchema, expiresAt: z.number().finite(),
});
export const styleSessionCloseDataSchema: z.ZodType<CloseStyleSessionResult> = z.strictObject({
  sessionId: z.string(), closed: z.literal(true),
});
export const styleValidateDataSchema: z.ZodType<StyleValidationResult> =
  z.discriminatedUnion('ok', [
    z.strictObject({
      ok: z.literal(true), style: styleResponseSchema,
      errors: z.tuple([]), warnings: z.array(warningSchema),
    }),
    z.strictObject({
      ok: z.literal(false), errors: z.array(styleToolErrorWireSchema),
      warnings: z.array(warningSchema),
    }),
  ]);
export const styleInspectDataSchema: z.ZodType<StyleInspectResult> = z.discriminatedUnion('view', [
  z.strictObject({
    view: z.literal('context'), sessionId: z.string(), revision: revisionSchema,
    context: styleContextSchema,
  }),
  z.strictObject({
    view: z.literal('layer'), sessionId: z.string(), revision: revisionSchema,
    layer: styleLayerSchema,
  }),
  z.strictObject({
    view: z.literal('source'), sessionId: z.string(), revision: revisionSchema,
    source: styleSourceSchema,
  }),
  z.strictObject({
    view: z.literal('sourceLayers'), sessionId: z.string(), revision: revisionSchema,
    sourceLayers: z.array(sourceLayerUsageSchema),
  }),
]);
export const styleSearchLayersDataSchema: z.ZodType<LayerSearchResult> = z.strictObject({
  layers: z.array(layerSummarySchema), total: z.number().int().nonnegative(),
});

const geometryTypesSchema = z.strictObject({
  Point: z.number().int().nonnegative().optional(),
  MultiPoint: z.number().int().nonnegative().optional(),
  LineString: z.number().int().nonnegative().optional(),
  MultiLineString: z.number().int().nonnegative().optional(),
  Polygon: z.number().int().nonnegative().optional(),
  MultiPolygon: z.number().int().nonnegative().optional(),
  GeometryCollection: z.number().int().nonnegative().optional(),
});
const propertyAnalysisSchema = z.strictObject({
  name: z.string(),
  types: z.array(z.enum(['string', 'number', 'boolean', 'null', 'array', 'object'])),
  numericRange: z.strictObject({ min: z.number(), max: z.number() }).optional(),
  topValues: z.array(z.strictObject({
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
    count: z.number().int().nonnegative(),
  })).optional(),
});
export const styleAnalyzeGeoJsonDataSchema: z.ZodType<GeoJsonAnalysisResult> =
  z.discriminatedUnion('ok', [
    z.strictObject({
      ok: z.literal(true),
      analysis: z.discriminatedUnion('available', [
        z.strictObject({
          available: z.literal(false), reason: z.literal('remote-url'),
          warnings: z.array(warningSchema),
        }),
        z.strictObject({
          available: z.literal(true), featureCount: z.number().int().nonnegative(),
          geometryTypes: geometryTypesSchema,
          bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
          properties: z.array(propertyAnalysisSchema), warnings: z.array(warningSchema),
        }),
      ]),
    }),
    z.strictObject({ ok: z.literal(false), error: styleToolErrorWireSchema }),
  ]);

const diffTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('style') }),
  z.strictObject({ kind: z.literal('layer'), id: z.string() }),
  z.strictObject({ kind: z.literal('source'), id: z.string() }),
]);
const diffEntrySchema = z.strictObject({
  op: z.enum(['add', 'remove', 'replace', 'move']),
  path: z.string(), from: z.string().optional(),
  before: jsonValueSchema.optional(), after: jsonValueSchema.optional(),
  target: diffTargetSchema,
});
export const styleApplyTransactionDataSchema: z.ZodType<ApplySessionTransactionResult> =
  z.strictObject({
    revision: revisionSchema, dryRun: z.boolean(), diff: z.array(diffEntrySchema),
    changedLayers: z.array(z.string()), changedSources: z.array(z.string()),
    warnings: z.array(warningSchema),
  });
export const styleExportDataSchema: z.ZodType<ExportStyleSessionResult> = z.strictObject({
  sessionId: z.string(), revision: revisionSchema, style: styleResponseSchema,
});

export const documentToolResponseDataSchemas = Object.freeze({
  style_session_open: styleSessionOpenDataSchema,
  style_session_close: styleSessionCloseDataSchema,
  style_validate: styleValidateDataSchema,
  style_inspect: styleInspectDataSchema,
  style_search_layers: styleSearchLayersDataSchema,
  style_analyze_geojson: styleAnalyzeGeoJsonDataSchema,
  style_apply_transaction: styleApplyTransactionDataSchema,
  style_export: styleExportDataSchema,
});

export const parseDocumentToolSuccessData = <Name extends DocumentToolName>(
  name: Name,
  value: unknown,
): z.output<(typeof documentToolResponseDataSchemas)[Name]> => {
  const envelope = parseMcpToolEnvelope(value);
  if (!envelope.ok) throw new TypeError('MCP document tool result is a failure envelope.');
  return documentToolResponseDataSchemas[name].parse(envelope.data) as z.output<
    (typeof documentToolResponseDataSchemas)[Name]
  >;
};
