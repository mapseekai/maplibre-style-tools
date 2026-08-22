#!/usr/bin/env node
/// <reference types="node" preserve="true" />

import { resolve } from 'node:path';
import process from 'node:process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createBridgeServer, type BridgeServerHandle } from '../bridge/server.js';
import {
  formatBridgeConnectionInfo,
} from './bridge-options.js';
import {
  startStreamableHttpMcp,
  type StartedHttpMcp,
} from './http.js';
import {
  parseMcpProcessOptions,
  type ParsedMcpProcessOptions,
} from './index.js';
import { createLiveMapMcpExtension } from './live-extension.js';
import { runStdioMcp, writeMcpStderrLine } from './stdio.js';

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
