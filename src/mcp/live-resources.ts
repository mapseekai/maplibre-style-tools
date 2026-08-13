import {
  ResourceTemplate,
  type McpServer,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';

import {
  createStyleToolError,
  isStyleToolError,
} from '../core/index.js';
import { BridgeMapIdSchema } from '../bridge/protocol.js';
import type { LiveMapMetadata, LiveMapRegistry } from '../bridge/registry.js';
import type { McpResponseBoundary } from './message-boundary.js';
import type { McpServerExtensionContext } from './server-extension.js';
import type { ResourceUriAdmission } from './types.js';

const LIVE_MAP_RESOURCE_ROOT = 'maplibre-style://maps' as const;

const invalidLiveResourceUri = (): never => {
  throw createStyleToolError(
    'INVALID_INPUT',
    'Live map resource URI is invalid.',
    undefined,
    { reason: 'nonCanonicalResourceUri' },
  );
};

const decodeCanonicalMarkedMapId = (rawSegment: string): string => {
  if (!rawSegment.startsWith('~') || rawSegment.length === 1) invalidLiveResourceUri();
  const encoded = rawSegment.slice(1);
  let semantic: string;
  try { semantic = decodeURIComponent(encoded); } catch { return invalidLiveResourceUri(); }
  if (encodeURIComponent(semantic) !== encoded) invalidLiveResourceUri();
  const parsed = BridgeMapIdSchema.safeParse(semantic);
  if (!parsed.success) invalidLiveResourceUri();
  return parsed.data as string;
};

export const liveMapResourceUriAdmission: ResourceUriAdmission = Object.freeze({
  scheme: 'maplibre-style',
  authority: 'maps',
  assertCanonical(rawUri: string): void {
    if (rawUri === LIVE_MAP_RESOURCE_ROOT) return;
    const prefix = `${LIVE_MAP_RESOURCE_ROOT}/`;
    if (!rawUri.startsWith(prefix) || rawUri.includes('?') || rawUri.includes('#')) {
      invalidLiveResourceUri();
    }
    const segments = rawUri.slice(prefix.length).split('/');
    if (segments.length !== 1
      && !(segments.length === 2 && segments[1] === 'style')) {
      invalidLiveResourceUri();
    }
    decodeCanonicalMarkedMapId(segments[0] ?? '');
  },
});

export function buildLiveMapMetadataUri(mapId: string): string {
  const semanticMapId = BridgeMapIdSchema.parse(mapId);
  return `${LIVE_MAP_RESOURCE_ROOT}/~${encodeURIComponent(semanticMapId)}`;
}

export function buildLiveMapStyleUri(mapId: string): string {
  return `${buildLiveMapMetadataUri(mapId)}/style`;
}

const parseLiveMapResourceUri = (
  uri: URL,
  kind: 'metadata' | 'style',
): string => {
  if (uri.protocol !== 'maplibre-style:' || uri.host !== 'maps'
    || uri.username !== '' || uri.password !== '' || uri.port !== ''
    || uri.search !== '' || uri.hash !== '') invalidLiveResourceUri();
  const segments = uri.pathname.split('/').slice(1);
  if (segments.length !== (kind === 'metadata' ? 1 : 2)
    || (kind === 'style' && segments[1] !== 'style')) invalidLiveResourceUri();
  return decodeCanonicalMarkedMapId(segments[0] ?? '');
};

const publicMetadata = (metadata: LiveMapMetadata) => ({
  mapId: metadata.mapId,
  capabilities: [...metadata.capabilities],
  revision: metadata.revision,
  styleHash: metadata.styleHash,
  syncState: metadata.syncState,
  connectedAt: metadata.connectedAt,
  lastSeenAt: metadata.lastSeenAt,
});

const jsonResource = (uri: string, value: unknown): ReadResourceResult => ({
  contents: [{
    uri,
    mimeType: 'application/json',
    text: JSON.stringify(value),
  }],
});

const disconnected = () => createStyleToolError(
  'BRIDGE_DISCONNECTED', 'Browser bridge disconnected.',
);
const capabilityDenied = () => createStyleToolError(
  'CAPABILITY_DENIED', 'Bridge capability denied.', undefined,
  { commandType: 'getStyle', requiredCapability: 'style.read' },
);
const mapNotReady = () => createStyleToolError(
  'MAP_NOT_READY', 'Map is not ready.', undefined, { syncState: 'unknown' },
);

const pendingStyleReads = new WeakMap<LiveMapRegistry, Map<string, Promise<ReadResourceResult>>>();

const readStyleResource = (
  registry: LiveMapRegistry,
  mapId: string,
  boundary: McpResponseBoundary,
): Promise<ReadResourceResult> | ReadResourceResult => {
  const uri = buildLiveMapStyleUri(mapId);
  const handle = registry.get(mapId);
  if (handle === undefined) throw disconnected();
  if (!handle.metadata.capabilities.includes('style.read')) throw capabilityDenied();
  if (handle.metadata.syncState !== 'known') throw mapNotReady();
  try {
    return registry.projectCachedStyle(mapId, (style) =>
      boundary.requireResourceResult(jsonResource(uri, style)));
  } catch (error) {
    if (!isStyleToolError(error) || error.code !== 'MAP_NOT_READY') throw error;
  }
  let byMap = pendingStyleReads.get(registry);
  if (byMap === undefined) {
    byMap = new Map();
    pendingStyleReads.set(registry, byMap);
  }
  const existing = byMap.get(mapId);
  if (existing !== undefined) return existing;
  const operation = registry.execute(mapId, { type: 'getStyle' }, undefined, (result) =>
    boundary.requireResourceResult(jsonResource(uri, result.style)));
  byMap.set(mapId, operation);
  void operation.finally(() => {
    if (byMap?.get(mapId) === operation) byMap.delete(mapId);
  }).catch(() => undefined);
  return operation;
};

export function registerLiveMapResources(
  server: McpServer,
  registry: LiveMapRegistry,
  context: McpServerExtensionContext,
): void {
  server.registerResource(
    'live-maps',
    LIVE_MAP_RESOURCE_ROOT,
    { title: 'Connected MapLibre Maps', mimeType: 'application/json' },
    context.guardResourceHandler((uri, extra) => {
      void uri;
      void extra;
      return registry.projectList((maps) =>
        context.responseBoundary.requireResourceResult(jsonResource(
          LIVE_MAP_RESOURCE_ROOT,
          { maps: maps.map(publicMetadata) },
        )));
    }),
  );
  server.registerResource(
    'live-map-metadata',
    new ResourceTemplate('maplibre-style://maps/~{mapId}', { list: undefined }),
    { title: 'Live Map Metadata', mimeType: 'application/json' },
    context.guardResourceHandler((uri, variables, extra) => {
      void variables;
      void extra;
      const mapId = parseLiveMapResourceUri(uri, 'metadata');
      return registry.projectMetadata(mapId, (metadata) =>
        context.responseBoundary.requireResourceResult(jsonResource(
          buildLiveMapMetadataUri(mapId), publicMetadata(metadata),
        )));
    }),
  );
  server.registerResource(
    'live-map-style',
    new ResourceTemplate('maplibre-style://maps/~{mapId}/style', { list: undefined }),
    { title: 'Live Map Style', mimeType: 'application/json' },
    context.guardResourceHandler((uri, variables, extra) => {
      void variables;
      void extra;
      return readStyleResource(
        registry,
        parseLiveMapResourceUri(uri, 'style'),
        context.responseBoundary,
      );
    }),
  );
}
