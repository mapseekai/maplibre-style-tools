import {
  createStyleToolError,
  utf8ByteLength,
  type StyleDocument,
} from '../core/index.js';
import type { DeepReadonlyPrepared } from '../adapters/maplibre/types.js';
import type { BridgeCapability } from './protocol.js';

export interface ResourcePolicy {
  baseUrl: string;
  allowedResourceOrigins: readonly string[];
  allowedUrlPrefixes?: readonly string[];
  allowDataUrls?: boolean;
  maxDataUrlBytes?: number;
  allowedProtocols?: readonly string[];
  isProtocolRegistered?: (scheme: string) => boolean;
}

export interface NormalizedResourcePolicy {
  readonly baseUrl: string;
  readonly allowedResourceOrigins: readonly string[];
  readonly allowedUrlPrefixes: readonly string[];
  readonly allowDataUrls: boolean;
  readonly maxDataUrlBytes: number;
  readonly allowedProtocols: readonly string[];
  readonly isProtocolRegistered?: (scheme: string) => boolean;
}

export interface ResourceReference {
  path: string;
  value: string;
}

export interface StyleResourcePolicyInput {
  baseline: DeepReadonlyPrepared<StyleDocument>;
  candidate: DeepReadonlyPrepared<StyleDocument>;
  capabilities: readonly BridgeCapability[];
  policy: ResourcePolicy | NormalizedResourcePolicy;
}

export interface RuntimeImageResourcePolicyInput {
  imageId: string;
  url: string;
  capabilities: readonly BridgeCapability[];
  policy: ResourcePolicy | NormalizedResourcePolicy;
}

export interface StyleDocumentUrlPolicyInput {
  url: string;
  capabilities: readonly BridgeCapability[];
  policy: ResourcePolicy | NormalizedResourcePolicy;
}

const ABSOLUTE_RESOURCE_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/u;
const CUSTOM_PROTOCOL = /^[a-z][a-z0-9+.-]*$/u;
const DEFAULT_MAX_DATA_URL_BYTES = 1024 * 1024;
const FORBIDDEN_PROTOCOLS = new Set(['blob', 'file', 'javascript']);

const isRecord = (value: unknown): value is Record<PropertyKey, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const ownDataValue = (value: object, key: PropertyKey): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
};

const parseAbsoluteUrl = (value: string, label: string): URL => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError(`${label} must be an absolute URL`);
  }
  return parsed;
};

const assertNoCredentials = (url: URL, label: string): void => {
  if (url.username !== '' || url.password !== '') {
    throw new TypeError(`${label} must not contain credentials`);
  }
};

const normalizeOrigin = (value: string): string => {
  const url = parseAbsoluteUrl(value, 'resource origin');
  if ((url.protocol !== 'http:' && url.protocol !== 'https:')
    || url.origin === 'null'
    || url.pathname !== '/'
    || url.search !== ''
    || url.hash !== ''
    || url.hostname.includes('*')) {
    throw new TypeError('resource origin must be a lossless HTTP(S) origin');
  }
  assertNoCredentials(url, 'resource origin');
  return url.origin;
};

const normalizePrefix = (value: string): string => {
  const url = parseAbsoluteUrl(value, 'URL prefix');
  if ((url.protocol !== 'http:' && url.protocol !== 'https:')
    || url.origin === 'null'
    || url.hash !== ''
    || url.hostname.includes('*')) {
    throw new TypeError('URL prefix must be an absolute HTTP(S) URL without a fragment');
  }
  assertNoCredentials(url, 'URL prefix');
  return url.href;
};

const normalizeBaseUrl = (value: string): string => {
  const url = parseAbsoluteUrl(value, 'resource baseUrl');
  if (FORBIDDEN_PROTOCOLS.has(url.protocol.slice(0, -1).toLowerCase())) {
    throw new TypeError('resource baseUrl uses a forbidden protocol');
  }
  assertNoCredentials(url, 'resource baseUrl');
  return url.href;
};

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)];

export function normalizeResourcePolicy(
  policy: ResourcePolicy | NormalizedResourcePolicy,
): NormalizedResourcePolicy {
  if (!isRecord(policy)) throw new TypeError('resource policy must be an object');
  const maxDataUrlBytes = policy.maxDataUrlBytes ?? DEFAULT_MAX_DATA_URL_BYTES;
  if (!Number.isSafeInteger(maxDataUrlBytes) || maxDataUrlBytes <= 0) {
    throw new RangeError('maxDataUrlBytes must be a positive safe integer');
  }
  if (typeof policy.isProtocolRegistered !== 'undefined'
    && typeof policy.isProtocolRegistered !== 'function') {
    throw new TypeError('isProtocolRegistered must be a function');
  }
  const allowedProtocols = unique((policy.allowedProtocols ?? []).map((value) => {
    const scheme = value.toLowerCase();
    if (!CUSTOM_PROTOCOL.test(scheme)
      || scheme === 'http'
      || scheme === 'https'
      || scheme === 'data'
      || FORBIDDEN_PROTOCOLS.has(scheme)) {
      throw new TypeError('allowed protocol must name a safe custom scheme');
    }
    return scheme;
  }));
  return Object.freeze({
    baseUrl: normalizeBaseUrl(policy.baseUrl),
    allowedResourceOrigins: Object.freeze(unique(policy.allowedResourceOrigins.map(normalizeOrigin))),
    allowedUrlPrefixes: Object.freeze(unique((policy.allowedUrlPrefixes ?? []).map(normalizePrefix))),
    allowDataUrls: policy.allowDataUrls === true,
    maxDataUrlBytes,
    allowedProtocols: Object.freeze(allowedProtocols),
    ...(policy.isProtocolRegistered === undefined
      ? {}
      : { isProtocolRegistered: policy.isProtocolRegistered }),
  });
}

const escapeJsonPointer = (value: string): string => value.replaceAll('~', '~0').replaceAll('/', '~1');

const addString = (references: ResourceReference[], path: string, value: unknown): void => {
  if (typeof value === 'string') references.push({ path, value });
};

const addStringArray = (
  references: ResourceReference[],
  path: string,
  value: unknown,
): void => {
  if (!Array.isArray(value)) return;
  for (let index = 0; index < value.length; index += 1) {
    addString(references, `${path}/${index}`, ownDataValue(value, index));
  }
};

const collectSprite = (references: ResourceReference[], sprite: unknown): void => {
  if (typeof sprite === 'string') {
    addString(references, '/sprite', sprite);
    return;
  }
  if (!Array.isArray(sprite)) return;
  for (let index = 0; index < sprite.length; index += 1) {
    const entry = ownDataValue(sprite, index);
    if (isRecord(entry)) addString(references, `/sprite/${index}/url`, ownDataValue(entry, 'url'));
  }
};

const collectImports = (references: ResourceReference[], imports: unknown): void => {
  if (!Array.isArray(imports)) return;
  for (let index = 0; index < imports.length; index += 1) {
    const entry = ownDataValue(imports, index);
    if (isRecord(entry)) addString(references, `/imports/${index}/url`, ownDataValue(entry, 'url'));
  }
};

export function collectStyleResourceReferences(
  style: DeepReadonlyPrepared<StyleDocument>,
): ResourceReference[] {
  const references: ResourceReference[] = [];
  addString(references, '/glyphs', ownDataValue(style, 'glyphs'));
  collectSprite(references, ownDataValue(style, 'sprite'));
  collectImports(references, ownDataValue(style, 'imports'));
  const sources = ownDataValue(style, 'sources');
  if (isRecord(sources)) {
    for (const sourceId of Object.keys(sources)) {
      const source = ownDataValue(sources, sourceId);
      if (!isRecord(source)) continue;
      const base = `/sources/${escapeJsonPointer(sourceId)}`;
      addString(references, `${base}/url`, ownDataValue(source, 'url'));
      addStringArray(references, `${base}/tiles`, ownDataValue(source, 'tiles'));
      addStringArray(references, `${base}/urls`, ownDataValue(source, 'urls'));
      if (ownDataValue(source, 'type') === 'geojson') {
        addString(references, `${base}/data`, ownDataValue(source, 'data'));
      }
    }
  }
  return references.sort((left, right) => left.path.localeCompare(right.path));
}

const relativeStyleUrlDenied = (path: string) => createStyleToolError(
  'INVALID_INPUT',
  'Relative Style resources are not allowed.',
  path,
  { reason: 'relative-style-url' },
);

const resourceDenied = (path: string) => createStyleToolError(
  'CAPABILITY_DENIED',
  'Network resource is not allowed by bridge policy.',
  path,
);

const requireNetworkCapability = (
  capabilities: readonly BridgeCapability[],
  path: string,
): void => {
  if (!capabilities.includes('network.load')) throw resourceDenied(path);
};

const base64DecodedBytes = (payload: string): number => {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(payload)) {
    throw new TypeError('data URL contains invalid base64');
  }
  if (payload.length === 0) return 0;
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0;
  return (payload.length / 4) * 3 - padding;
};

const percentDecodedBytes = (payload: string): number => {
  let bytes = 0;
  let plain = '';
  const flushPlain = (): void => {
    if (plain !== '') {
      bytes += utf8ByteLength(plain);
      plain = '';
    }
  };
  for (let index = 0; index < payload.length;) {
    if (payload[index] === '%') {
      flushPlain();
      const hex = payload.slice(index + 1, index + 3);
      if (!/^[A-Fa-f0-9]{2}$/u.test(hex)) throw new TypeError('data URL contains invalid percent encoding');
      bytes += 1;
      index += 3;
      continue;
    }
    const codePoint = payload.codePointAt(index);
    if (codePoint === undefined) break;
    const character = String.fromCodePoint(codePoint);
    plain += character;
    index += character.length;
  }
  flushPlain();
  return bytes;
};

const assertDataUrlAllowed = (
  value: string,
  path: string,
  policy: NormalizedResourcePolicy,
): void => {
  if (!policy.allowDataUrls) throw resourceDenied(path);
  const comma = value.indexOf(',');
  if (comma < 5) throw new TypeError('data URL is malformed');
  const metadata = value.slice(5, comma);
  const payload = value.slice(comma + 1);
  const base64 = /(?:^|;)base64$/iu.test(metadata);
  const decodedBytes = base64 ? base64DecodedBytes(payload) : percentDecodedBytes(payload);
  if (decodedBytes > policy.maxDataUrlBytes) {
    throw new RangeError('data URL exceeds decoded byte limit');
  }
};

const pathPrefixMatches = (candidate: URL, prefixValue: string): boolean => {
  const prefix = new URL(prefixValue);
  if (candidate.origin !== prefix.origin) return false;
  const pathMatches = candidate.pathname === prefix.pathname
    || (prefix.pathname.endsWith('/')
      ? candidate.pathname.startsWith(prefix.pathname)
      : candidate.pathname.startsWith(`${prefix.pathname}/`));
  if (!pathMatches) return false;
  return prefix.search === '' || candidate.search.startsWith(prefix.search);
};

const assertAbsoluteResourceAllowed = (
  value: string,
  path: string,
  policy: NormalizedResourcePolicy,
): void => {
  const scheme = value.slice(0, value.indexOf(':')).toLowerCase();
  if (scheme === 'data') {
    assertDataUrlAllowed(value, path, policy);
    return;
  }
  if (FORBIDDEN_PROTOCOLS.has(scheme)) throw resourceDenied(path);
  const url = parseAbsoluteUrl(value, 'resource URL');
  assertNoCredentials(url, 'resource URL');
  if (scheme === 'http' || scheme === 'https') {
    if (policy.allowedResourceOrigins.includes(url.origin)
      || policy.allowedUrlPrefixes.some((prefix) => pathPrefixMatches(url, prefix))) {
      return;
    }
    throw resourceDenied(path);
  }
  if (!policy.allowedProtocols.includes(scheme)
    || policy.isProtocolRegistered?.(scheme) !== true) {
    throw resourceDenied(path);
  }
};

export function assertStyleResourcePolicy(input: StyleResourcePolicyInput): void {
  const policy = normalizeResourcePolicy(input.policy);
  const retained = new Set(collectStyleResourceReferences(input.baseline)
    .map((reference) => `${reference.path}\u0000${reference.value}`));
  for (const reference of collectStyleResourceReferences(input.candidate)) {
    if (retained.has(`${reference.path}\u0000${reference.value}`)) continue;
    if (!ABSOLUTE_RESOURCE_SCHEME.test(reference.value)) {
      throw relativeStyleUrlDenied(reference.path);
    }
    requireNetworkCapability(input.capabilities, reference.path);
    assertAbsoluteResourceAllowed(reference.value, reference.path, policy);
  }
}

export function assertRuntimeImageResourcePolicy(
  input: RuntimeImageResourcePolicyInput,
): { resolvedUrl: string } {
  const policy = normalizeResourcePolicy(input.policy);
  const path = `/runtime/images/${escapeJsonPointer(input.imageId)}/url`;
  let resolvedUrl: string;
  try {
    resolvedUrl = ABSOLUTE_RESOURCE_SCHEME.test(input.url)
      ? new URL(input.url).href
      : new URL(input.url, policy.baseUrl).href;
  } catch {
    throw createStyleToolError('INVALID_INPUT', 'Runtime image URL is invalid.', path);
  }
  requireNetworkCapability(input.capabilities, path);
  assertAbsoluteResourceAllowed(resolvedUrl, path, policy);
  return { resolvedUrl };
}

export function assertStyleDocumentUrlPolicy(
  input: StyleDocumentUrlPolicyInput,
): { resolvedUrl: string } {
  const policy = normalizeResourcePolicy(input.policy);
  const path = '/source/url';
  let resolvedUrl: string;
  try {
    resolvedUrl = ABSOLUTE_RESOURCE_SCHEME.test(input.url)
      ? new URL(input.url).href
      : new URL(input.url, policy.baseUrl).href;
  } catch {
    throw createStyleToolError('INVALID_INPUT', 'Style document URL is invalid.', path);
  }
  requireNetworkCapability(input.capabilities, path);
  assertAbsoluteResourceAllowed(resolvedUrl, path, policy);
  return { resolvedUrl };
}

export function redactResourceUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return '[redacted]';
  }
  if (url.host !== '') return `${url.protocol}//${url.host}${url.pathname}`;
  return `${url.protocol}[redacted]`;
}
