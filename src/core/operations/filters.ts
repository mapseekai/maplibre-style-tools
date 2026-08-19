import { jsonValuesEqual } from '../diff.js';
import { createStyleToolError } from '../errors.js';
import type {
  JsonObject,
  JsonValue,
  OperationApplyResult,
  OperationContext,
  SetGeoJsonSourceFilterOperation,
  SetLayerFilterOperation,
  StyleDocument,
} from '../types.js';

export type FilterSyntax = 'expression' | 'legacy' | 'neutral';

export const LEGACY_FILTER_MESSAGE =
  'Legacy property filter syntax is not supported; use expression syntax (for example ["==", ["get", "kind"], "road"]).';
export const LEGACY_COMPOSE_MESSAGE =
  'Cannot compose with an existing legacy-syntax filter; apply mode \'replace\' with an expression filter first.';

function classifyChildren(children: JsonValue[]): FilterSyntax {
  let sawLegacy = false;
  let sawExpression = false;
  for (const child of children) {
    const classification = classifyFilter(child);
    if (classification === 'legacy') sawLegacy = true;
    if (classification === 'expression') sawExpression = true;
  }
  if (sawLegacy) return 'legacy';
  return sawExpression ? 'expression' : 'neutral';
}

export function classifyFilter(filter: JsonValue): FilterSyntax {
  if (typeof filter === 'boolean') return 'neutral';
  if (!Array.isArray(filter) || filter.length === 0) return 'legacy';

  switch (filter[0]) {
    case 'has':
      if (filter.length < 2 || filter[1] === '$id' || filter[1] === '$type') {
        return 'legacy';
      }
      return filter.length === 2 ? 'neutral' : 'expression';
    case 'in':
      return filter.length >= 3
        && (typeof filter[1] !== 'string' || Array.isArray(filter[2]))
        ? 'expression'
        : 'legacy';
    case '!in':
    case '!has':
    case 'none':
      return 'legacy';
    case '==':
    case '!=':
    case '>':
    case '>=':
    case '<':
    case '<=':
      return filter.length !== 3 || Array.isArray(filter[1]) || Array.isArray(filter[2])
        ? 'expression'
        : 'legacy';
    case 'any':
    case 'all':
      return classifyChildren(filter.slice(1));
    default:
      return 'expression';
  }
}

function filterParts(filter: JsonValue[], operator: 'all' | 'any'): JsonValue[] {
  return filter[0] === operator ? filter.slice(1) : [filter];
}

export function composeFilter(
  existing: JsonValue[] | undefined,
  incoming: JsonValue[],
  mode: 'replace' | 'and' | 'or',
): JsonValue[] {
  if (mode === 'replace' || existing === undefined) return incoming;
  if (classifyFilter(incoming) === 'legacy') throw new TypeError(LEGACY_FILTER_MESSAGE);
  if (classifyFilter(existing) === 'legacy') throw new TypeError(LEGACY_COMPOSE_MESSAGE);
  const operator = mode === 'and' ? 'all' : 'any';
  return [
    operator,
    ...filterParts(existing, operator),
    ...filterParts(incoming, operator),
  ];
}

function applyFilter(
  target: JsonObject,
  operation: SetLayerFilterOperation | SetGeoJsonSourceFilterOperation,
): OperationApplyResult {
  const hadFilter = Object.hasOwn(target, 'filter');
  const before = target.filter;
  if (operation.mode === 'clear') {
    delete target.filter;
  } else {
    if (classifyFilter(operation.filter) === 'legacy') {
      return {
        ok: false,
        error: createStyleToolError('INVALID_INPUT', LEGACY_FILTER_MESSAGE, '/filter'),
      };
    }
    const existing = Array.isArray(before) ? before : undefined;
    if (
      operation.op === 'setLayerFilter'
      && operation.mode !== 'replace'
      && before !== undefined
      && existing === undefined
    ) {
      return {
        ok: false,
        error: createStyleToolError(
          'INVALID_INPUT', 'Existing filter must be an array to be composed.', '/filter',
        ),
      };
    }
    try {
      target.filter = operation.op === 'setLayerFilter'
        ? composeFilter(existing, operation.filter, operation.mode)
        : operation.filter;
    } catch (error) {
      return {
        ok: false,
        error: createStyleToolError(
          'INVALID_INPUT',
          error instanceof Error ? error.message : LEGACY_FILTER_MESSAGE,
          '/filter',
        ),
      };
    }
  }

  const hasFilter = Object.hasOwn(target, 'filter');
  const after = target.filter;
  const changed = hadFilter !== hasFilter || (
    before !== undefined
    && after !== undefined
    && !jsonValuesEqual(before, after)
  );
  return { ok: true, changed };
}

export function applySetLayerFilter(
  style: StyleDocument,
  operation: SetLayerFilterOperation,
  context: OperationContext,
): OperationApplyResult {
  const layer = style.layers.find((candidate) => candidate.id === operation.layerId);
  if (layer === undefined) {
    return {
      ok: false,
      error: createStyleToolError(
        'NOT_FOUND',
        `Layer "${operation.layerId}" was not found.`,
        '/layerId',
        { layerId: operation.layerId },
      ),
    };
  }

  const result = applyFilter(layer, operation);
  if (result.ok && result.changed) context.changedLayerIds.add(operation.layerId);
  return result;
}

export function applySetGeoJsonSourceFilter(
  style: StyleDocument,
  operation: SetGeoJsonSourceFilterOperation,
  context: OperationContext,
): OperationApplyResult {
  if (!Object.hasOwn(style.sources, operation.sourceId)) {
    return {
      ok: false,
      error: createStyleToolError(
        'NOT_FOUND',
        `Source "${operation.sourceId}" was not found.`,
        '/sourceId',
        { sourceId: operation.sourceId },
      ),
    };
  }

  const source = style.sources[operation.sourceId]!;
  if (source.type !== 'geojson') {
    return {
      ok: false,
      error: createStyleToolError(
        'UNSUPPORTED_SOURCE',
        `Source "${operation.sourceId}" is not a GeoJSON source.`,
        '/sourceId',
        {
          sourceId: operation.sourceId,
          sourceType: typeof source.type === 'string' ? source.type : 'unknown',
        },
      ),
    };
  }

  const result = applyFilter(source, operation);
  if (result.ok && result.changed) context.changedSourceIds.add(operation.sourceId);
  return result;
}
