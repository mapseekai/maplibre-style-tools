import { EventEmitter } from 'node:events';
import process from 'node:process';
import {
  Transform,
  type Readable,
  type Writable,
} from 'node:stream';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createStyleToolError } from '../core/index.js';
import {
  createMapLibreStyleMcpServerWithDependencies,
  defaultServerCompositionDependencies,
  type CreatedMapLibreStyleMcpServer,
  type CreateMapLibreStyleMcpServerOptions,
} from './create-server.js';
import {
  assertInboundMcpFraming,
  createInboundMcpFramingContext,
} from './message-boundary.js';
import type { McpMessagePolicy } from './types.js';

type RawStdioTransport = StdioServerTransport;
type TerminalHandler = (error: unknown) => void | Promise<void>;

const stdioFailure = (
  message: string,
  reason: string,
) => createStyleToolError('INVALID_INPUT', message, undefined, { reason });

const consumeTerminal = (handler: TerminalHandler, error: unknown): void => {
  try {
    void Promise.resolve(handler(error)).catch(() => undefined);
  } catch {
    // The lifecycle owns terminal reporting and cleanup.
  }
};

export interface BoundedNdjsonInput {
  readonly stream: Readable;
  dispose(): void;
}

export const createBoundedNdjsonInput = (
  source: Readable,
  messagePolicy: McpMessagePolicy,
  onTerminal: TerminalHandler,
): BoundedNdjsonInput => {
  const preflightContext = createInboundMcpFramingContext({
    totalBytesAlreadyBounded: true,
  });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pending: Buffer[] = [];
  let pendingBytes = 0;
  let terminal = false;
  let disposed = false;

  const signal = (error: unknown): void => {
    if (terminal) return;
    terminal = true;
    consumeTerminal(onTerminal, error);
  };

  const fail = (reason: string, message: string): void => {
    signal(stdioFailure(message, reason));
  };

  const accept = (stream: Transform, segment: Buffer): void => {
    if (terminal) return;
    const totalBytes = pendingBytes + segment.length;
    if (totalBytes > messagePolicy.maxMessageBytes) {
      fail('messageTooLarge', 'The MCP stdio message exceeds the configured byte limit.');
      return;
    }
    const payload = pending.length === 0
      ? Buffer.from(segment)
      : Buffer.concat([...pending, segment], totalBytes);
    pending = [];
    pendingBytes = 0;
    if (payload.length === 0) {
      fail('invalidStdioFrame', 'The MCP stdio frame is empty.');
      return;
    }
    try {
      const text = decoder.decode(payload);
      const parsed: unknown = JSON.parse(text);
      assertInboundMcpFraming(parsed, messagePolicy, preflightContext);
    } catch {
      fail('invalidStdioFrame', 'The MCP stdio frame is invalid.');
      return;
    }
    stream.push(Buffer.concat([payload, Buffer.from('\n')], payload.length + 1));
  };

  const stream = new Transform({
    transform(chunk: Buffer | string, encoding, callback) {
      if (terminal) {
        callback();
        return;
      }
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
      let cursor = 0;
      while (!terminal) {
        const newline = bytes.indexOf(0x0a, cursor);
        if (newline < 0) break;
        accept(this, bytes.subarray(cursor, newline));
        cursor = newline + 1;
      }
      if (!terminal && cursor < bytes.length) {
        const suffix = bytes.subarray(cursor);
        if (pendingBytes + suffix.length > messagePolicy.maxMessageBytes) {
          fail('messageTooLarge', 'The MCP stdio message exceeds the configured byte limit.');
        } else {
          pending.push(Buffer.from(suffix));
          pendingBytes += suffix.length;
        }
      }
      callback();
    },
    flush(callback) {
      if (!terminal) {
        if (pendingBytes > 0) {
          fail('unterminatedStdioFrame', 'The MCP stdio input ended with an unterminated frame.');
        } else {
          signal(stdioFailure('The MCP stdio input ended.', 'stdioEof'));
        }
      }
      callback();
    },
  });

  const onSourceError = (error: Error): void => { signal(error); };
  source.on('error', onSourceError);
  source.pipe(stream);

  return Object.freeze({
    stream,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      pending = [];
      pendingBytes = 0;
      source.unpipe(stream);
      source.off('error', onSourceError);
      stream.destroy();
    },
  });
};

export interface GuardedStdioOutput {
  readonly stream: Writable;
  dispose(): void;
}

class GuardedOutputFacade extends EventEmitter {
  constructor(private readonly writeChunk: (
    chunk: string | Uint8Array,
    encoding: BufferEncoding | undefined,
    callback: (error?: Error | null) => void,
  ) => boolean) {
    super();
  }

  write(
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
    maybeCallback?: (error?: Error | null) => void,
  ): boolean {
    const encoding = typeof encodingOrCallback === 'string' ? encodingOrCallback : undefined;
    const callback = typeof encodingOrCallback === 'function'
      ? encodingOrCallback
      : maybeCallback;
    return this.writeChunk(chunk, encoding, (error) => { callback?.(error); });
  }
}

export const createGuardedStdioOutput = (
  output: Writable,
  onTerminal: TerminalHandler,
): GuardedStdioOutput => {
  let disposed = false;
  let terminal = false;
  let waitingForDrain = false;

  const facade = new GuardedOutputFacade((chunk, encoding, callback) => {
    if (terminal || disposed) {
      const error = Object.assign(new Error('MCP stdio output is closed.'), { code: 'EPIPE' });
      callback(error);
      return false;
    }
    const completed = (error?: Error | null): void => {
      callback(error);
      if (error) signal(error);
    };
    try {
      const writable = encoding === undefined
        ? output.write(chunk, completed)
        : output.write(chunk, encoding, completed);
      waitingForDrain = !writable;
      return writable;
    } catch (error: unknown) {
      const normalized = error instanceof Error ? error : new Error('MCP stdio output failed.');
      completed(normalized);
      return false;
    }
  });

  const settleBackpressure = (): void => {
    if (!waitingForDrain) return;
    waitingForDrain = false;
    facade.emit('drain');
  };

  const signal = (error: unknown): void => {
    if (terminal) return;
    terminal = true;
    consumeTerminal(onTerminal, error);
    queueMicrotask(settleBackpressure);
  };

  const onDrain = (): void => {
    waitingForDrain = false;
    facade.emit('drain');
  };
  const onError = (error: Error): void => { signal(error); };
  const onClose = (): void => {
    signal(Object.assign(new Error('MCP stdio output closed.'), { code: 'EPIPE' }));
  };
  output.on('drain', onDrain);
  output.on('error', onError);
  output.on('close', onClose);

  return Object.freeze({
    stream: facade as unknown as Writable,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      output.off('drain', onDrain);
      output.off('error', onError);
      output.off('close', onClose);
      settleBackpressure();
      facade.removeAllListeners();
    },
  });
};

export const writeMcpStderrLine = async (
  stderr: Writable,
  line: string,
): Promise<void> => {
  if (line.includes('\n') || line.includes('\r')) {
    throw stdioFailure('MCP diagnostic lines cannot contain line breaks.', 'invalidDiagnosticLine');
  }
  if (stderr.destroyed || stderr.writableEnded || stderr.writableFinished) {
    throw Object.assign(new Error('MCP stderr is closed.'), { code: 'EPIPE' });
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error | null): void => {
      if (settled) return;
      settled = true;
      queueMicrotask(() => {
        stderr.off('error', onError);
        if (error) reject(error);
        else resolve();
      });
    };
    const onError = (error: Error): void => { finish(error); };
    stderr.on('error', onError);
    try {
      stderr.write(`${line}\n`, (error) => { finish(error); });
    } catch (error: unknown) {
      finish(error instanceof Error ? error : new Error('MCP stderr write failed.'));
    }
  });
};

export interface RunStdioMcpOptions {
  readonly serverOptions?: CreateMapLibreStyleMcpServerOptions;
  readonly startupDiagnosticLine?: string | null;
}

export interface StartedStdioMcp {
  readonly messagePolicy: McpMessagePolicy;
  readonly closed: Promise<void>;
  close(): Promise<void>;
}

export interface StdioDependencies {
  readonly stdin: Readable;
  readonly stdout: Writable;
  readonly stderr: Writable;
  readonly serverFactory: (
    options: CreateMapLibreStyleMcpServerOptions,
  ) => CreatedMapLibreStyleMcpServer;
  readonly transportFactory: (
    input: Readable,
    output: Writable,
    maxBufferSize: number,
  ) => RawStdioTransport;
}

const defaultStdioDependencies: StdioDependencies = Object.freeze({
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  serverFactory: (options: CreateMapLibreStyleMcpServerOptions) =>
    createMapLibreStyleMcpServerWithDependencies(
    options,
    defaultServerCompositionDependencies,
    undefined,
    'transport-prebounded',
  ),
  transportFactory: (input: Readable, output: Writable, maxBufferSize: number) =>
    new StdioServerTransport(
    input,
    output,
    { maxBufferSize },
  ),
});

export const runStdioMcp = async (
  options: RunStdioMcpOptions = {},
  dependencyOverrides: Partial<StdioDependencies> = {},
): Promise<StartedStdioMcp> => {
  const dependencies: StdioDependencies = {
    ...defaultStdioDependencies,
    ...dependencyOverrides,
  };
  const created = dependencies.serverFactory(options.serverOptions ?? {});
  let input: BoundedNdjsonInput | undefined;
  let output: GuardedStdioOutput | undefined;
  let rawTransport: RawStdioTransport | undefined;
  let transferred = false;
  let state: 'starting' | 'started' | 'closing' | 'closed' = 'starting';
  let terminalError: unknown;
  let cleanupPromise: Promise<void> | undefined;
  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => { resolveClosed = resolve; });
  let resolveTerminal!: (error: unknown) => void;
  const terminalSignal = new Promise<unknown>((resolve) => { resolveTerminal = resolve; });

  const removeSignals = (): void => {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  };

  const cleanup = (): Promise<void> => {
    if (cleanupPromise !== undefined) return cleanupPromise;
    state = 'closing';
    cleanupPromise = (async () => {
      removeSignals();
      if (transferred) {
        await Promise.allSettled([created.close()]);
      } else {
        await Promise.allSettled([
          ...(rawTransport === undefined ? [] : [rawTransport.close()]),
          created.close(),
        ]);
      }
      input?.dispose();
      output?.dispose();
      state = 'closed';
      resolveClosed();
    })();
    return cleanupPromise;
  };

  const requestTerminal = (error: unknown): Promise<void> => {
    if (terminalError === undefined) {
      terminalError = error;
      resolveTerminal(error);
    }
    return cleanup();
  };

  function onSignal(): void {
    void requestTerminal(stdioFailure('The MCP stdio server was interrupted.', 'stdioSignal'));
  }

  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  try {
    input = createBoundedNdjsonInput(
      dependencies.stdin,
      created.messagePolicy,
      requestTerminal,
    );
    output = createGuardedStdioOutput(dependencies.stdout, requestTerminal);
    rawTransport = dependencies.transportFactory(
      input.stream,
      output.stream,
      created.messagePolicy.maxMessageBytes + 1,
    );
    rawTransport.onerror = (error) => { void requestTerminal(error); };
    rawTransport.onclose = () => {
      void requestTerminal(stdioFailure('The MCP stdio transport closed.', 'stdioTransportClosed'));
    };
    transferred = true;
    const startupWork = (async () => {
      await created.connect(rawTransport!, requestTerminal);
      const diagnostic = options.startupDiagnosticLine === undefined
        ? 'maplibre-style-mcp: stdio transport ready'
        : options.startupDiagnosticLine;
      if (diagnostic !== null) await writeMcpStderrLine(dependencies.stderr, diagnostic);
    })();
    const outcome = await Promise.race([
      startupWork.then(
        () => ({ kind: 'started' as const }),
        (error: unknown) => ({ kind: 'failed' as const, error }),
      ),
      terminalSignal.then((error) => ({ kind: 'terminal' as const, error })),
    ]);
    if (outcome.kind !== 'started' || terminalError !== undefined || state !== 'starting') {
      const primary = outcome.kind === 'started' ? terminalError : outcome.error;
      await requestTerminal(primary);
      await startupWork.catch(() => undefined);
      throw primary;
    }
    state = 'started';
    const started: StartedStdioMcp = Object.freeze({
      messagePolicy: created.messagePolicy,
      closed,
      close: () => requestTerminal(
        stdioFailure('The MCP stdio server was closed.', 'stdioExplicitClose'),
      ),
    });
    return started;
  } catch (error: unknown) {
    await requestTerminal(error);
    throw error;
  }
};
