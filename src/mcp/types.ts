import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import type { CapabilityResult } from '../capabilities/contracts.js';
import type {
  JsonValue,
  StyleDiffEntry,
  StyleDocument,
  StyleContext,
  StyleLayer,
  StyleSource,
  SourceLayerUsage,
  StyleWarning,
} from '../core/types.js';

export const MAX_MCP_MESSAGE_BYTES = 5 * 1024 * 1024;
export const MIN_MCP_MESSAGE_BYTES = 128 * 1024;
export const MAX_CONFIGURABLE_MCP_MESSAGE_BYTES = 64 * 1024 * 1024;
export const MCP_RESPONSE_ENVELOPE_RESERVE_BYTES = 64 * 1024;
export const MAX_MCP_REQUEST_ID_BYTES = 256;
export const MAX_MCP_METHOD_BYTES = 128;
export const MAX_MCP_RESOURCE_URI_BYTES = 8 * 1024;
export const MAX_STYLE_SESSION_ID_BYTES = 512;

export type McpJsonValue = JsonValue;

export type McpToolEnvelope<T = JsonValue> = CapabilityResult<T>;

export type McpTextToolResult<T = JsonValue> = Omit<
  CallToolResult,
  'content' | 'structuredContent'
> & {
  content: [{ type: 'text'; text: string }];
  structuredContent: McpToolEnvelope<T>;
};

export interface McpMessagePolicy {
  readonly maxMessageBytes: number;
  readonly applicationResultBytes: number;
}

export interface ResourceUriAdmission {
  readonly scheme: string;
  readonly authority: string;
  assertCanonical(rawUri: string): void;
}

export interface McpResourceContent {
  readonly uri: string;
  readonly mimeType: 'application/json';
  readonly text: string;
}

export interface McpResourceResult {
  readonly contents: McpResourceContent[];
}

export interface Clock {
  now(): number;
}

export interface StyleSessionLimits {
  readonly maxSessions: number;
  readonly maxStyleBytes: number;
  readonly maxOperations: number;
  readonly maxHistory: number;
  readonly maxDiffBytes: number;
  readonly ttlMs: number;
}

export interface StyleSessionStoreOptions {
  readonly clock?: Clock;
  readonly idFactory?: () => string;
  readonly limits?: Partial<StyleSessionLimits>;
}

export interface SessionRevisionMetadata {
  readonly revision: number;
  readonly committedAt: number;
}

export interface RevisionSnapshot {
  readonly revision: number;
  readonly style: StyleDocument;
  readonly incomingDiff: readonly StyleDiffEntry[];
  readonly committedAt: number;
}

export interface SessionSnapshot {
  readonly sessionId: string;
  readonly revision: number;
  readonly style: StyleDocument;
  readonly history: readonly SessionRevisionMetadata[];
  readonly lastAccessedAt: number;
  readonly expiresAt: number;
}

export interface OpenStyleSessionResult {
  readonly sessionId: string;
  readonly revision: number;
  readonly expiresAt: number;
}

export interface CloseStyleSessionResult {
  readonly sessionId: string;
  readonly closed: true;
}

export interface ExportStyleSessionResult {
  readonly sessionId: string;
  readonly revision: number;
  readonly style: StyleDocument;
}

export interface ApplyStyleSessionRequest {
  readonly expectedRevision: number;
  readonly transaction: unknown;
  readonly dryRun?: boolean;
}

export interface ApplySessionTransactionResult {
  readonly revision: number;
  readonly dryRun: boolean;
  readonly style: StyleDocument;
  readonly diff: readonly StyleDiffEntry[];
  readonly changedLayers: readonly string[];
  readonly changedSources: readonly string[];
  readonly warnings: readonly StyleWarning[];
}

export type StyleInspectResult =
  | {
      readonly view: 'context';
      readonly sessionId: string;
      readonly revision: number;
      readonly context: StyleContext;
    }
  | {
      readonly view: 'layer';
      readonly sessionId: string;
      readonly revision: number;
      readonly layer: StyleLayer;
    }
  | {
      readonly view: 'source';
      readonly sessionId: string;
      readonly revision: number;
      readonly source: StyleSource;
    }
  | {
      readonly view: 'sourceLayers';
      readonly sessionId: string;
      readonly revision: number;
      readonly sourceLayers: SourceLayerUsage[];
    };
