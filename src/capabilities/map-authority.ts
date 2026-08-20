import type { Map as MapLibreMap } from 'maplibre-gl';
import {
  applyStyleDocumentOrUrlToMap,
  applyTransactionToMap,
} from '../adapters/maplibre/map-adapter.js';
import {
  queryRenderedFeaturesBounded,
  querySourceFeaturesBounded,
} from '../adapters/maplibre/feature-query.js';
import { createMapRuntimeCommands } from '../adapters/maplibre/runtime-commands.js';
import type {
  BoundedFeatureQueryResult,
  MapRuntimeCommands,
  MapStyleApplyResult,
  RenderedFeatureQueryInput,
  RuntimeImageLoader,
  SourceFeatureQueryInput,
} from '../adapters/maplibre/types.js';
import type { StyleDocument, StyleTransaction } from '../core/index.js';
import type {
  AuthorityStyleRead,
  RuntimeAuthority,
  StyleAuthority,
} from './authority.js';
import type { MapToolContext } from './contracts.js';
import { readValidatedMapStyle, snapshotMapToolContext } from './shared.js';

export interface MapAuthorityOptions {
  getContext?: () => MapToolContext;
  imageLoader?: RuntimeImageLoader;
}

/// StyleAuthority + RuntimeAuthority over an in-process MapLibre map.
export class MapStyleAuthority implements StyleAuthority, RuntimeAuthority {
  constructor(
    private readonly map: MapLibreMap,
    private readonly options: MapAuthorityOptions = {},
  ) {}

  readStyle(): AuthorityStyleRead {
    const map = this.map;
    return readValidatedMapStyle(() => map);
  }

  context(): MapToolContext {
    return snapshotMapToolContext(this.options.getContext);
  }

  applyTransaction(
    transaction: StyleTransaction,
    options: { diff: boolean },
  ): Promise<MapStyleApplyResult> {
    return applyTransactionToMap(this.map, transaction, options);
  }

  applyDocument(
    source: StyleDocument | string,
    options: { diff: boolean },
  ): Promise<MapStyleApplyResult> {
    return applyStyleDocumentOrUrlToMap(this.map, source, options);
  }

  runtimeCommands(): MapRuntimeCommands {
    return createMapRuntimeCommands(this.map, {
      ...(this.options.imageLoader === undefined
        ? {} : { imageLoader: this.options.imageLoader }),
    });
  }

  querySourceFeatures(input: SourceFeatureQueryInput): BoundedFeatureQueryResult {
    return querySourceFeaturesBounded(this.map, input);
  }

  queryRenderedFeatures(input: RenderedFeatureQueryInput): BoundedFeatureQueryResult {
    return queryRenderedFeaturesBounded(this.map, input);
  }
}
