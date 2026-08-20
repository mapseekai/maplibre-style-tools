import { createStyleToolError } from '../core/index.js';
import type {
  StyleDocument,
  StyleToolError,
  StyleTransaction,
  StyleWarning,
} from '../core/index.js';
import type {
  BoundedFeatureQueryResult,
  MapRuntimeCommands,
  MapStyleApplyResult,
  RenderedFeatureQueryInput,
  SourceFeatureQueryInput,
} from '../adapters/maplibre/types.js';
import type { MapToolContext } from './contracts.js';

/// A validated style snapshot read from an authority.
export type AuthorityStyleRead =
  | { ok: true; style: StyleDocument; warnings: StyleWarning[] }
  | { ok: false; error: StyleToolError; warnings: StyleWarning[] };

/// Style-level authority: read, transaction, and whole-document application.
/// Implemented per interface: in-process Map (ai), MCP session store (mcp),
/// remote bridge map (mcp live), or style file (cli).
export interface StyleAuthority {
  readStyle(): AuthorityStyleRead;
  context(): MapToolContext;
  applyTransaction(
    transaction: StyleTransaction,
    options: { diff: boolean },
  ): MapStyleApplyResult | Promise<MapStyleApplyResult>;
  applyDocument(
    source: StyleDocument | string,
    options: { diff: boolean },
  ): MapStyleApplyResult | Promise<MapStyleApplyResult>;
}

/// Runtime authority: live-map commands and feature queries.
/// Only available where a live map exists (in-process or bridged).
export interface RuntimeAuthority {
  runtimeCommands(): MapRuntimeCommands;
  querySourceFeatures(
    input: SourceFeatureQueryInput,
  ): BoundedFeatureQueryResult | Promise<BoundedFeatureQueryResult>;
  queryRenderedFeatures(
    input: RenderedFeatureQueryInput,
  ): BoundedFeatureQueryResult | Promise<BoundedFeatureQueryResult>;
}

/// Lazily resolves the current authority, mirroring map-availability semantics:
/// null means the authority is not ready (for example no map is attached).
export type AuthoritySource<TAuthority> = () => TAuthority | null;

export const AUTHORITY_NOT_READY_ERROR = 'MAP_NOT_READY' as const;

export const authorityNotReadyError = (): StyleToolError =>
  createStyleToolError(AUTHORITY_NOT_READY_ERROR, 'Map is not ready.');
