import { z } from 'zod';

import { buildStyleContext } from '../core/context.js';
import { createStyleToolError, isStyleToolError } from '../core/errors.js';
import { analyzeGeoJson } from '../core/geojson-analysis.js';
import { listSourceLayers, searchLayers } from '../core/search.js';
import type {
  GeoJsonAnalysisResult,
  LayerSearchResult,
  StyleDocument,
  StyleLayer,
  StyleSource,
} from '../core/types.js';
import { validateStyleDocument } from '../core/validation.js';
import type { McpResponseBoundary } from './message-boundary.js';
import {
  styleAnalyzeGeoJsonInputSchema,
  styleApplyTransactionInputSchema,
  styleExportInputSchema,
  styleInspectInputSchema,
  styleSearchLayersInputSchema,
  styleSessionCloseInputSchema,
  styleSessionOpenInputSchema,
  styleValidateInputSchema,
} from './schemas.js';
import {
  applyStyleSessionTransactionResult,
  projectStyleSession,
  projectStyleSessionRevision,
  type StyleSessionStore,
} from './session-store.js';
import type {
  ApplySessionTransactionResult,
  CloseStyleSessionResult,
  ExportStyleSessionResult,
  McpTextToolResult,
  OpenStyleSessionResult,
  StyleInspectResult,
} from './types.js';
import type { StyleValidationResult } from '../core/validation.js';

const toJsonPointer = (path: readonly PropertyKey[]): string => path.length === 0
  ? ''
  : `/${path.map((value) => String(value)
    .replaceAll('~', '~0')
    .replaceAll('/', '~1')).join('/')}`;

const invalidInputFromZod = (error: z.ZodError): ReturnType<typeof createStyleToolError> => {
  const issue = error.issues[0];
  return createStyleToolError(
    'INVALID_INPUT',
    issue?.message ?? 'Tool input is invalid.',
    issue === undefined ? '' : toJsonPointer(issue.path),
  );
};

const internalToolFailure = () => createStyleToolError(
  'INTERNAL', 'The tool failed internally.',
);

export const guardDocumentTool = <Schema extends z.ZodType, Result>(
  schema: Schema,
  responseBoundary: McpResponseBoundary,
  run: (
    input: z.output<Schema>,
  ) => McpTextToolResult<Result> | Promise<McpTextToolResult<Result>>,
): ((input: unknown) => Promise<McpTextToolResult<Result>>) => async (input) => {
  let parsed: z.output<Schema>;
  try {
    parsed = schema.parse(input);
  } catch (error: unknown) {
    return responseBoundary.requireToolFailure(
      error instanceof z.ZodError ? invalidInputFromZod(error) : internalToolFailure(),
    );
  }
  try {
    return await run(parsed);
  } catch (error: unknown) {
    return responseBoundary.requireToolFailure(
      isStyleToolError(error) ? error : internalToolFailure(),
    );
  }
};

const missingLayer = (layerId: string) => createStyleToolError(
  'NOT_FOUND',
  'Style layer was not found.',
  `/layers/${layerId.replaceAll('~', '~0').replaceAll('/', '~1')}`,
  { reason: 'layerNotFound', layerId },
);

const missingSource = (sourceId: string) => createStyleToolError(
  'NOT_FOUND',
  'Style source was not found.',
  `/sources/${sourceId.replaceAll('~', '~0').replaceAll('/', '~1')}`,
  { reason: 'sourceNotFound', sourceId },
);

const requireLayer = (style: StyleDocument, layerId: string): StyleLayer => {
  const layer = style.layers.find((candidate) => candidate.id === layerId);
  if (layer === undefined) throw missingLayer(layerId);
  return layer;
};

const requireSource = (style: StyleDocument, sourceId: string): StyleSource => {
  const descriptor = Object.getOwnPropertyDescriptor(style.sources, sourceId);
  if (descriptor === undefined || !('value' in descriptor)) throw missingSource(sourceId);
  return descriptor.value;
};

const analyzeSessionSource = (
  style: StyleDocument,
  sourceId: string,
): GeoJsonAnalysisResult => {
  const source = requireSource(style, sourceId);
  if (source.type !== 'geojson') {
    throw createStyleToolError(
      'INVALID_INPUT',
      'The selected source is not a GeoJSON source.',
      `/sources/${sourceId.replaceAll('~', '~0').replaceAll('/', '~1')}`,
      { reason: 'sourceNotGeoJson', sourceId },
    );
  }
  return analyzeGeoJson(source.data);
};

export interface DocumentToolHandlers {
  readonly style_session_open: (
    input: unknown,
  ) => Promise<McpTextToolResult<OpenStyleSessionResult>>;
  readonly style_session_close: (
    input: unknown,
  ) => Promise<McpTextToolResult<CloseStyleSessionResult>>;
  readonly style_validate: (
    input: unknown,
  ) => Promise<McpTextToolResult<StyleValidationResult>>;
  readonly style_inspect: (
    input: unknown,
  ) => Promise<McpTextToolResult<StyleInspectResult>>;
  readonly style_search_layers: (
    input: unknown,
  ) => Promise<McpTextToolResult<LayerSearchResult>>;
  readonly style_analyze_geojson: (
    input: unknown,
  ) => Promise<McpTextToolResult<GeoJsonAnalysisResult>>;
  readonly style_apply_transaction: (
    input: unknown,
  ) => Promise<McpTextToolResult<ApplySessionTransactionResult>>;
  readonly style_export: (
    input: unknown,
  ) => Promise<McpTextToolResult<ExportStyleSessionResult>>;
}

export const createDocumentToolHandlers = (
  store: StyleSessionStore,
  responseBoundary: McpResponseBoundary,
): DocumentToolHandlers => ({
  style_session_open: guardDocumentTool(
    styleSessionOpenInputSchema,
    responseBoundary,
    async ({ style }) => responseBoundary.requireToolSuccess(await store.open(style)),
  ),
  style_session_close: guardDocumentTool(
    styleSessionCloseInputSchema,
    responseBoundary,
    async ({ sessionId }) => responseBoundary.requireToolSuccess(await store.close(sessionId)),
  ),
  style_validate: guardDocumentTool(
    styleValidateInputSchema,
    responseBoundary,
    (input) => input.target.kind === 'inline'
      ? responseBoundary.requireToolSuccess(
        validateStyleDocument(input.target.style, input.options),
      )
      : projectStyleSession(store, input.target.sessionId, (snapshot) =>
        snapshot.style.withStyle((style) => responseBoundary.requireToolSuccess(
          validateStyleDocument(style, {
            ...input.options,
            maxStyleBytes: store.limits.maxStyleBytes,
          }),
        ))),
  ),
  style_inspect: guardDocumentTool(
    styleInspectInputSchema,
    responseBoundary,
    (input) => projectStyleSession(store, input.sessionId, (snapshot) =>
      snapshot.style.withStyle((style) => {
        let data: StyleInspectResult;
        switch (input.selection.view) {
          case 'context':
            data = {
              view: 'context', sessionId: input.sessionId,
              revision: snapshot.revision, context: buildStyleContext(style),
            };
            break;
          case 'layer':
            data = {
              view: 'layer', sessionId: input.sessionId,
              revision: snapshot.revision,
              layer: requireLayer(style, input.selection.layerId),
            };
            break;
          case 'source':
            data = {
              view: 'source', sessionId: input.sessionId,
              revision: snapshot.revision,
              source: requireSource(style, input.selection.sourceId),
            };
            break;
          case 'sourceLayers':
            if (input.selection.sourceId !== undefined) {
              requireSource(style, input.selection.sourceId);
            }
            data = {
              view: 'sourceLayers', sessionId: input.sessionId,
              revision: snapshot.revision,
              sourceLayers: listSourceLayers(style, {
                ...(input.selection.sourceId === undefined
                  ? {} : { sourceId: input.selection.sourceId }),
              }),
            };
            break;
        }
        return responseBoundary.requireToolSuccess(data);
      })),
  ),
  style_search_layers: guardDocumentTool(
    styleSearchLayersInputSchema,
    responseBoundary,
    (input) => projectStyleSession(store, input.sessionId, (snapshot) =>
      snapshot.style.withStyle((style) => responseBoundary.requireToolSuccess(
        searchLayers(style, input.query),
      ))),
  ),
  style_analyze_geojson: guardDocumentTool(
    styleAnalyzeGeoJsonInputSchema,
    responseBoundary,
    (input) => {
      if (input.target.kind === 'inline') {
        return responseBoundary.requireToolSuccess(analyzeGeoJson(input.target.data));
      }
      const { sessionId, sourceId } = input.target;
      return projectStyleSession(store, sessionId, (snapshot) =>
        snapshot.style.withStyle((style) => responseBoundary.requireToolSuccess(
          analyzeSessionSource(style, sourceId),
        )));
    },
  ),
  style_apply_transaction: guardDocumentTool(
    styleApplyTransactionInputSchema,
    responseBoundary,
    (input) => applyStyleSessionTransactionResult(
      store,
      input.sessionId,
      {
        expectedRevision: input.expectedRevision,
        transaction: input.transaction,
        ...(input.dryRun === undefined ? {} : { dryRun: input.dryRun }),
      },
      (result) => responseBoundary.requireToolSuccess(result),
    ),
  ),
  style_export: guardDocumentTool(
    styleExportInputSchema,
    responseBoundary,
    (input) => projectStyleSessionRevision(
      store,
      input.sessionId,
      input.revision,
      (snapshot) => snapshot.style.withStyle((style) => responseBoundary.requireToolSuccess({
        sessionId: input.sessionId,
        revision: snapshot.revision,
        style,
      })),
    ),
  ),
});
