import { tool } from 'ai';
import type { z } from 'zod';
import { createStyleToolError } from '../core/index.js';
import type { GeoJsonFeature, JsonValue, StyleDiffEntry, StyleToolError, StyleWarning } from '../core/index.js';
import type {
  AiStyleToolResult,
  FeatureQueryProjection,
  InspectionProjection,
  MapCommandReceipt,
  StyleMutationReceipt,
} from './contracts.js';
import { jsonUtf8ByteLength, truncateUtf8 } from './shared.js';

export { jsonUtf8ByteLength } from './shared.js';

export const MAX_AI_OUTPUT_BYTES = 1_048_576;
export const MAX_AI_OUTPUT_ITEMS = 100;
export const MAX_AI_OUTPUT_WARNINGS = 20;
export const MAX_AI_MESSAGE_BYTES = 4_096;
export const COMPACT_OUTPUT_TRUNCATED: StyleWarning = Object.freeze({
  code: 'COMPACT_OUTPUT_TRUNCATED',
  message: 'Output was truncated to stay within response limits.',
});

const normalizedMessage = (message: string): string => truncateUtf8(message, MAX_AI_MESSAGE_BYTES);
const pointer = (path: PropertyKey[]): string | undefined => path.length === 0
  ? undefined
  : `/${path.map((part) => String(part).replace(/~/g, '~0').replace(/\//g, '~1')).join('/')}`;

type MutableData = { warnings: StyleWarning[]; truncated: boolean };

const finalizeSuccess = <T extends MutableData>(message: string, data: T, limit: number, omitted: boolean): AiStyleToolResult<T> => {
  const output = { success: true as const, message: normalizedMessage(message), data };
  data.truncated = omitted;
  if (!omitted) data.warnings.pop();
  if (jsonUtf8ByteLength(output) > limit) throw new RangeError('AI result mandatory envelope exceeds output limit.');
  return output;
};

const admitWarnings = <T extends MutableData>(
  output: { success: true; message: string; data: T },
  warnings: readonly StyleWarning[],
  limit: number,
): boolean => {
  let omitted = warnings.length > MAX_AI_OUTPUT_WARNINGS;
  for (const warning of warnings.slice(0, MAX_AI_OUTPUT_WARNINGS)) {
    output.data.warnings.splice(output.data.warnings.length - 1, 0, warning);
    if (jsonUtf8ByteLength(output) > limit) {
      output.data.warnings.splice(output.data.warnings.length - 2, 1);
      omitted = true;
      break;
    }
  }
  return omitted;
};

const reserve = <T extends MutableData>(message: string, data: T, limit: number): { output: { success: true; message: string; data: T }; valid: boolean } => {
  const output = { success: true as const, message: normalizedMessage(message), data };
  data.truncated = true;
  data.warnings.push(COMPACT_OUTPUT_TRUNCATED);
  return { output, valid: jsonUtf8ByteLength(output) <= limit };
};

const admitNestedWarnings = <T extends { warnings: StyleWarning[] }>(
  output: { success: true; message: string; data: unknown },
  target: T,
  warnings: readonly StyleWarning[],
  limit: number,
): boolean => {
  let omitted = warnings.length > MAX_AI_OUTPUT_WARNINGS;
  for (const warning of warnings.slice(0, MAX_AI_OUTPUT_WARNINGS)) {
    target.warnings.splice(target.warnings.length - 1, 0, warning);
    if (jsonUtf8ByteLength(output) > limit) { target.warnings.splice(target.warnings.length - 2, 1); omitted = true; break; }
  }
  return omitted;
};

const boundedLimit = (value: number | undefined): number => Math.min(value ?? MAX_AI_OUTPUT_BYTES, MAX_AI_OUTPUT_BYTES);

export const boundInspectionProjection = (input: {
  message: string;
  action: InspectionProjection['action'];
  projection: { items: JsonValue[]; total?: number } | { value: JsonValue };
  warnings: readonly StyleWarning[];
}): AiStyleToolResult<InspectionProjection> => {
  if ('items' in input.projection) {
    const projection = { items: [] as JsonValue[], returned: 0, ...(input.projection.total === undefined ? {} : { total: input.projection.total }), truncated: false, warnings: [] as StyleWarning[] };
    const data: InspectionProjection = { action: input.action, projection };
    const output = { success: true as const, message: normalizedMessage(input.message), data };
    projection.truncated = true; projection.warnings.push(COMPACT_OUTPUT_TRUNCATED);
    if (jsonUtf8ByteLength(output) > MAX_AI_OUTPUT_BYTES) throw new RangeError('AI result mandatory envelope exceeds output limit.');
    let omitted = admitNestedWarnings(output, projection, input.warnings, MAX_AI_OUTPUT_BYTES);
    for (const item of input.projection.items.slice(0, MAX_AI_OUTPUT_ITEMS)) {
      projection.items.push(item); projection.returned = projection.items.length;
      if (jsonUtf8ByteLength(output) > MAX_AI_OUTPUT_BYTES) { projection.items.pop(); projection.returned = projection.items.length; omitted = true; break; }
    }
    omitted ||= projection.items.length < input.projection.items.length;
    projection.truncated = omitted;
    if (!omitted) projection.warnings.pop();
    if (jsonUtf8ByteLength(output) > MAX_AI_OUTPUT_BYTES) throw new RangeError('AI result mandatory envelope exceeds output limit.');
    return output;
  }
  const projection = { returned: 0 as 0 | 1, total: 1 as const, truncated: false, warnings: [] as StyleWarning[], value: undefined as JsonValue | undefined };
  const data: InspectionProjection = { action: input.action, projection };
  const output = { success: true as const, message: normalizedMessage(input.message), data };
  projection.truncated = true; projection.warnings.push(COMPACT_OUTPUT_TRUNCATED);
  if (jsonUtf8ByteLength(output) > MAX_AI_OUTPUT_BYTES) throw new RangeError('AI result mandatory envelope exceeds output limit.');
  let omitted = admitNestedWarnings(output, projection, input.warnings, MAX_AI_OUTPUT_BYTES);
  projection.value = input.projection.value; projection.returned = 1;
  if (jsonUtf8ByteLength(output) > MAX_AI_OUTPUT_BYTES) { delete projection.value; projection.returned = 0; omitted = true; }
  projection.truncated = omitted;
  if (!omitted) projection.warnings.pop();
  if (jsonUtf8ByteLength(output) > MAX_AI_OUTPUT_BYTES) throw new RangeError('AI result mandatory envelope exceeds output limit.');
  return output;
};

export const boundStyleMutationReceipt = (input: {
  message: string; applied: boolean; noOp: boolean; changedLayers: string[]; changedSources: string[];
  diff?: StyleDiffEntry[]; warnings: readonly StyleWarning[]; styleAuthority: StyleMutationReceipt['styleAuthority'];
}): AiStyleToolResult<StyleMutationReceipt> => {
  const data: StyleMutationReceipt = { applied: input.applied, noOp: input.noOp, changedLayers: [], changedSources: [], warnings: [], truncated: false, styleAuthority: input.styleAuthority };
  const { output, valid } = reserve(input.message, data, MAX_AI_OUTPUT_BYTES);
  if (!valid) throw new RangeError('AI result mandatory envelope exceeds output limit.');
  let omitted = admitWarnings(output, input.warnings, MAX_AI_OUTPUT_BYTES);
  const admit = <T>(source: readonly T[], target: T[]): void => {
    for (const item of source.slice(0, MAX_AI_OUTPUT_ITEMS - data.changedLayers.length - data.changedSources.length)) {
      target.push(item);
      if (jsonUtf8ByteLength(output) > MAX_AI_OUTPUT_BYTES) { target.pop(); omitted = true; break; }
    }
    omitted ||= target.length < source.length;
  };
  admit(input.changedLayers, data.changedLayers);
  admit(input.changedSources, data.changedSources);
  if (input.diff !== undefined) {
    data.diff = [];
    admit(input.diff, data.diff);
    if (data.diff.length === 0 && input.diff.length > 0) delete data.diff;
  }
  return finalizeSuccess(input.message, data, MAX_AI_OUTPUT_BYTES, omitted);
};

export const boundMapCommandReceipt = (input:
  | { message: string; action: MapCommandReceipt['action']; kind: 'list'; applied: boolean; result: { items: JsonValue[]; total?: number }; warnings: readonly StyleWarning[] }
  | { message: string; action: MapCommandReceipt['action']; kind: 'acknowledgement'; applied: boolean; result?: JsonValue; warnings: readonly StyleWarning[] }
): AiStyleToolResult<MapCommandReceipt> => {
  const data: MapCommandReceipt = { action: input.action, kind: input.kind, applied: input.applied, warnings: [], truncated: false };
  if (input.kind === 'list') data.result = { items: [], returned: 0, truncated: false, warnings: [] };
  const { output, valid } = reserve(input.message, data, MAX_AI_OUTPUT_BYTES);
  if (!valid) throw new RangeError('AI result mandatory envelope exceeds output limit.');
  let omitted = admitWarnings(output, input.warnings, MAX_AI_OUTPUT_BYTES);
  if (input.kind === 'list') {
    const result = data.result as Extract<MapCommandReceipt['result'], { items: JsonValue[] }>;
    if (input.result.total !== undefined) result.total = input.result.total;
    for (const item of input.result.items.slice(0, MAX_AI_OUTPUT_ITEMS)) {
      result.items.push(item); result.returned = result.items.length;
      if (jsonUtf8ByteLength(output) > MAX_AI_OUTPUT_BYTES) { result.items.pop(); result.returned = result.items.length; omitted = true; break; }
    }
    omitted ||= result.items.length < input.result.items.length;
    result.truncated = omitted;
    if (omitted) result.warnings.push(COMPACT_OUTPUT_TRUNCATED);
  } else if (input.result !== undefined) {
    data.result = input.result;
    if (jsonUtf8ByteLength(output) > MAX_AI_OUTPUT_BYTES) { delete data.result; omitted = true; }
  }
  return finalizeSuccess(input.message, data, MAX_AI_OUTPUT_BYTES, omitted);
};

export const boundFeatureQueryProjection = (input: {
  message: string; target: FeatureQueryProjection['target']; features: GeoJsonFeature[]; total?: number;
  warnings: readonly StyleWarning[]; maxSerializedBytes?: number;
}): AiStyleToolResult<FeatureQueryProjection> => {
  const limit = boundedLimit(input.maxSerializedBytes);
  const data: FeatureQueryProjection = { target: input.target, features: [], returned: 0, ...(input.total === undefined ? {} : { total: input.total }), warnings: [], truncated: false };
  const { output, valid } = reserve(input.message, data, limit);
  if (!valid) throw new RangeError('AI result mandatory envelope exceeds output limit.');
  let omitted = admitWarnings(output, input.warnings, limit);
  for (const feature of input.features.slice(0, MAX_AI_OUTPUT_ITEMS)) {
    data.features.push(feature); data.returned = data.features.length;
    if (jsonUtf8ByteLength(output) > limit) { data.features.pop(); data.returned = data.features.length; omitted = true; break; }
  }
  omitted ||= data.features.length < input.features.length;
  return finalizeSuccess(input.message, data, limit, omitted);
};

export const toFailure = (error: StyleToolError): AiStyleToolResult<never> => {
  const message = normalizedMessage(error.message);
  const path = error.path === undefined ? undefined : truncateUtf8(error.path, MAX_AI_MESSAGE_BYTES);
  const snapshot = createStyleToolError(error.code, message, path);
  const output: { success: false; message: string; error: StyleToolError } = { success: false, message, error: snapshot };
  if (error.details !== undefined) {
    snapshot.details = error.details;
    if (jsonUtf8ByteLength(output) > MAX_AI_OUTPUT_BYTES) snapshot.details = { outputTruncated: true };
    if (jsonUtf8ByteLength(output) > MAX_AI_OUTPUT_BYTES) delete snapshot.details;
  }
  if (jsonUtf8ByteLength(output) > MAX_AI_OUTPUT_BYTES) delete snapshot.path;
  if (jsonUtf8ByteLength(output) > MAX_AI_OUTPUT_BYTES) throw new RangeError('AI failure envelope exceeds output limit.');
  return output;
};

export const createAiTool = <Schema extends z.ZodType, TData>(
  schema: Schema,
  description: string,
  execute: (input: z.output<Schema>) => Promise<AiStyleToolResult<TData>> | AiStyleToolResult<TData>,
) => tool({
  description,
  inputSchema: schema,
  execute: async (rawInput) => {
    const parsed = schema.safeParse(rawInput);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return toFailure(createStyleToolError('INVALID_INPUT', issue?.message ?? 'Tool input is invalid.', issue ? pointer(issue.path) : undefined));
    }
    return execute(parsed.data);
  },
});
