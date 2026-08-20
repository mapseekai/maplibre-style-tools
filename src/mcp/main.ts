#!/usr/bin/env node
/// <reference types="node" preserve="true" />

import { resolve } from 'node:path';
import process from 'node:process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createBridgeServer, type BridgeServerHandle } from '../bridge/server.js';
import {
  formatBridgeConnectionInfo,
  parseBridgeOptions,
  type ParsedBridgeOptions,
} from './bridge-options.js';
import {
  startStreamableHttpMcp,
  type StartedHttpMcp,
  type StartStreamableHttpMcpOptions,
} from './http.js';
import { createLiveMapMcpExtension } from './live-extension.js';
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
  MCP_CAPABILITY_TOOL_NAMES,
  createMcpToolHandlers,
  openStyleSessionInputSchema,
  closeStyleSessionInputSchema,
  exportStyleSessionInputSchema,
} from './tool-handlers.js';
export type { McpCapabilityToolName, McpToolHandlers } from './tool-handlers.js';
export { SessionStyleAuthority } from './session-authority.js';
export { BridgeMapAuthority } from './bridge-authority.js';
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
export { createLiveMapMcpExtension } from './live-extension.js';
export {
  buildLiveMapMetadataUri,
  buildLiveMapStyleUri,
  liveMapResourceUriAdmission,
} from './live-resources.js';
export { createBridgeServer as createMapLibreStyleBridgeServer } from '../bridge/server.js';
export { LiveMapRegistry } from '../bridge/registry.js';
export type { BridgeServerHandle, BridgeServerOptions } from '../bridge/server.js';
export type { LiveMapMetadata } from '../bridge/registry.js';
export { createMcpServerExtension } from './server-extension.js';
export type {
  McpServerExtension,
  McpServerExtensionContext,
  McpServerExtensionDependencies,
} from './server-extension.js';
export { runStdioMcp } from './stdio.js';
export type { RunStdioMcpOptions, StartedStdioMcp } from './stdio.js';

type ParsedHttpOptions = Omit<StartStreamableHttpMcpOptions, 'extensions'>;

export type ParsedMcpProcessOptions =
  | {
    readonly mcpTransport: 'stdio';
    readonly bridge: ParsedBridgeOptions;
  }
  | {
    readonly mcpTransport: 'http';
    readonly bridge: ParsedBridgeOptions;
    readonly http: ParsedHttpOptions;
  };

const invalidArguments = (): never => {
  throw new TypeError('invalid arguments');
};

export const parseMcpProcessOptions = (
  args: readonly string[],
): ParsedMcpProcessOptions => {
  let mcpTransport: 'stdio' | 'http' | undefined;
  let bearerToken: string | undefined;
  let host: string | undefined;
  let port: number | undefined;
  let allowNonLoopback = false;
  const allowedOrigins: string[] = [];
  const bridgeArgs: string[] = [];
  let sawHttpOption = false;

  for (let index = 0; index < args.length; index += 1) {
    const name = args[index];
    if (name === '--stdio' || name === '--http') {
      if (mcpTransport !== undefined) invalidArguments();
      mcpTransport = name === '--stdio' ? 'stdio' : 'http';
      continue;
    }
    if (name === '--bridge-host'
      || name === '--bridge-port'
      || name === '--bridge-token'
      || name === '--bridge-origin') {
      const value = args[index + 1];
      if (value === undefined) invalidArguments();
      bridgeArgs.push(name, value);
      index += 1;
      continue;
    }
    if (name === '--allow-non-loopback') {
      sawHttpOption = true;
      if (allowNonLoopback) invalidArguments();
      allowNonLoopback = true;
      continue;
    }
    const value = args[index + 1];
    if (value === undefined) invalidArguments();
    index += 1;
    sawHttpOption = true;
    if (name === '--bearer-token' && bearerToken === undefined && value.length > 0) {
      bearerToken = value;
    } else if (name === '--host' && host === undefined && value.length > 0) host = value;
    else if (name === '--port' && port === undefined && /^(?:0|[1-9][0-9]{0,4})$/u.test(value)) {
      port = Number(value);
    } else if (name === '--allowed-origin') allowedOrigins.push(value);
    else invalidArguments();
  }

  const bridge = parseBridgeOptions(bridgeArgs);
  const resolvedTransport = mcpTransport ?? 'stdio';
  if (resolvedTransport === 'stdio') {
    if (sawHttpOption) invalidArguments();
    return { mcpTransport: 'stdio', bridge };
  }
  const requiredBearerToken = bearerToken ?? invalidArguments();
  if (port !== undefined && port > 65_535) invalidArguments();
  const http: ParsedHttpOptions = {
    bearerToken: requiredBearerToken,
    ...(host === undefined ? {} : { host }),
    ...(port === undefined ? {} : { port }),
    ...(allowNonLoopback ? { allowNonLoopback: true } : {}),
    ...(allowedOrigins.length === 0 ? {} : { allowedOrigins }),
  };
  return { mcpTransport: 'http', bridge, http };
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
      'Usage: maplibre-style-mcp [--stdio | --http --bearer-token TOKEN [--host HOST] [--port PORT] [--allow-non-loopback] [--allowed-origin ORIGIN]] --bridge-origin ORIGIN [--bridge-host HOST] [--bridge-port PORT] [--bridge-token TOKEN]',
    );
    return 0;
  }
  let parsed: ParsedMcpProcessOptions;
  try {
    parsed = parseMcpProcessOptions(args);
  } catch {
    await writeMcpStderrLine(process.stderr, 'maplibre-style-mcp: invalid arguments');
    return 1;
  }
  let bridge: BridgeServerHandle | undefined;
  let started: Awaited<ReturnType<typeof runStdioMcp>> | StartedHttpMcp | undefined;
  try {
    bridge = await createBridgeServer(parsed.bridge);
    const extension = createLiveMapMcpExtension(bridge.registry);
    if (parsed.mcpTransport === 'http') {
      started = await startStreamableHttpMcp({
        ...parsed.http,
        extensions: [extension],
      });
      await writeMcpStderrLine(
        process.stderr,
        formatBridgeConnectionInfo(
          bridge,
          parsed.bridge.allowedOrigins,
          { mcpTransport: 'http', mcpUrl: started.url },
        ),
      );
      await waitForShutdownSignal();
    } else {
      const stdio = await runStdioMcp({
        startupDiagnosticLine: null,
        serverOptions: { extensions: [extension] },
      });
      started = stdio;
      await writeMcpStderrLine(
        process.stderr,
        formatBridgeConnectionInfo(
          bridge,
          parsed.bridge.allowedOrigins,
          { mcpTransport: 'stdio' },
        ),
      );
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
    await started?.close().catch(() => undefined);
    await bridge?.close().catch(() => undefined);
  }
};

const isDirectExecution = (directPath: string | undefined): boolean => {
  if (directPath === undefined) return false;
  try {
    return realpathSync(resolve(directPath))
      === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
};

if (isDirectExecution(process.argv[1])) {
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
