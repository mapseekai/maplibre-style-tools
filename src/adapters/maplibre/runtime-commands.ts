import type { ZodError, ZodType } from 'zod';
import type {
  GeoJSONSource,
  GeoJSONSourceDiff,
  Map,
  Source,
} from 'maplibre-gl';
import {
  createStyleToolError,
  isStyleToolError,
  jsonValueSchema,
} from '../../core/index.js';
import { toJsonPointer } from '../../core/json-pointer.js';
import type {
  JsonObject,
  JsonValue,
  StyleToolError,
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

function normalizeFailure(error: unknown, message: string): StyleToolError {
  return isStyleToolError(error)
    ? error
    : createStyleToolError('INTERNAL', message);
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

function unsupportedGeoJsonSource(sourceId: string, source: Source): StyleToolError {
  return createStyleToolError(
    'UNSUPPORTED_SOURCE',
    `Source "${sourceId}" is not a GeoJSON source.`,
    '/sourceId',
    { sourceId, sourceType: source.type },
  );
}

function isGeoJsonSource(source: Source | undefined): source is GeoJSONSource {
  return source !== undefined
    && source.type === 'geojson'
    && 'updateData' in source
    && typeof source.updateData === 'function';
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

function projectSprite(value: unknown): JsonObject | undefined {
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
  | { ok: true; found: boolean }
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
    if (projected.id === spriteId) return { ok: true, found: true };
  }
  return { ok: true, found: false };
}

function abortedError(): StyleToolError {
  return createStyleToolError(
    'TIMEOUT',
    'Runtime image loading was aborted.',
    '',
    { reason: 'aborted' },
  );
}

function raceAbort<Value>(work: Promise<Value>, signal: AbortSignal): Promise<Value> {
  if (signal.aborted) {
    void work.then(() => undefined, () => undefined);
    return Promise.reject(abortedError());
  }
  return new Promise<Value>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      action();
    };
    const onAbort = (): void => finish(() => reject(abortedError()));
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    work.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
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
      if (signal.aborted) throw abortedError();
      const response = await raceAbort(map.loadImage(url), signal);
      if (signal.aborted) throw abortedError();
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
        if (!isGeoJsonSource(source)) {
          return failure(unsupportedGeoJsonSource(parsed.value.sourceId, source));
        }
        const compatibleDiff: GeoJSONSourceDiff = parsed.value.diff;
        void compatibleDiff;
        await source.updateData(parsed.value.diff);
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
      const signal = execution.signal ?? new AbortController().signal;
      if (signal.aborted) return failure(abortedError());
      try {
        const existedBeforeLoad = map.hasImage(parsed.value.imageId);
        if (existedBeforeLoad && parsed.value.overwrite !== true) {
          return failure(conflict('Image', parsed.value.imageId));
        }
        const loading = Promise.resolve().then(() => {
          if (signal.aborted) throw abortedError();
          return imageLoader.load(parsed.value.url, { signal });
        });
        const image = await raceAbort(loading, signal);
        if (signal.aborted) return failure(abortedError());
        const imageInput: AddImageDataInput = {
          imageId: parsed.value.imageId,
          image,
        };
        if (parsed.value.options !== undefined) imageInput.options = parsed.value.options;
        if (parsed.value.overwrite !== undefined) imageInput.overwrite = parsed.value.overwrite;
        const imageValidation = parseInput(addImageDataInputSchema, imageInput);
        if (!imageValidation.ok) return failure(imageValidation.error);
        const existsAfterLoad = map.hasImage(parsed.value.imageId);
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
        if (signal.aborted) return failure(abortedError());
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
      if (existing.found && parsed.value.overwrite !== true) {
        return failure(conflict('Sprite', parsed.value.spriteId));
      }
      try {
        if (existing.found) map.removeSprite(parsed.value.spriteId);
        map.addSprite(parsed.value.spriteId, parsed.value.url);
        return acknowledgement();
      } catch (error) {
        return failure(normalizeFailure(error, 'MapLibre sprite update failed.'));
      }
    },

    removeSprite(input: RemoveSpriteInput) {
      const parsed = parseInput(removeSpriteInputSchema, input);
      if (!parsed.ok) return failure(parsed.error);
      const queried = readSprites(map);
      if (!queried.ok) return failure(queried.error);
      const existing = findSprite(queried.sprites, queried.length, parsed.value.spriteId);
      if (!existing.ok) return failure(existing.error);
      if (!existing.found) return failure(notFound('Sprite', parsed.value.spriteId));
      try {
        map.removeSprite(parsed.value.spriteId);
        return acknowledgement();
      } catch (error) {
        return failure(normalizeFailure(error, 'MapLibre sprite removal failed.'));
      }
    },
  };
}
