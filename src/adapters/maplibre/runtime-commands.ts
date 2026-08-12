import type { ZodError, ZodType } from 'zod';
import type {
  GeoJSONSource,
  GeoJSONSourceDiff,
  Map,
  Source,
} from 'maplibre-gl';
import {
  STYLE_TOOL_ERROR_CODES,
  createStyleToolError,
  isStyleToolError,
  jsonValueSchema,
} from '../../core/index.js';
import { toJsonPointer } from '../../core/json-pointer.js';
import type {
  JsonObject,
  JsonValue,
  StyleToolError,
  StyleToolErrorCode,
} from '../../core/index.js';
import { runtimeGeoJsonDiffUpdateSchema } from './geojson-diff.js';
import {
  DEFAULT_RUNTIME_LIST_LIMIT,
  addImageDataInputSchema,
  addImageFromUrlInputSchema,
  addSpriteInputSchema,
  featureStateInputSchema,
  globalStateInputSchema,
  removeFeatureStateInputSchema,
  removeImageInputSchema,
  removeSpriteInputSchema,
  runtimeListInputSchema,
  sourceTileLodParamsInputSchema,
} from './schemas.js';
import type {
  AddImageDataInput,
  AddImageFromUrlInput,
  AddSpriteInput,
  FeatureStateInput,
  GlobalStateInput,
  ImageDataLike,
  MapRuntimeCommands,
  RemoveFeatureStateInput,
  RemoveImageInput,
  RemoveSpriteInput,
  RuntimeCommandExecution,
  RuntimeCommandResult,
  RuntimeGeoJsonDiffUpdate,
  RuntimeImageLoader,
  RuntimeListData,
  RuntimeListInput,
  SourceTileLodParamsInput,
} from './types.js';

type ParsedInput<Value> =
  | { ok: true; value: Value }
  | { ok: false; error: StyleToolError };

function schemaError(error: ZodError): StyleToolError {
  const issue = error.issues[0];
  if (issue === undefined) {
    return createStyleToolError('INVALID_INPUT', 'Runtime command input is invalid.', '');
  }
  const details = 'params' in issue && issue.params !== undefined
    ? jsonValueSchema.safeParse(issue.params)
    : undefined;
  return createStyleToolError(
    'INVALID_INPUT',
    issue.message,
    toJsonPointer(issue.path.map((token) => typeof token === 'symbol' ? String(token) : token)),
    details?.success && !Array.isArray(details.data)
      && details.data !== null && typeof details.data === 'object'
      ? details.data
      : undefined,
  );
}

function parseInput<Value>(schema: ZodType<Value>, input: unknown): ParsedInput<Value> {
  try {
    const parsed = schema.safeParse(input);
    return parsed.success
      ? { ok: true, value: parsed.data }
      : { ok: false, error: schemaError(parsed.error) };
  } catch {
    return {
      ok: false,
      error: createStyleToolError('INVALID_INPUT', 'Runtime command input is invalid.', ''),
    };
  }
}

function isStyleToolErrorCode(value: unknown): value is StyleToolErrorCode {
  return STYLE_TOOL_ERROR_CODES.some((code) => code === value);
}

function safeStyleToolErrorSnapshot(error: unknown): StyleToolError | undefined {
  if (!isStyleToolError(error)) return undefined;
  try {
    const code = inspectOwnEnumerableData(error, 'code');
    const message = inspectOwnEnumerableData(error, 'message');
    if (code.kind !== 'value' || !isStyleToolErrorCode(code.value)
      || message.kind !== 'value' || typeof message.value !== 'string') {
      return undefined;
    }
    const path = inspectOwnEnumerableData(error, 'path');
    if (path.kind === 'invalid') return undefined;
    let safePath: string | undefined;
    if (path.kind === 'value') {
      if (typeof path.value !== 'string') return undefined;
      safePath = path.value;
    }
    const details = inspectOwnEnumerableData(error, 'details');
    if (details.kind === 'invalid') return undefined;
    let safeDetails: JsonObject | undefined;
    if (details.kind === 'value') {
      const parsed = jsonValueSchema.safeParse(details.value);
      if (!parsed.success || parsed.data === null || Array.isArray(parsed.data)
        || typeof parsed.data !== 'object') return undefined;
      safeDetails = parsed.data;
    }
    return createStyleToolError(
      code.value,
      message.value,
      safePath,
      safeDetails,
    );
  } catch {
    return undefined;
  }
}

function normalizeFailure(error: unknown, message: string): StyleToolError {
  return safeStyleToolErrorSnapshot(error)
    ?? createStyleToolError('INTERNAL', message);
}

function rollbackFailure(
  primary: StyleToolError,
  rollback: StyleToolError,
): StyleToolError {
  const details: JsonObject = { ...(primary.details ?? {}) };
  let failedKey = 'rollbackFailed';
  while (Object.hasOwn(details, failedKey)) failedKey = `_${failedKey}`;
  Reflect.defineProperty(details, failedKey, {
    configurable: true,
    enumerable: true,
    value: true,
    writable: true,
  });
  const rollbackSummary: JsonObject = {
    code: rollback.code,
    message: rollback.message,
  };
  if (rollback.path !== undefined) rollbackSummary.path = rollback.path;
  if (rollback.details !== undefined) rollbackSummary.details = rollback.details;
  let rollbackKey = 'rollbackError';
  while (Object.hasOwn(details, rollbackKey)) rollbackKey = `_${rollbackKey}`;
  Reflect.defineProperty(details, rollbackKey, {
    configurable: true,
    enumerable: true,
    value: rollbackSummary,
    writable: true,
  });
  return createStyleToolError(
    primary.code,
    primary.message,
    primary.path,
    details,
  );
}

function failure<T extends JsonValue = JsonValue>(error: StyleToolError): RuntimeCommandResult<T> {
  return { ok: false, error };
}

function acknowledgement(): RuntimeCommandResult {
  return { ok: true, data: null };
}

function notFound(kind: 'Source' | 'Image' | 'Sprite', id: string): StyleToolError {
  const field = kind === 'Source' ? 'sourceId' : kind === 'Image' ? 'imageId' : 'spriteId';
  return createStyleToolError(
    'NOT_FOUND',
    `${kind} "${id}" was not found.`,
    `/${field}`,
    { [field]: id },
  );
}

function conflict(kind: 'Image' | 'Sprite', id: string): StyleToolError {
  const field = kind === 'Image' ? 'imageId' : 'spriteId';
  return createStyleToolError(
    'CONFLICT',
    `${kind} "${id}" already exists.`,
    `/${field}`,
    { [field]: id },
  );
}

function unsupportedGeoJsonSource(sourceId: string, sourceType?: string): StyleToolError {
  const details: JsonObject = sourceType === undefined
    ? { sourceId }
    : { sourceId, sourceType };
  return createStyleToolError(
    'UNSUPPORTED_SOURCE',
    `Source "${sourceId}" is not a GeoJSON source.`,
    '/sourceId',
    details,
  );
}

type DataPropertyInspection =
  | { kind: 'value'; value: unknown }
  | { kind: 'missing' }
  | { kind: 'invalid' };

type GeoJsonSourceInspection =
  | { kind: 'geojson'; updateData: GeoJSONSource['updateData'] }
  | { kind: 'unsupported'; sourceType?: string }
  | { kind: 'invalid' };

function inspectOwnEnumerableData(value: object, key: string): DataPropertyInspection {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) return { kind: 'missing' };
    return descriptor.enumerable && 'value' in descriptor
      ? { kind: 'value', value: descriptor.value }
      : { kind: 'invalid' };
  } catch {
    return { kind: 'invalid' };
  }
}

function inspectPrototypeData(value: object, key: string): DataPropertyInspection {
  try {
    const seen = new Set<object>();
    let current: object | null = value;
    while (current !== null) {
      if (seen.has(current)) return { kind: 'invalid' };
      seen.add(current);
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor !== undefined) {
        return 'value' in descriptor
          ? { kind: 'value', value: descriptor.value }
          : { kind: 'invalid' };
      }
      current = Object.getPrototypeOf(current);
    }
    return { kind: 'missing' };
  } catch {
    return { kind: 'invalid' };
  }
}

function isGeoJsonUpdateData(value: unknown): value is GeoJSONSource['updateData'] {
  return typeof value === 'function';
}

function inspectGeoJsonSource(source: Source): GeoJsonSourceInspection {
  const type = inspectOwnEnumerableData(source, 'type');
  if (type.kind === 'invalid') return { kind: 'invalid' };
  if (type.kind === 'missing') return { kind: 'unsupported' };
  if (type.value !== 'geojson') return typeof type.value === 'string'
    ? { kind: 'unsupported', sourceType: type.value }
    : { kind: 'unsupported' };
  const updateData = inspectPrototypeData(source, 'updateData');
  return updateData.kind === 'value' && isGeoJsonUpdateData(updateData.value)
    ? { kind: 'geojson', updateData: updateData.value }
    : { kind: 'invalid' };
}

function isGeoJsonSource(
  source: Source,
  inspection: GeoJsonSourceInspection,
): source is GeoJSONSource {
  return inspection.kind === 'geojson';
}

function updateGeoJsonSource(
  source: GeoJSONSource,
  updateData: GeoJSONSource['updateData'],
  diff: GeoJSONSourceDiff,
): Promise<void> {
  return Reflect.apply(updateData, source, [diff]);
}

function appendOwn<Value>(values: Value[], value: Value): void {
  Reflect.defineProperty(values, values.length, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function listResult<Item extends JsonValue>(
  items: Item[],
  total: number,
): RuntimeCommandResult<RuntimeListData<Item>> {
  return {
    ok: true,
    data: {
      items,
      returned: items.length,
      truncated: total > items.length,
    },
  };
}

function ownEnumerableData(value: unknown, key: string): unknown | typeof INVALID_DATA {
  if (typeof value !== 'object' || value === null) return INVALID_DATA;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      return INVALID_DATA;
    }
    return descriptor.value;
  } catch {
    return INVALID_DATA;
  }
}

const INVALID_DATA = Symbol('invalidData');

function isUnknownArray(value: unknown): value is unknown[] {
  try {
    return Array.isArray(value);
  } catch {
    return false;
  }
}

function ownArrayLength(value: unknown): number | undefined {
  try {
    if (!isUnknownArray(value)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, 'length');
    return descriptor !== undefined && 'value' in descriptor
      && typeof descriptor.value === 'number'
      && Number.isInteger(descriptor.value) && descriptor.value >= 0
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

type RuntimeSprite = { id: string; url: string };

function projectSprite(value: unknown): RuntimeSprite | undefined {
  const id = ownEnumerableData(value, 'id');
  const url = ownEnumerableData(value, 'url');
  if (typeof id !== 'string' || id.length === 0
    || typeof url !== 'string' || url.length === 0) return undefined;
  return { id, url };
}

function readSprites(map: Map):
  | { ok: true; sprites: unknown[]; length: number }
  | { ok: false; error: StyleToolError } {
  try {
    const sprites: unknown = map.getSprite();
    if (!isUnknownArray(sprites)) {
      return {
        ok: false,
        error: createStyleToolError('INTERNAL', 'MapLibre returned an invalid sprite list.'),
      };
    }
    const length = ownArrayLength(sprites);
    return length !== undefined
      ? { ok: true, sprites, length }
      : {
          ok: false,
          error: createStyleToolError('INTERNAL', 'MapLibre returned an invalid sprite list.'),
        };
  } catch (error) {
    return { ok: false, error: normalizeFailure(error, 'MapLibre sprite query failed.') };
  }
}

function findSprite(sprites: readonly unknown[], length: number, spriteId: string):
  | { ok: true; sprite?: RuntimeSprite }
  | { ok: false; error: StyleToolError } {
  for (let index = 0; index < length; index += 1) {
    const sprite = ownEnumerableData(sprites, String(index));
    if (sprite === INVALID_DATA) {
      return {
        ok: false,
        error: createStyleToolError('INTERNAL', 'MapLibre returned an invalid sprite.'),
      };
    }
    const projected = projectSprite(sprite);
    if (projected === undefined) {
      return {
        ok: false,
        error: createStyleToolError('INTERNAL', 'MapLibre returned an invalid sprite.'),
      };
    }
    if (projected.id === spriteId) return { ok: true, sprite: projected };
  }
  return { ok: true };
}

const abortSignalAbortedGetter = Object.getOwnPropertyDescriptor(
  AbortSignal.prototype,
  'aborted',
)?.get;
const intrinsicAddEventListener = EventTarget.prototype.addEventListener;
const intrinsicRemoveEventListener = EventTarget.prototype.removeEventListener;
const INVALID_ABORT_STATE = Symbol('invalidAbortState');

function readAbortState(signal: object): boolean | typeof INVALID_ABORT_STATE {
  if (abortSignalAbortedGetter === undefined) return INVALID_ABORT_STATE;
  try {
    const value: unknown = Reflect.apply(abortSignalAbortedGetter, signal, []);
    return typeof value === 'boolean' ? value : INVALID_ABORT_STATE;
  } catch {
    return INVALID_ABORT_STATE;
  }
}

function addIntrinsicAbortListener(signal: object, listener: EventListener): boolean {
  try {
    Reflect.apply(intrinsicAddEventListener, signal, [
      'abort', listener, { once: true },
    ]);
    return true;
  } catch {
    return false;
  }
}

function removeIntrinsicAbortListener(signal: object, listener: EventListener): boolean {
  try {
    Reflect.apply(intrinsicRemoveEventListener, signal, ['abort', listener]);
    return true;
  } catch {
    return false;
  }
}

function isAbortSignal(value: unknown): value is AbortSignal {
  if (typeof value !== 'object' || value === null) return false;
  try {
    const keys = Reflect.ownKeys(value);
    if (Reflect.ownKeys(Object.getOwnPropertyDescriptors(value)).length !== keys.length) {
      return false;
    }
  } catch {
    return false;
  }
  if (readAbortState(value) === INVALID_ABORT_STATE) return false;
  const probe = (): void => undefined;
  if (!addIntrinsicAbortListener(value, probe)) return false;
  return removeIntrinsicAbortListener(value, probe);
}

function invalidRuntimeExecution(): StyleToolError {
  return createStyleToolError(
    'INVALID_INPUT',
    'Runtime command execution options are invalid.',
    '',
  );
}

function parseRuntimeExecution(execution: unknown): ParsedInput<AbortSignal> {
  try {
    if (typeof execution !== 'object' || execution === null
      || Object.getPrototypeOf(execution) !== Object.prototype) {
      return { ok: false, error: invalidRuntimeExecution() };
    }
    const keys = Reflect.ownKeys(execution);
    const descriptors = Object.getOwnPropertyDescriptors(execution);
    if (Reflect.ownKeys(descriptors).length !== keys.length
      || keys.some((key) => key !== 'signal')) {
      return { ok: false, error: invalidRuntimeExecution() };
    }
    const signalDescriptor = descriptors.signal;
    if (signalDescriptor === undefined) {
      return { ok: true, value: new AbortController().signal };
    }
    if (!signalDescriptor.enumerable || !('value' in signalDescriptor)
      || !isAbortSignal(signalDescriptor.value)) {
      return { ok: false, error: invalidRuntimeExecution() };
    }
    return { ok: true, value: signalDescriptor.value };
  } catch {
    return { ok: false, error: invalidRuntimeExecution() };
  }
}

function abortedError(): StyleToolError {
  return createStyleToolError(
    'TIMEOUT',
    'Runtime image loading was aborted.',
    '',
    { reason: 'aborted' },
  );
}

function currentSignalFailure(signal: object): StyleToolError | undefined {
  const state = readAbortState(signal);
  if (state === INVALID_ABORT_STATE) return invalidRuntimeExecution();
  return state ? abortedError() : undefined;
}

function raceAbort<Value>(work: Promise<Value>, signal: AbortSignal): Promise<Value> {
  return new Promise<Value>((resolve, reject) => {
    let settled = false;
    let subscribed = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      if (subscribed) removeIntrinsicAbortListener(signal, onAbort);
      action();
    };
    const onAbort = (): void => finish(() => reject(abortedError()));
    void work.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
    const before = readAbortState(signal);
    if (before === INVALID_ABORT_STATE) {
      finish(() => reject(invalidRuntimeExecution()));
      return;
    }
    if (before) {
      onAbort();
      return;
    }
    subscribed = addIntrinsicAbortListener(signal, onAbort);
    if (!subscribed) {
      finish(() => reject(invalidRuntimeExecution()));
      return;
    }
    const after = readAbortState(signal);
    if (after === INVALID_ABORT_STATE) {
      finish(() => reject(invalidRuntimeExecution()));
    } else if (after) {
      onAbort();
    }
  });
}

function rawImageData(value: unknown): ImageDataLike | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const width = ownEnumerableData(value, 'width');
  const height = ownEnumerableData(value, 'height');
  const data = ownEnumerableData(value, 'data');
  if (typeof width !== 'number' || !Number.isSafeInteger(width) || width <= 0
    || typeof height !== 'number' || !Number.isSafeInteger(height) || height <= 0
    || !(data instanceof Uint8Array || data instanceof Uint8ClampedArray)
    || (Object.getPrototypeOf(data) !== Uint8Array.prototype
      && Object.getPrototypeOf(data) !== Uint8ClampedArray.prototype)
    || data.length !== width * height * 4) return undefined;
  return { width, height, data };
}

function rasterizeLoadedImage(
  image: HTMLImageElement | ImageBitmap,
): ImageDataLike {
  const direct = rawImageData(image);
  if (direct !== undefined) return direct;
  const { width, height } = image;
  if (!Number.isSafeInteger(width) || width <= 0
    || !Number.isSafeInteger(height) || height <= 0) {
    throw new Error('MapLibre returned image dimensions that are invalid.');
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('A 2D image decoding context is unavailable.');
    context.drawImage(image, 0, 0);
    const decoded = context.getImageData(0, 0, width, height);
    return { width, height, data: decoded.data };
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('A 2D image decoding context is unavailable.');
    context.drawImage(image, 0, 0);
    const decoded = context.getImageData(0, 0, width, height);
    return { width, height, data: decoded.data };
  }
  throw new Error('Decoded MapLibre image pixels are unavailable in this runtime.');
}

function defaultImageLoader(map: Map): RuntimeImageLoader {
  return {
    async load(url, { signal }) {
      const before = currentSignalFailure(signal);
      if (before !== undefined) throw before;
      const response = await raceAbort(map.loadImage(url), signal);
      const after = currentSignalFailure(signal);
      if (after !== undefined) throw after;
      return rasterizeLoadedImage(response.data);
    },
  };
}

export function createMapRuntimeCommands(
  map: Map,
  options?: { imageLoader?: RuntimeImageLoader },
): MapRuntimeCommands {
  const imageLoader = options?.imageLoader ?? defaultImageLoader(map);

  return {
    async updateGeoJsonDataRuntime(input: RuntimeGeoJsonDiffUpdate) {
      const parsed = parseInput(runtimeGeoJsonDiffUpdateSchema, input);
      if (!parsed.ok) return failure(parsed.error);
      try {
        const source = map.getSource(parsed.value.sourceId);
        if (source === undefined) return failure(notFound('Source', parsed.value.sourceId));
        const inspection = inspectGeoJsonSource(source);
        if (inspection.kind === 'invalid') {
          return failure(createStyleToolError(
            'INTERNAL',
            'MapLibre returned an unreadable source.',
            '/sourceId',
            { sourceId: parsed.value.sourceId },
          ));
        }
        if (inspection.kind === 'unsupported') {
          return failure(unsupportedGeoJsonSource(
            parsed.value.sourceId,
            inspection.sourceType,
          ));
        }
        if (!isGeoJsonSource(source, inspection)) {
          return failure(createStyleToolError(
            'INTERNAL',
            'MapLibre returned an unreadable source.',
            '/sourceId',
            { sourceId: parsed.value.sourceId },
          ));
        }
        const compatibleDiff: GeoJSONSourceDiff = parsed.value.diff;
        void compatibleDiff;
        await updateGeoJsonSource(source, inspection.updateData, parsed.value.diff);
        return acknowledgement();
      } catch (error) {
        return failure(normalizeFailure(error, 'MapLibre GeoJSON update failed.'));
      }
    },

    setSourceTileLodParams(input: SourceTileLodParamsInput) {
      const parsed = parseInput(sourceTileLodParamsInputSchema, input);
      if (!parsed.ok) return failure(parsed.error);
      try {
        if (parsed.value.sourceId !== undefined
          && map.getSource(parsed.value.sourceId) === undefined) {
          return failure(notFound('Source', parsed.value.sourceId));
        }
        map.setSourceTileLodParams(
          parsed.value.maxZoomLevelsOnScreen,
          parsed.value.tileCountMaxMinRatio,
          parsed.value.sourceId,
        );
        return acknowledgement();
      } catch (error) {
        return failure(normalizeFailure(error, 'MapLibre source tile LOD update failed.'));
      }
    },

    setFeatureState(input: FeatureStateInput) {
      const parsed = parseInput(featureStateInputSchema, input);
      if (!parsed.ok) return failure(parsed.error);
      try {
        map.setFeatureState(parsed.value.target, parsed.value.state);
        return acknowledgement();
      } catch (error) {
        return failure(normalizeFailure(error, 'MapLibre feature-state update failed.'));
      }
    },

    removeFeatureState(input: RemoveFeatureStateInput) {
      const parsed = parseInput(removeFeatureStateInputSchema, input);
      if (!parsed.ok) return failure(parsed.error);
      try {
        map.removeFeatureState(parsed.value.target, parsed.value.key);
        return acknowledgement();
      } catch (error) {
        return failure(normalizeFailure(error, 'MapLibre feature-state removal failed.'));
      }
    },

    setGlobalState(input: GlobalStateInput) {
      const parsed = parseInput(globalStateInputSchema, input);
      if (!parsed.ok) return failure(parsed.error);
      try {
        map.setGlobalStateProperty(parsed.value.propertyName, parsed.value.value);
        return acknowledgement();
      } catch (error) {
        return failure(normalizeFailure(error, 'MapLibre global-state update failed.'));
      }
    },

    listImages(input: RuntimeListInput = {}) {
      const parsed = parseInput(runtimeListInputSchema, input);
      if (!parsed.ok) return failure<RuntimeListData<string>>(parsed.error);
      let rawImages: unknown;
      try {
        rawImages = map.listImages();
      } catch (error) {
        return failure<RuntimeListData<string>>(
          normalizeFailure(error, 'MapLibre image query failed.'),
        );
      }
      if (!isUnknownArray(rawImages)) {
        return failure<RuntimeListData<string>>(
          createStyleToolError('INTERNAL', 'MapLibre returned an invalid image list.'),
        );
      }
      const imageCount = ownArrayLength(rawImages);
      if (imageCount === undefined) {
        return failure<RuntimeListData<string>>(
          createStyleToolError('INTERNAL', 'MapLibre returned an invalid image list.'),
        );
      }
      const limit = parsed.value.limit ?? DEFAULT_RUNTIME_LIST_LIMIT;
      const items: string[] = [];
      const count = Math.min(imageCount, limit);
      for (let index = 0; index < count; index += 1) {
        const imageId = ownEnumerableData(rawImages, String(index));
        if (typeof imageId !== 'string' || imageId.length === 0) {
          return failure<RuntimeListData<string>>(
            createStyleToolError('INTERNAL', 'MapLibre returned an invalid image ID.'),
          );
        }
        appendOwn(items, imageId);
      }
      return listResult(items, imageCount);
    },

    addImageData(input: AddImageDataInput) {
      const parsed = parseInput(addImageDataInputSchema, input);
      if (!parsed.ok) return failure(parsed.error);
      try {
        const exists = map.hasImage(parsed.value.imageId);
        if (exists && parsed.value.overwrite !== true) {
          return failure(conflict('Image', parsed.value.imageId));
        }
        if (exists) map.updateImage(parsed.value.imageId, parsed.value.image);
        else map.addImage(parsed.value.imageId, parsed.value.image, parsed.value.options);
        return acknowledgement();
      } catch (error) {
        return failure(normalizeFailure(error, 'MapLibre image update failed.'));
      }
    },

    async addImageFromUrl(
      input: AddImageFromUrlInput,
      execution: RuntimeCommandExecution = {},
    ) {
      const parsed = parseInput(addImageFromUrlInputSchema, input);
      if (!parsed.ok) return failure(parsed.error);
      const parsedExecution = parseRuntimeExecution(execution);
      if (!parsedExecution.ok) return failure(parsedExecution.error);
      const signal = parsedExecution.value;
      try {
        const before = currentSignalFailure(signal);
        if (before !== undefined) return failure(before);
        const existedBeforeLoad = map.hasImage(parsed.value.imageId);
        if (existedBeforeLoad && parsed.value.overwrite !== true) {
          return failure(conflict('Image', parsed.value.imageId));
        }
        const loading = Promise.resolve().then(() => {
          const loadingFailure = currentSignalFailure(signal);
          if (loadingFailure !== undefined) throw loadingFailure;
          return imageLoader.load(parsed.value.url, { signal });
        });
        const image = await raceAbort(loading, signal);
        const after = currentSignalFailure(signal);
        if (after !== undefined) return failure(after);
        const imageInput: AddImageDataInput = {
          imageId: parsed.value.imageId,
          image,
        };
        if (parsed.value.options !== undefined) imageInput.options = parsed.value.options;
        if (parsed.value.overwrite !== undefined) imageInput.overwrite = parsed.value.overwrite;
        const imageValidation = parseInput(addImageDataInputSchema, imageInput);
        if (!imageValidation.ok) return failure(imageValidation.error);
        const existsAfterLoad = map.hasImage(parsed.value.imageId);
        const finalSignalFailure = currentSignalFailure(signal);
        if (finalSignalFailure !== undefined) return failure(finalSignalFailure);
        if (existsAfterLoad && parsed.value.overwrite !== true) {
          return failure(conflict('Image', parsed.value.imageId));
        }
        if (existsAfterLoad) {
          map.updateImage(parsed.value.imageId, imageValidation.value.image);
        } else {
          map.addImage(
            parsed.value.imageId,
            imageValidation.value.image,
            imageValidation.value.options,
          );
        }
        return acknowledgement();
      } catch (error) {
        const signalFailure = currentSignalFailure(signal);
        if (signalFailure !== undefined) return failure(signalFailure);
        return failure(normalizeFailure(error, 'MapLibre image loading failed.'));
      }
    },

    removeImage(input: RemoveImageInput) {
      const parsed = parseInput(removeImageInputSchema, input);
      if (!parsed.ok) return failure(parsed.error);
      try {
        if (!map.hasImage(parsed.value.imageId)) {
          return failure(notFound('Image', parsed.value.imageId));
        }
        map.removeImage(parsed.value.imageId);
        return acknowledgement();
      } catch (error) {
        return failure(normalizeFailure(error, 'MapLibre image removal failed.'));
      }
    },

    listSprites(input: RuntimeListInput = {}) {
      const parsed = parseInput(runtimeListInputSchema, input);
      if (!parsed.ok) return failure<RuntimeListData<JsonObject>>(parsed.error);
      const queried = readSprites(map);
      if (!queried.ok) return failure<RuntimeListData<JsonObject>>(queried.error);
      const limit = parsed.value.limit ?? DEFAULT_RUNTIME_LIST_LIMIT;
      const items: JsonObject[] = [];
      const count = Math.min(queried.length, limit);
      for (let index = 0; index < count; index += 1) {
        const rawSprite = ownEnumerableData(queried.sprites, String(index));
        const sprite = rawSprite === INVALID_DATA ? undefined : projectSprite(rawSprite);
        if (sprite === undefined) {
          return failure<RuntimeListData<JsonObject>>(
            createStyleToolError('INTERNAL', 'MapLibre returned an invalid sprite.'),
          );
        }
        appendOwn(items, sprite);
      }
      return listResult(items, queried.length);
    },

    addSprite(input: AddSpriteInput) {
      const parsed = parseInput(addSpriteInputSchema, input);
      if (!parsed.ok) return failure(parsed.error);
      const queried = readSprites(map);
      if (!queried.ok) return failure(queried.error);
      const existing = findSprite(queried.sprites, queried.length, parsed.value.spriteId);
      if (!existing.ok) return failure(existing.error);
      if (existing.sprite !== undefined && parsed.value.overwrite !== true) {
        return failure(conflict('Sprite', parsed.value.spriteId));
      }
      let removedExisting = false;
      try {
        if (existing.sprite !== undefined) {
          map.removeSprite(parsed.value.spriteId);
          removedExisting = true;
        }
        map.addSprite(parsed.value.spriteId, parsed.value.url);
        return acknowledgement();
      } catch (error) {
        const primary = normalizeFailure(error, 'MapLibre sprite update failed.');
        if (removedExisting && existing.sprite !== undefined) {
          try {
            map.addSprite(existing.sprite.id, existing.sprite.url);
          } catch (error) {
            const rollback = normalizeFailure(error, 'MapLibre sprite rollback failed.');
            return failure(rollbackFailure(primary, rollback));
          }
        }
        return failure(primary);
      }
    },

    removeSprite(input: RemoveSpriteInput) {
      const parsed = parseInput(removeSpriteInputSchema, input);
      if (!parsed.ok) return failure(parsed.error);
      const queried = readSprites(map);
      if (!queried.ok) return failure(queried.error);
      const existing = findSprite(queried.sprites, queried.length, parsed.value.spriteId);
      if (!existing.ok) return failure(existing.error);
      if (existing.sprite === undefined) return failure(notFound('Sprite', parsed.value.spriteId));
      try {
        map.removeSprite(parsed.value.spriteId);
        return acknowledgement();
      } catch (error) {
        return failure(normalizeFailure(error, 'MapLibre sprite removal failed.'));
      }
    },
  };
}
