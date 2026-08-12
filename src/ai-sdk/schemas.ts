import { z } from 'zod';
import {
  DEFAULT_MAX_OPERATIONS,
  geoJsonAnalysisInputSchema,
  geoJsonAnalysisOptionsSchema,
  jsonValueSchema,
  styleTransactionSchema,
} from '../core/index.js';
import {
  MAX_AI_TEXT_BYTES,
  normalizeLegacyOperations,
  parseJsonOrRawString,
  parseStrictJson,
} from './compatibility.js';
import {
  renderedFeatureQueryInputSchema,
  sourceFeatureQueryInputSchema,
} from '../adapters/maplibre/index.js';

function boundedTextSchema(
  label: string,
  parser: (raw: string, parserLabel: string) => { ok: boolean },
): z.ZodType<string> {
  return z.string().superRefine((value, context) => {
    if (value.length > MAX_AI_TEXT_BYTES || !parser(value, label).ok) {
      context.addIssue({ code: 'custom', message: `${label} is invalid.` });
    }
  });
}

export const strictJsonTextSchema = boundedTextSchema('JSON value', parseStrictJson);
export const jsonOrRawStringTextSchema = boundedTextSchema('Value', parseJsonOrRawString);

function legacyOperationsAreValid(raw: string): { ok: boolean } {
  const normalized = normalizeLegacyOperations(raw);
  if (normalized.ok) return normalized;
  const parsed = parseStrictJson(raw, 'operationsJson');
  if (!parsed.ok || !Array.isArray(parsed.value)
    || parsed.value.length > DEFAULT_MAX_OPERATIONS) return normalized;
  for (const operation of parsed.value) {
    if (!normalizeLegacyOperations(JSON.stringify([operation])).ok) return normalized;
  }
  return { ok: true };
}

export const legacyOperationsTextSchema = boundedTextSchema(
  'operationsJson', legacyOperationsAreValid,
);
export const filterTextSchema = boundedTextSchema('filterJson', parseStrictJson);
export const styleJsonOrUrlTextSchema = boundedTextSchema(
  'styleJsonOrUrl', parseJsonOrRawString,
);

const nonEmptyStringSchema = z.string().refine(
  (value) => value.trim().length > 0,
  { message: 'Expected a non-empty string' },
);
const jsonObjectSchema = z.record(z.string(), jsonValueSchema);
const filterSchema = z.array(jsonValueSchema);
const placementShape = {
  beforeId: nonEmptyStringSchema.optional(),
  afterId: nonEmptyStringSchema.optional(),
};
const executionShape = {
  dryRun: z.boolean().default(false),
  diff: z.boolean().default(true),
};

function descriptorSafeInputSchema<Schema extends z.ZodType>(
  schema: Schema,
): z.ZodType<z.output<Schema>> {
  return jsonValueSchema.pipe(schema as never) as z.ZodType<z.output<Schema>>;
}

const validatePlacement = (
  input: { beforeId?: string; afterId?: string },
  context: z.RefinementCtx,
): void => {
  if (input.beforeId !== undefined && input.afterId !== undefined) {
    context.addIssue({
      code: 'custom',
      message: 'Placement cannot specify both beforeId and afterId',
      path: ['afterId'],
    });
  }
};

const validateZooms = (
  input: { minzoom?: number; maxzoom?: number },
  context: z.RefinementCtx,
): void => {
  if (input.minzoom !== undefined && input.maxzoom !== undefined
    && input.minzoom > input.maxzoom) {
    context.addIssue({
      code: 'custom',
      message: 'minzoom must be less than or equal to maxzoom',
      path: ['maxzoom'],
    });
  }
};

export const compactGetStyleContextInputSchema = descriptorSafeInputSchema(z.object({
  layerLimit: z.number().min(1).max(300).default(120),
}).strict());

export const compactSearchLayersInputSchema = descriptorSafeInputSchema(z.object({
  query: z.string().optional(),
  type: z.string().optional(),
  source: z.string().optional(),
  sourceLayer: z.string().optional(),
  limit: z.number().min(1).max(300).default(80),
}).strict());

export const compactInspectLayersCompactInputSchema = descriptorSafeInputSchema(z.object({
  layerIdsJson: z.string().describe('JSON array of layer ids.'),
  fields: z.array(z.enum(['paint', 'layout', 'filter', 'zoom']))
    .default(['paint', 'layout']),
}).strict());

export const compactApplyStyleOperationsInputSchema = descriptorSafeInputSchema(z.object({
  operationsJson: legacyOperationsTextSchema,
  ...executionShape,
}).strict());

export const compactValidateStylePatchJsonInputSchema = descriptorSafeInputSchema(z.object({
  patchJson: z.string(),
}).strict());

export const compactAnalyzeGeoJsonInputSchema = descriptorSafeInputSchema(z.object({
  data: geoJsonAnalysisInputSchema,
  options: geoJsonAnalysisOptionsSchema.optional(),
}).strict());

export const compactListSourceLayersInputSchema = descriptorSafeInputSchema(z.object({
  sourceId: nonEmptyStringSchema.optional(),
}).strict());

export const compactDuplicateLayerInputSchema = descriptorSafeInputSchema(z.object({
  layerId: nonEmptyStringSchema,
  newLayerId: nonEmptyStringSchema,
  overrides: jsonObjectSchema.optional(),
  ...placementShape,
  ...executionShape,
}).strict().superRefine((input, context) => {
  validatePlacement(input, context);
  if (input.overrides !== undefined && Object.hasOwn(input.overrides, 'id')) {
    context.addIssue({
      code: 'custom', message: 'Layer overrides cannot include id',
      path: ['overrides', 'id'],
    });
  }
}));

export const compactAddLayerFromSourceInputSchema = descriptorSafeInputSchema(z.object({
  layerId: nonEmptyStringSchema,
  sourceId: nonEmptyStringSchema,
  sourceLayer: nonEmptyStringSchema.optional(),
  type: nonEmptyStringSchema,
  paint: jsonObjectSchema.optional(),
  layout: jsonObjectSchema.optional(),
  filter: filterSchema.optional(),
  minzoom: z.number().finite().min(0).max(24).optional(),
  maxzoom: z.number().finite().min(0).max(24).optional(),
  metadata: jsonObjectSchema.optional(),
  ...placementShape,
  ...executionShape,
}).strict().superRefine((input, context) => {
  validatePlacement(input, context);
  validateZooms(input, context);
}));

export const compactAddGeoJsonLayerInputSchema = descriptorSafeInputSchema(z.object({
  sourceId: nonEmptyStringSchema,
  layerId: nonEmptyStringSchema,
  data: geoJsonAnalysisInputSchema,
  sourceOptions: jsonObjectSchema.optional(),
  type: z.enum(['fill', 'line', 'symbol', 'circle', 'heatmap', 'fill-extrusion']),
  paint: jsonObjectSchema.optional(),
  layout: jsonObjectSchema.optional(),
  filter: filterSchema.optional(),
  minzoom: z.number().finite().min(0).max(24).optional(),
  maxzoom: z.number().finite().min(0).max(24).optional(),
  metadata: jsonObjectSchema.optional(),
  ...placementShape,
  ...executionShape,
}).strict().superRefine((input, context) => {
  validatePlacement(input, context);
  validateZooms(input, context);
  for (const key of ['type', 'data'] as const) {
    if (input.sourceOptions !== undefined && Object.hasOwn(input.sourceOptions, key)) {
      context.addIssue({
        code: 'custom',
        message: `sourceOptions cannot include the authority key ${key}`,
        path: ['sourceOptions', key],
      });
    }
  }
}));

export const compactApplyStyleTransactionInputSchema = descriptorSafeInputSchema(z.object({
  transaction: styleTransactionSchema,
  dryRun: z.boolean().default(false),
  diff: z.boolean().default(true),
}).strict());

const fullSchema = <Shape extends z.ZodRawShape>(shape: Shape) =>
  descriptorSafeInputSchema(z.object(shape).strict());
const legacyDiff = z.boolean().default(true);
const legacyLimit = z.number().min(1).max(300).default(120);
const layerId = z.string();
const sourceId = z.string();
const property = z.string();
const emptyShape = {};

export const fullListAllLayersInputSchema = fullSchema({ limit: legacyLimit });
export const fullListAllSourcesInputSchema = fullSchema({ limit: legacyLimit });
export const fullInspectLayerStyleInputSchema = fullSchema({
  layerId: z.string().describe('Layer id from listAllLayers output'),
});
export const fullInspectSourceInputSchema = fullSchema({
  sourceId: z.string().describe('Source id from listAllSources output'),
});
export const fullSetLayerPaintPropertyInputSchema = fullSchema({
  layerId,
  property: z.string().describe('For example fill-color, line-width, text-color'),
  valueJson: jsonOrRawStringTextSchema.describe(
    'JSON literal or string. Example: "#ff0000", 1.2, ["interpolate", ...]',
  ),
});
export const fullSetLayerLayoutPropertyInputSchema = fullSchema({
  layerId,
  property: z.string().describe('For example visibility, text-size, line-cap'),
  valueJson: jsonOrRawStringTextSchema.describe(
    'JSON literal or string. Example: "visible", 14',
  ),
});
export const fullSetLayerPaintPropertySmartInputSchema = fullSchema({
  layerId, property, valueJson: jsonOrRawStringTextSchema,
});
export const fullSetLayerLayoutPropertySmartInputSchema = fullSchema({
  layerId, property, valueJson: jsonOrRawStringTextSchema,
});
export const fullBatchSetLayerPaintPropertiesSmartInputSchema = fullSchema({
  layerId, propertiesJson: strictJsonTextSchema,
});
export const fullBatchSetLayerLayoutPropertiesSmartInputSchema = fullSchema({
  layerId, propertiesJson: strictJsonTextSchema,
});
export const fullBatchSetLayerPaintPropertiesInputSchema = fullSchema({
  layerId,
  propertiesJson: strictJsonTextSchema.describe(
    'JSON object, e.g. {"fill-color":"#fff","fill-opacity":0.6}',
  ),
});
export const fullBatchSetLayerLayoutPropertiesInputSchema = fullSchema({
  layerId,
  propertiesJson: strictJsonTextSchema.describe(
    'JSON object, e.g. {"text-size":14,"text-font":["Noto Sans Regular"]}',
  ),
});
export const fullClearLayerPaintPropertyInputSchema = fullSchema({ layerId, property });
export const fullClearLayerLayoutPropertyInputSchema = fullSchema({ layerId, property });
export const fullSetLayerFilterInputSchema = fullSchema({
  layerId,
  filterJson: filterTextSchema.describe(
    'JSON filter expression or null. Example: ["==", ["get", "class"], "primary"]',
  ),
});
export const fullSetLayerZoomRangeInputSchema = fullSchema({
  layerId, minzoom: z.number().min(0).max(24), maxzoom: z.number().min(0).max(24),
});
export const fullSetLayerVisibilityInputSchema = fullSchema({
  layerId, visibility: z.enum(['visible', 'none']),
});
export const fullAddLayerInputSchema = fullSchema({
  layerJson: strictJsonTextSchema.describe('Full JSON layer object'),
  beforeId: z.string().optional(),
});
export const fullMoveLayerInputSchema = fullSchema({
  layerId, beforeId: z.string().optional(),
});
export const fullRemoveLayerInputSchema = fullSchema({ layerId });
export const fullPatchLayerDefinitionInputSchema = fullSchema({
  layerId, patchJson: strictJsonTextSchema.describe('JSON object patch'), diff: legacyDiff,
});
export const fullReplaceLayerDefinitionInputSchema = fullSchema({
  layerId,
  layerJson: strictJsonTextSchema.describe('Full JSON layer object'),
  diff: legacyDiff,
});
export const fullAddSourceInputSchema = fullSchema({
  sourceId, sourceJson: strictJsonTextSchema.describe('Full JSON source object'),
});
export const fullRemoveSourceInputSchema = fullSchema({ sourceId });
export const fullUpdateGeoJsonSourceDataInputSchema = fullSchema({
  sourceId, dataJson: jsonOrRawStringTextSchema,
  method: z.enum(['setData', 'updateData']).default('setData'),
});
export const fullSetGeoJsonClusterOptionsInputSchema = fullSchema({
  sourceId,
  optionsJson: strictJsonTextSchema.describe('JSON object for GeoJSON cluster options'),
});
export const fullSetSourceTileLodParamsInputSchema = fullSchema({
  maxZoomLevelsOnScreen: z.number().positive(),
  tileCountMaxMinRatio: z.number().positive(), sourceId: z.string().optional(),
});
export const fullPatchSourceDefinitionInputSchema = fullSchema({
  sourceId, patchJson: strictJsonTextSchema.describe('JSON object patch'), diff: legacyDiff,
});
export const fullReplaceSourceDefinitionInputSchema = fullSchema({
  sourceId,
  sourceJson: strictJsonTextSchema.describe('Full JSON source object'),
  diff: legacyDiff,
});
export const fullSetStyleJsonOrUrlInputSchema = fullSchema({
  styleJsonOrUrl: styleJsonOrUrlTextSchema.describe(
    'Either style URL, or full style JSON object string',
  ),
  diff: legacyDiff,
});
export const fullInspectRootStyleInputSchema = fullSchema(emptyShape);
export const fullSetStyleNameInputSchema = fullSchema({ name: z.string(), diff: legacyDiff });
export const fullSetStyleMetadataInputSchema = fullSchema({
  metadataJson: strictJsonTextSchema.describe('JSON object or null'), diff: legacyDiff,
});
export const fullSetStyleTransitionInputSchema = fullSchema({
  transitionJson: strictJsonTextSchema.describe('JSON object or null'), diff: legacyDiff,
});
export const fullSetStyleCameraDefaultsInputSchema = fullSchema({
  centerJson: strictJsonTextSchema.describe('JSON array [lng, lat]').optional(),
  zoom: z.number().optional(),
  bearing: z.number().optional(), pitch: z.number().optional(),
  roll: z.number().optional(), centerAltitude: z.number().optional(),
  diff: legacyDiff,
});
export const fullValidateStyleJsonInputSchema = fullSchema({
  styleJson: strictJsonTextSchema.describe('Full style JSON object string'),
});
export const fullValidateCurrentMapStyleInputSchema = fullSchema(emptyShape);
export const fullSetMapLightInputSchema = fullSchema({
  lightJson: strictJsonTextSchema.describe('JSON object for light spec'),
});
export const fullSetMapSkyInputSchema = fullSchema({
  skyJson: strictJsonTextSchema.describe('JSON object for sky spec, or null'),
});
export const fullSetMapProjectionInputSchema = fullSchema({
  projectionJson: strictJsonTextSchema.describe('JSON projection object'),
});
export const fullSetMapTerrainInputSchema = fullSchema({
  terrainJson: strictJsonTextSchema.describe('JSON object for terrain spec, or null'),
});
export const fullSetMapGlyphsInputSchema = fullSchema({
  glyphsUrlJson: strictJsonTextSchema.describe('JSON string URL or null'),
});
export const fullSetMapSpriteInputSchema = fullSchema({
  spriteUrlJson: strictJsonTextSchema.describe('JSON string URL or null'),
});
export const fullListSpritesInputSchema = fullSchema(emptyShape);
export const fullAddSpriteInputSchema = fullSchema({
  spriteId: z.string(), url: z.string().url(), overwrite: z.boolean().default(false),
});
export const fullRemoveSpriteInputSchema = fullSchema({ spriteId: z.string() });
export const fullSetFeatureStateInputSchema = fullSchema({
  targetJson: strictJsonTextSchema.describe('Feature identifier JSON object'),
  stateJson: strictJsonTextSchema.describe('State JSON object to merge'),
});
export const fullRemoveFeatureStateInputSchema = fullSchema({
  targetJson: strictJsonTextSchema.describe('Feature identifier JSON object'),
  key: z.string().optional(),
});
export const fullSetGlobalStatePropertyInputSchema = fullSchema({
  propertyName: z.string(),
  valueJson: strictJsonTextSchema.describe('JSON value for global state'),
});
export const fullListImagesInputSchema = fullSchema({
  limit: z.number().min(1).max(500).default(300),
});
export const fullAddImageFromUrlInputSchema = fullSchema({
  imageId: z.string(), url: z.string().url(), overwrite: z.boolean().default(false),
});
export const fullRemoveImageInputSchema = fullSchema({ imageId: z.string() });
export const fullGetLayerCountInputSchema = fullSchema(emptyShape);
export const fullQuerySourceFeaturesInputSchema = sourceFeatureQueryInputSchema;
export const fullQueryRenderedFeaturesInputSchema = renderedFeatureQueryInputSchema;
