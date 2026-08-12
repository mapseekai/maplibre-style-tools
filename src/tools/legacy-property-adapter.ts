import type { Map, StyleSpecification } from 'maplibre-gl';
import { applyStyleOperations } from '../engine/style-operations.js';
import type {
  StyleDocument,
  StyleOperation,
  StyleOperationResult,
} from '../types.js';

const emptyStyle = (): StyleDocument => ({
  version: 8,
  sources: {},
  layers: [],
});

const failure = (
  style: StyleDocument,
  message: string
): StyleOperationResult => ({
  success: false,
  message,
  style,
  changedLayers: [],
  diffSummary: [],
});

const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error ? error.message : fallback;

export const applyLegacyPropertyOperationToMap = (
  map: Map,
  operation: StyleOperation,
  diff = true
): StyleOperationResult => {
  let currentStyle: StyleDocument;
  try {
    const mapStyle: unknown = map.getStyle();
    if (typeof mapStyle !== 'object' || mapStyle === null) {
      return failure(emptyStyle(), 'Current map style is unavailable.');
    }
    currentStyle = mapStyle as StyleDocument;
  } catch (error) {
    return failure(
      emptyStyle(),
      errorMessage(error, 'Current map style is unavailable.')
    );
  }

  const result = applyStyleOperations(currentStyle, [operation]);
  if (!result.success || result.diffSummary.length === 0) {
    return result;
  }

  try {
    map.setStyle(result.style as unknown as StyleSpecification, { diff });
    return result;
  } catch (error) {
    return failure(
      currentStyle,
      errorMessage(error, 'Failed to apply the validated style.')
    );
  }
};
