import {
  buildStyleContext,
  createStyleToolError,
} from '../core/index.js';
import type { McpResponseBoundary } from './message-boundary.js';
import {
  projectStyleSession,
  projectStyleSessionRevision,
  type StyleSessionStore,
} from './session-store.js';
import type {
  McpResourceResult,
  ResourceUriAdmission,
} from './types.js';

export const styleResourceTemplates = Object.freeze([
  'maplibre-style://sessions/~{sessionId}',
  'maplibre-style://sessions/~{sessionId}/style',
  'maplibre-style://sessions/~{sessionId}/context',
  'maplibre-style://sessions/~{sessionId}/layers/~{layerId}',
  'maplibre-style://sessions/~{sessionId}/sources/~{sourceId}',
  'maplibre-style://sessions/~{sessionId}/revisions/~{revision}/diff',
] as const);

const resourcePrefix = 'maplibre-style://sessions/';

const resourceError = (
  code: 'INVALID_INPUT' | 'NOT_FOUND' | 'INTERNAL',
  message: string,
  reason: string,
) => createStyleToolError(code, message, undefined, { reason });

const nonCanonicalResourceUri = () => resourceError(
  'INVALID_INPUT',
  'Resource URI is not canonical.',
  'nonCanonicalResourceUri',
);

const encodeDynamicSegment = (value: string): string => {
  try {
    return `~${encodeURIComponent(value)}`;
  } catch {
    throw nonCanonicalResourceUri();
  }
};

const decodeDynamicSegment = (raw: string): string => {
  if (!raw.startsWith('~')) throw nonCanonicalResourceUri();
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw.slice(1));
  } catch {
    throw nonCanonicalResourceUri();
  }
  if (encodeDynamicSegment(decoded) !== raw) throw nonCanonicalResourceUri();
  return decoded;
};

type ParsedResourceRoute =
  | { readonly kind: 'session'; readonly sessionId: string }
  | { readonly kind: 'style'; readonly sessionId: string }
  | { readonly kind: 'context'; readonly sessionId: string }
  | { readonly kind: 'layer'; readonly sessionId: string; readonly layerId: string }
  | { readonly kind: 'source'; readonly sessionId: string; readonly sourceId: string }
  | { readonly kind: 'diff'; readonly sessionId: string; readonly revision: number };

const parseRevision = (raw: string): number => {
  const decoded = decodeDynamicSegment(raw);
  if (!/^(?:0|[1-9][0-9]*)$/u.test(decoded)) {
    throw resourceError(
      'INVALID_INPUT', 'Revision must be a non-negative safe integer.', 'invalidRevision',
    );
  }
  const revision = Number(decoded);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw resourceError(
      'INVALID_INPUT', 'Revision must be a non-negative safe integer.', 'invalidRevision',
    );
  }
  return revision;
};

const parseCanonicalResourceUri = (rawUri: string): ParsedResourceRoute => {
  if (typeof rawUri !== 'string'
    || !rawUri.startsWith(resourcePrefix)
    || rawUri.includes('?')
    || rawUri.includes('#')) {
    throw nonCanonicalResourceUri();
  }
  const segments = rawUri.slice(resourcePrefix.length).split('/');
  if (segments.length === 1 && segments[0] !== undefined) {
    return { kind: 'session', sessionId: decodeDynamicSegment(segments[0]) };
  }
  if (segments.length === 2 && segments[0] !== undefined) {
    const sessionId = decodeDynamicSegment(segments[0]);
    if (segments[1] === 'style') return { kind: 'style', sessionId };
    if (segments[1] === 'context') return { kind: 'context', sessionId };
    throw nonCanonicalResourceUri();
  }
  if (segments.length === 3 && segments[0] !== undefined && segments[2] !== undefined) {
    const sessionId = decodeDynamicSegment(segments[0]);
    if (segments[1] === 'layers') {
      return { kind: 'layer', sessionId, layerId: decodeDynamicSegment(segments[2]) };
    }
    if (segments[1] === 'sources') {
      return { kind: 'source', sessionId, sourceId: decodeDynamicSegment(segments[2]) };
    }
    throw nonCanonicalResourceUri();
  }
  if (segments.length === 4
    && segments[0] !== undefined
    && segments[1] === 'revisions'
    && segments[2] !== undefined
    && segments[3] === 'diff') {
    return {
      kind: 'diff',
      sessionId: decodeDynamicSegment(segments[0]),
      revision: parseRevision(segments[2]),
    };
  }
  throw nonCanonicalResourceUri();
};

export const documentResourceUriAdmission: ResourceUriAdmission = Object.freeze({
  scheme: 'maplibre-style',
  authority: 'sessions',
  assertCanonical(rawUri: string): void {
    parseCanonicalResourceUri(rawUri);
  },
});

const makeUri = (...segments: string[]): URL => new URL(`${resourcePrefix}${segments.join('/')}`);

export const makeSessionUri = (sessionId: string): URL =>
  makeUri(encodeDynamicSegment(sessionId));

export const makeStyleUri = (sessionId: string): URL =>
  makeUri(encodeDynamicSegment(sessionId), 'style');

export const makeContextUri = (sessionId: string): URL =>
  makeUri(encodeDynamicSegment(sessionId), 'context');

export const makeLayerUri = (sessionId: string, layerId: string): URL =>
  makeUri(encodeDynamicSegment(sessionId), 'layers', encodeDynamicSegment(layerId));

export const makeSourceUri = (sessionId: string, sourceId: string): URL =>
  makeUri(encodeDynamicSegment(sessionId), 'sources', encodeDynamicSegment(sourceId));

export const makeDiffUri = (sessionId: string, revision: number): URL => {
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw resourceError(
      'INVALID_INPUT', 'Revision must be a non-negative safe integer.', 'invalidRevision',
    );
  }
  return makeUri(
    encodeDynamicSegment(sessionId),
    'revisions',
    encodeDynamicSegment(String(revision)),
    'diff',
  );
};

export interface ParsedSessionUri { readonly sessionId: string }
export interface ParsedStyleUri { readonly sessionId: string }
export interface ParsedContextUri { readonly sessionId: string }
export interface ParsedLayerUri { readonly sessionId: string; readonly layerId: string }
export interface ParsedSourceUri { readonly sessionId: string; readonly sourceId: string }
export interface ParsedDiffUri { readonly sessionId: string; readonly revision: number }

const requireRoute = <Kind extends ParsedResourceRoute['kind']>(
  uri: URL,
  kind: Kind,
): Extract<ParsedResourceRoute, { kind: Kind }> => {
  const route = parseCanonicalResourceUri(uri.href);
  if (route.kind !== kind) throw nonCanonicalResourceUri();
  return route as Extract<ParsedResourceRoute, { kind: Kind }>;
};

export const parseSessionUri = (uri: URL): ParsedSessionUri => {
  const { sessionId } = requireRoute(uri, 'session');
  return { sessionId };
};

export const parseStyleUri = (uri: URL): ParsedStyleUri => {
  const { sessionId } = requireRoute(uri, 'style');
  return { sessionId };
};

export const parseContextUri = (uri: URL): ParsedContextUri => {
  const { sessionId } = requireRoute(uri, 'context');
  return { sessionId };
};

export const parseLayerUri = (uri: URL): ParsedLayerUri => {
  const { sessionId, layerId } = requireRoute(uri, 'layer');
  return { sessionId, layerId };
};

export const parseSourceUri = (uri: URL): ParsedSourceUri => {
  const { sessionId, sourceId } = requireRoute(uri, 'source');
  return { sessionId, sourceId };
};

export const parseDiffUri = (uri: URL): ParsedDiffUri => {
  const { sessionId, revision } = requireRoute(uri, 'diff');
  return { sessionId, revision };
};

const resultFor = (uri: URL, payload: unknown): McpResourceResult => {
  const text = JSON.stringify(payload);
  if (text === undefined) {
    throw resourceError('INTERNAL', 'Resource result could not be serialized.', 'resourceSerialization');
  }
  return {
    contents: [{ uri: uri.href, mimeType: 'application/json', text }],
  };
};

export interface McpResourceResolver {
  resolve(uri: URL): Promise<McpResourceResult>;
}

export const createResourceResolver = (
  store: StyleSessionStore,
  responseBoundary: McpResponseBoundary,
): McpResourceResolver => Object.freeze({
  async resolve(uri: URL): Promise<McpResourceResult> {
    documentResourceUriAdmission.assertCanonical(uri.href);
    const route = parseCanonicalResourceUri(uri.href);

    if (route.kind === 'diff') {
      if (route.revision === 0) {
        throw resourceError(
          'INVALID_INPUT',
          'The baseline revision has no incoming diff.',
          'baselineHasNoDiff',
        );
      }
      return projectStyleSessionRevision(store, route.sessionId, route.revision, (snapshot) =>
        responseBoundary.requireResourceResult(resultFor(uri, {
          sessionId: route.sessionId,
          revision: snapshot.revision,
          diff: snapshot.incomingDiff,
        })));
    }

    return projectStyleSession(store, route.sessionId, (snapshot) => {
      switch (route.kind) {
        case 'session':
          return responseBoundary.requireResourceResult(resultFor(uri, {
            sessionId: snapshot.sessionId,
            revision: snapshot.revision,
            history: snapshot.history,
            lastAccessedAt: snapshot.lastAccessedAt,
            expiresAt: snapshot.expiresAt,
          }));
        case 'style':
          return responseBoundary.requireResourceResult(resultFor(uri, snapshot.style.view));
        case 'context':
          return snapshot.style.withStyle((style) => responseBoundary.requireResourceResult(
            resultFor(uri, buildStyleContext(style)),
          ));
        case 'layer':
          return snapshot.style.withStyle((style) => {
            const layer = style.layers.find((candidate) => candidate.id === route.layerId);
            if (layer === undefined) {
              throw resourceError('NOT_FOUND', 'Style layer was not found.', 'layerNotFound');
            }
            return responseBoundary.requireResourceResult(resultFor(uri, {
              sessionId: snapshot.sessionId,
              revision: snapshot.revision,
              layer,
            }));
          });
        case 'source':
          return snapshot.style.withStyle((style) => {
            const descriptor = Object.getOwnPropertyDescriptor(
              style.sources,
              route.sourceId,
            );
            if (descriptor === undefined || !('value' in descriptor)) {
              throw resourceError('NOT_FOUND', 'Style source was not found.', 'sourceNotFound');
            }
            return responseBoundary.requireResourceResult(resultFor(uri, {
              sessionId: snapshot.sessionId,
              revision: snapshot.revision,
              source: descriptor.value,
            }));
          });
      }
    });
  },
});
