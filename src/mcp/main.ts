#!/usr/bin/env node
/// <reference types="node" preserve="true" />

import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  startStreamableHttpMcp,
  type StartedHttpMcp,
  type StartStreamableHttpMcpOptions,
} from './http.js';
import { runStdioMcp, writeMcpStderrLine } from './stdio.js';

export { MCP_SERVER_VERSION } from './version.generated.js';
export {
  MAX_CONFIGURABLE_MCP_MESSAGE_BYTES,
  MAX_MCP_MESSAGE_BYTES,
  MAX_MCP_METHOD_BYTES,
  MAX_MCP_REQUEST_ID_BYTES,
  MAX_MCP_RESOURCE_URI_BYTES,
  MAX_STYLE_SESSION_ID_BYTES,
  MCP_RESPONSE_ENVELOPE_RESERVE_BYTES,
  MIN_MCP_MESSAGE_BYTES,
} from './types.js';
export type {
  ApplySessionTransactionResult,
  ApplyStyleSessionRequest,
  Clock,
  CloseStyleSessionResult,
  ExportStyleSessionResult,
  McpJsonValue,
  McpMessagePolicy,
  McpResourceContent,
  McpResourceResult,
  McpTextToolResult,
  McpToolEnvelope,
  McpToolMeta,
  ResourceUriAdmission,
  RevisionSnapshot,
  SessionRevisionMetadata,
  SessionSnapshot,
  OpenStyleSessionResult,
  StyleSessionLimits,
  StyleSessionStoreOptions,
  StyleInspectResult,
} from './types.js';
export {
  createMcpToolEnvelopeSchema,
  mcpToolEnvelopeSchema,
  parseMcpToolEnvelope,
  parseOfficialCallToolResult,
  parseStyleToolErrorShape,
  styleToolErrorWireSchema,
  toolFailure,
  toolSuccess,
} from './output.js';
export { resolveMcpMessagePolicy } from './message-boundary.js';
export {
  DEFAULT_STYLE_SESSION_LIMITS,
  createStyleSessionStore,
} from './session-store.js';
export type { StyleSessionStore } from './session-store.js';
export {
  DOCUMENT_TOOL_NAMES,
  documentToolInputSchemas,
  documentToolResponseDataSchemas,
  parseDocumentToolSuccessData,
  styleAnalyzeGeoJsonDataSchema,
  styleAnalyzeGeoJsonInputSchema,
  styleApplyTransactionDataSchema,
  styleApplyTransactionInputSchema,
  styleExportDataSchema,
  styleExportInputSchema,
  styleInspectDataSchema,
  styleInspectInputSchema,
  styleSearchLayersDataSchema,
  styleSearchLayersInputSchema,
  styleSessionCloseDataSchema,
  styleSessionCloseInputSchema,
  styleSessionOpenDataSchema,
  styleSessionOpenInputSchema,
  styleValidateDataSchema,
  styleValidateInputSchema,
} from './schemas.js';
export type { DocumentToolName } from './schemas.js';
export { createDocumentToolHandlers } from './document-handlers.js';
export type { DocumentToolHandlers } from './document-handlers.js';
export {
  createResourceResolver,
  documentResourceUriAdmission,
  makeContextUri,
  makeDiffUri,
  makeLayerUri,
  makeSessionUri,
  makeSourceUri,
  makeStyleUri,
  parseContextUri,
  parseDiffUri,
  parseLayerUri,
  parseSessionUri,
  parseSourceUri,
  parseStyleUri,
  styleResourceTemplates,
} from './resources.js';
export {
  createMapLibreStyleMcpServer,
} from './create-server.js';
export type {
  CreatedMapLibreStyleMcpServer,
  CreateMapLibreStyleMcpServerOptions,
} from './create-server.js';
export { createMcpServerExtension } from './server-extension.js';
export type {
  McpServerExtension,
  McpServerExtensionContext,
  McpServerExtensionDependencies,
} from './server-extension.js';
export { runStdioMcp } from './stdio.js';
export type { RunStdioMcpOptions, StartedStdioMcp } from './stdio.js';

const parseHttpOptions = (
  args: readonly string[],
): StartStreamableHttpMcpOptions | undefined => {
  if (args[0] !== '--http') return undefined;
  let bearerToken: string | undefined;
  let host: string | undefined;
  let port: number | undefined;
  let allowNonLoopback = false;
  const allowedOrigins: string[] = [];
  for (let index = 1; index < args.length; index += 1) {
    const name = args[index];
    if (name === '--allow-non-loopback') {
      if (allowNonLoopback) return undefined;
      allowNonLoopback = true;
      continue;
    }
    const value = args[index + 1];
    if (value === undefined) return undefined;
    index += 1;
    if (name === '--bearer-token' && bearerToken === undefined) bearerToken = value;
    else if (name === '--host' && host === undefined) host = value;
    else if (name === '--port' && port === undefined && /^(?:0|[1-9][0-9]{0,4})$/u.test(value)) {
      port = Number(value);
    } else if (name === '--allowed-origin') allowedOrigins.push(value);
    else return undefined;
  }
  if (bearerToken === undefined) return undefined;
  return {
    bearerToken,
    ...(host === undefined ? {} : { host }),
    ...(port === undefined ? {} : { port }),
    ...(allowNonLoopback ? { allowNonLoopback: true } : {}),
    ...(allowedOrigins.length === 0 ? {} : { allowedOrigins }),
  };
};

const waitForShutdownSignal = (): Promise<void> => new Promise((resolveSignal) => {
  const done = (): void => {
    process.removeListener('SIGINT', done);
    process.removeListener('SIGTERM', done);
    resolveSignal();
  };
  process.once('SIGINT', done);
  process.once('SIGTERM', done);
});

const runExecutable = async (args: readonly string[]): Promise<number> => {
  if (args.includes('--help')) {
    await writeMcpStderrLine(
      process.stderr,
      'Usage: maplibre-style-mcp [--stdio] | --http --bearer-token TOKEN [--host HOST] [--port PORT] [--allow-non-loopback] [--allowed-origin ORIGIN]',
    );
    return 0;
  }
  const httpOptions = parseHttpOptions(args);
  if (args.includes('--http') && httpOptions === undefined) {
    await writeMcpStderrLine(process.stderr, 'maplibre-style-mcp: invalid arguments');
    return 1;
  }
  if (httpOptions === undefined && args.some((arg) => arg !== '--stdio')) {
    await writeMcpStderrLine(process.stderr, 'maplibre-style-mcp: invalid arguments');
    return 1;
  }
  let started: Awaited<ReturnType<typeof runStdioMcp>> | StartedHttpMcp | undefined;
  try {
    if (httpOptions !== undefined) {
      started = await startStreamableHttpMcp(httpOptions);
      await writeMcpStderrLine(
        process.stderr,
        `maplibre-style-mcp: listening ${started.url}`,
      );
      await waitForShutdownSignal();
    } else {
      const stdio = await runStdioMcp();
      started = stdio;
      await stdio.closed;
    }
    return 0;
  } catch {
    try {
      await writeMcpStderrLine(process.stderr, 'maplibre-style-mcp: failed');
    } catch {
      // stderr failure cannot be reported recursively.
    }
    return 1;
  } finally {
    await started?.close();
  }
};

const directPath = process.argv[1];
if (directPath !== undefined && resolve(directPath) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runExecutable(process.argv.slice(2));
}
export type {
  McpResourceResolver,
  ParsedContextUri,
  ParsedDiffUri,
  ParsedLayerUri,
  ParsedSessionUri,
  ParsedSourceUri,
  ParsedStyleUri,
} from './resources.js';
export {
  MAX_HTTP_BEARER_TOKEN_BYTES,
  startStreamableHttpMcp,
} from './http.js';
export type {
  StartedHttpMcp,
  StartStreamableHttpMcpOptions,
} from './http.js';
