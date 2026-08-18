import type { Map as MapLibreMap } from 'maplibre-gl';
import { createStyleToolError, validateStyleDocument } from '../core/index.js';
import type { StyleDocument, StyleToolError, StyleWarning } from '../core/index.js';
import type { MapAccessor, MapToolContext } from './contracts.js';
import { jsonUtf8ByteLength as coreJsonUtf8ByteLength, utf8ByteLength } from '../core/index.js';

export const jsonUtf8ByteLength = (value: unknown): number => coreJsonUtf8ByteLength(value as never);

export type ValidatedMapStyle =
  | { ok: true; style: StyleDocument; warnings: StyleWarning[] }
  | { ok: false; error: StyleToolError; warnings: StyleWarning[] };

export const readValidatedMapStyle = (getMap: MapAccessor): ValidatedMapStyle => {
  let map: MapLibreMap | null;
  try {
    map = getMap();
  } catch {
    return {
      ok: false,
      error: createStyleToolError('MAP_NOT_READY', 'Map is not ready yet. Please wait until the preview loads, then retry.'),
      warnings: [],
    };
  }
  if (map === null) {
    return {
      ok: false,
      error: createStyleToolError('MAP_NOT_READY', 'Map is not ready yet. Please wait until the preview loads, then retry.'),
      warnings: [],
    };
  }
  let raw: unknown;
  try {
    raw = map.getStyle();
  } catch {
    return {
      ok: false,
      error: createStyleToolError('MAP_NOT_READY', 'Current map style is unavailable.'),
      warnings: [],
    };
  }
  const validation = validateStyleDocument(raw);
  if (!validation.ok) {
    const error = validation.errors[0];
    return {
      ok: false,
      error: createStyleToolError(
        'STYLE_INVALID',
        error?.message ?? 'Current map style is invalid.',
        error?.path,
        error?.details,
      ),
      warnings: validation.warnings,
    };
  }
  return { ok: true, style: validation.style, warnings: validation.warnings };
};

export const snapshotMapToolContext = (
  getContext: (() => MapToolContext) | undefined,
): { activeSourceId?: string; selectedLayerId?: string } => {
  if (getContext === undefined) return {};
  const { activeSourceId, selectedLayerId } = getContext();
  return {
    ...(typeof activeSourceId === 'string' ? { activeSourceId } : {}),
    ...(typeof selectedLayerId === 'string' ? { selectedLayerId } : {}),
  };
};

export const truncateUtf8 = (value: string, maxBytes: number): string => {
  let result = '';
  let bytes = 0;
  for (const character of value) {
    const characterBytes = utf8ByteLength(character);
    if (bytes + characterBytes > maxBytes) break;
    result += character;
    bytes += characterBytes;
  }
  return result;
};
