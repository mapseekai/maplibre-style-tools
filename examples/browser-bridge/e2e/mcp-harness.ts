import {
  expect,
  test as base,
  type Page,
} from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { spawn, type ChildProcess } from 'node:child_process';
import { constants } from 'node:fs';
import { access, chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import {
  parseMcpToolEnvelope,
} from 'maplibre-style-tools/mcp';
import { z } from 'zod';

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const mcpMain = path.join(repoRoot, 'dist/mcp/main.js');
const bridgeOrigin = 'http://127.0.0.1:4173';
const startupTimeoutMs = 10_000;
const httpBearerToken = 'h'.repeat(32);

const canonicalLoopbackUrl = (
  protocols: readonly string[],
  requiredPath?: string,
  requireCanonical = false,
) => z.string().refine((value) => {
  try {
    const parsed = new URL(value);
    return protocols.includes(parsed.protocol)
      && parsed.hostname === '127.0.0.1'
      && parsed.port !== ''
      && parsed.username === ''
      && parsed.password === ''
      && parsed.search === ''
      && parsed.hash === ''
      && (requiredPath === undefined || parsed.pathname === requiredPath)
      && (!requireCanonical || parsed.href === value);
  } catch {
    return false;
  }
}, 'Expected a canonical loopback URL.');

const sharedHandoffShape = {
  event: z.literal('bridge_listening'),
  wsUrl: canonicalLoopbackUrl(['ws:', 'wss:']),
  allowedOrigins: z.array(z.string()),
  token: z.string().min(32).optional(),
};

export const BridgeStartupHandoffSchema = z.discriminatedUnion('mcpTransport', [
  z.strictObject({
    ...sharedHandoffShape,
    mcpTransport: z.literal('stdio'),
  }),
  z.strictObject({
    ...sharedHandoffShape,
    mcpTransport: z.literal('http'),
    mcpUrl: canonicalLoopbackUrl(['http:'], '/mcp', true),
  }),
]);

export type BridgeStartupHandoff = z.infer<typeof BridgeStartupHandoffSchema>;

export const parseHarnessCallResult = (value: unknown) => {
  const official = CallToolResultSchema.parse(value);
  return parseMcpToolEnvelope(official.structuredContent);
};

const delay = (milliseconds: number): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, milliseconds);
});

const withTimeout = async <T>(
  promise: Promise<T>,
  milliseconds: number,
  message: string,
): Promise<T> => await new Promise<T>((resolve, reject) => {
  const timer = setTimeout(() => { reject(new Error(message)); }, milliseconds);
  void promise.then(
    (value) => { clearTimeout(timer); resolve(value); },
    (error: unknown) => { clearTimeout(timer); reject(error); },
  );
});

type HandoffListener = {
  promise: Promise<BridgeStartupHandoff>;
  cancel(error?: Error): void;
};

const listenForHandoff = (
  stream: Readable,
  expectedTransport: BridgeStartupHandoff['mcpTransport'],
  startupOrder?: string[],
): HandoffListener => {
  let pending = '';
  let settled = false;
  let resolvePromise!: (handoff: BridgeStartupHandoff) => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<BridgeStartupHandoff>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  const dispose = (): void => {
    stream.off('data', onData);
    stream.off('error', onError);
    stream.off('end', onEnd);
  };
  const settleError = (error: unknown): void => {
    if (settled) return;
    settled = true;
    dispose();
    rejectPromise(error);
  };
  const parseLine = (line: string): void => {
    if (settled || line.length === 0) return;
    try {
      const parsed = BridgeStartupHandoffSchema.parse(JSON.parse(line) as unknown);
      if (parsed.mcpTransport !== expectedTransport) {
        throw new Error('MCP startup handoff transport is invalid.');
      }
      settled = true;
      dispose();
      startupOrder?.push('bridge-line');
      resolvePromise(parsed);
    } catch (error) {
      settleError(error);
    }
  };
  const onData = (chunk: Buffer | string): void => {
    pending += chunk.toString();
    let newline = pending.indexOf('\n');
    while (newline >= 0 && !settled) {
      parseLine(pending.slice(0, newline).replace(/\r$/u, ''));
      pending = pending.slice(newline + 1);
      newline = pending.indexOf('\n');
    }
  };
  const onError = (error: Error): void => { settleError(error); };
  const onEnd = (): void => {
    if (pending.length > 0) parseLine(pending.replace(/\r$/u, ''));
    if (!settled) settleError(new Error('MCP process ended before startup handoff.'));
  };

  stream.on('data', onData);
  stream.on('error', onError);
  stream.on('end', onEnd);
  return {
    promise,
    cancel(error = new Error('MCP startup handoff cancelled.')) { settleError(error); },
  };
};

const childIsActive = (child: ChildProcess): boolean =>
  child.exitCode === null && child.signalCode === null;

const pidIsActive = (pid: number | null): boolean => {
  if (pid === null) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const waitForPidExit = async (pid: number): Promise<void> => {
  const deadline = Date.now() + 5_000;
  while (pidIsActive(pid) && Date.now() < deadline) await delay(20);
  if (!pidIsActive(pid)) return;
  try { process.kill(pid, 'SIGTERM'); } catch { return; }
  const terminateDeadline = Date.now() + 1_000;
  while (pidIsActive(pid) && Date.now() < terminateDeadline) await delay(20);
  if (!pidIsActive(pid)) return;
  try { process.kill(pid, 'SIGKILL'); } catch { return; }
  const killDeadline = Date.now() + 1_000;
  while (pidIsActive(pid) && Date.now() < killDeadline) await delay(20);
};

const stopChild = async (child: ChildProcess): Promise<void> => {
  if (!childIsActive(child)) return;
  const closed = new Promise<void>((resolve) => { child.once('close', () => resolve()); });
  child.kill('SIGTERM');
  await Promise.race([closed, delay(5_000)]);
  if (childIsActive(child)) {
    child.kill('SIGKILL');
    await Promise.race([closed, delay(1_000)]);
  }
};

type TrackedProcess = {
  active(): boolean;
  close(): Promise<void>;
};

class HarnessTracker {
  readonly #processes = new Set<TrackedProcess>();

  track(processRecord: TrackedProcess): TrackedProcess {
    this.#processes.add(processRecord);
    return processRecord;
  }

  forget(processRecord: TrackedProcess): void {
    this.#processes.delete(processRecord);
  }

  activeChildCount(): number {
    return [...this.#processes].filter((record) => record.active()).length;
  }

  async closeAll(): Promise<void> {
    await Promise.allSettled([...this.#processes].map(async (record) => {
      await record.close();
    }));
    this.#processes.clear();
  }
}

const requireHandoffToken = (handoff: BridgeStartupHandoff): string => {
  if (handoff.token === undefined) throw new Error('Bridge startup handoff omitted generated token.');
  return handoff.token;
};

export interface McpHarness {
  readonly handoff: Extract<BridgeStartupHandoff, { mcpTransport: 'stdio' }>;
  readonly connection: { readonly url: string; readonly token: string };
  readonly startupOrder: readonly string[];
  readonly manualStartCalls: 0;
  call(name: string, args: Record<string, unknown>): ReturnType<typeof parseHarnessCallResult> extends infer Result
    ? Promise<Result>
    : never;
  close(): Promise<void>;
}

export interface HttpMcpHarness {
  readonly handoff: Extract<BridgeStartupHandoff, { mcpTransport: 'http' }>;
  readonly connection: { readonly url: string; readonly token: string };
  readonly transportEndpoint: string;
  readonly usedHardCodedPortOrSideChannel: false;
  call(name: string, args: Record<string, unknown>): ReturnType<typeof parseHarnessCallResult> extends infer Result
    ? Promise<Result>
    : never;
  close(): Promise<void>;
}

export interface McpHarnessFactory {
  start(options?: { failAfterSpawnForTest?: boolean }): Promise<McpHarness>;
  activeChildCount(): number;
}

export interface TestMcpHarnessFactory extends McpHarnessFactory {
  startHttp(): Promise<HttpMcpHarness>;
  closeAll(): Promise<void>;
}

class McpHarnessFactoryImpl implements TestMcpHarnessFactory {
  readonly #tracker: HarnessTracker;

  constructor(tracker: HarnessTracker) {
    this.#tracker = tracker;
  }

  activeChildCount(): number {
    return this.#tracker.activeChildCount();
  }

  async start(options: { failAfterSpawnForTest?: boolean } = {}): Promise<McpHarness> {
    const startupOrder = ['stderr-listener'];
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        mcpMain,
        '--stdio',
        '--bridge-host', '127.0.0.1',
        '--bridge-port', '0',
        '--bridge-origin', bridgeOrigin,
      ],
      cwd: repoRoot,
      stderr: 'pipe',
    });
    const stderr = transport.stderr;
    if (stderr === null) throw new Error('MCP stdio transport did not expose stderr.');
    const handoffListener = listenForHandoff(
      stderr as Readable,
      'stdio',
      startupOrder,
    );
    void handoffListener.promise.catch(() => undefined);
    const client = new Client({ name: 'browser-bridge-e2e', version: '1.0.0' });
    let capturedPid: number | null = null;
    let closed = false;
    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      handoffListener.cancel();
      try { await client.close(); } catch { /* Partial startup may not be connected. */ }
      try { await transport.close(); } catch { /* Continue process cleanup. */ }
      if (capturedPid !== null) await waitForPidExit(capturedPid);
      this.#tracker.forget(record);
    };
    const record = this.#tracker.track({
      active: () => pidIsActive(transport.pid ?? capturedPid),
      close,
    });

    startupOrder.push('client.connect');
    const connectPromise = client.connect(transport).then(
      () => { startupOrder.push('connect-settlement'); },
      (error: unknown) => { startupOrder.push('connect-settlement'); throw error; },
    );
    void connectPromise.catch(() => undefined);
    try {
      capturedPid = await withTimeout((async () => {
        while (transport.pid === null) await delay(5);
        return transport.pid;
      })(), startupTimeoutMs, 'MCP stdio child did not spawn.');
      if (options.failAfterSpawnForTest === true) {
        throw new Error('injected setup failure after spawn');
      }
      const [, parsedHandoff] = await withTimeout(
        Promise.all([connectPromise, handoffListener.promise]),
        startupTimeoutMs,
        'MCP stdio startup timed out.',
      );
      if (parsedHandoff.mcpTransport !== 'stdio') {
        throw new Error('Expected stdio startup handoff.');
      }
      return {
        handoff: parsedHandoff,
        connection: {
          url: parsedHandoff.wsUrl,
          token: requireHandoffToken(parsedHandoff),
        },
        startupOrder: Object.freeze([...startupOrder]),
        manualStartCalls: 0,
        async call(name, args) {
          return parseHarnessCallResult(await client.callTool({ name, arguments: args }));
        },
        close,
      };
    } catch (error) {
      await close();
      await Promise.allSettled([connectPromise, handoffListener.promise]);
      throw error;
    }
  }

  async startHttp(): Promise<HttpMcpHarness> {
    const childEnvironment = { ...process.env };
    delete childEnvironment.NO_COLOR;
    delete childEnvironment.FORCE_COLOR;
    const child = spawn(process.execPath, [
      mcpMain,
      '--http',
      '--bearer-token', httpBearerToken,
      '--host', '127.0.0.1',
      '--port', '0',
      '--bridge-host', '127.0.0.1',
      '--bridge-port', '0',
      '--bridge-origin', bridgeOrigin,
    ], {
      cwd: repoRoot,
      env: childEnvironment,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (child.stderr === null) throw new Error('MCP HTTP process did not expose stderr.');
    const handoffListener = listenForHandoff(child.stderr, 'http');
    void handoffListener.promise.catch(() => undefined);
    let client: Client | undefined;
    let transport: StreamableHTTPClientTransport | undefined;
    let closed = false;
    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      handoffListener.cancel();
      try { await client?.close(); } catch { /* Continue process cleanup. */ }
      try { await transport?.close(); } catch { /* Continue process cleanup. */ }
      await stopChild(child);
      this.#tracker.forget(record);
    };
    const record = this.#tracker.track({ active: () => childIsActive(child), close });
    const spawned = new Promise<void>((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    void spawned.catch(() => undefined);
    try {
      const [, parsedHandoff] = await withTimeout(
        Promise.all([spawned, handoffListener.promise]),
        startupTimeoutMs,
        'MCP HTTP startup timed out.',
      );
      if (parsedHandoff.mcpTransport !== 'http') {
        throw new Error('Expected HTTP startup handoff.');
      }
      transport = new StreamableHTTPClientTransport(new URL(parsedHandoff.mcpUrl), {
        requestInit: { headers: { Authorization: `Bearer ${httpBearerToken}` } },
      });
      client = new Client({ name: 'browser-bridge-http-e2e', version: '1.0.0' });
      await withTimeout(
        client.connect(transport),
        startupTimeoutMs,
        'MCP HTTP client connection timed out.',
      );
      return {
        handoff: parsedHandoff,
        connection: {
          url: parsedHandoff.wsUrl,
          token: requireHandoffToken(parsedHandoff),
        },
        transportEndpoint: parsedHandoff.mcpUrl,
        usedHardCodedPortOrSideChannel: false,
        async call(name, args) {
          if (client === undefined) throw new Error('MCP HTTP client is not connected.');
          return parseHarnessCallResult(await client.callTool({ name, arguments: args }));
        },
        close,
      };
    } catch (error) {
      await close();
      await Promise.allSettled([spawned, handoffListener.promise]);
      throw error;
    }
  }

  async closeAll(): Promise<void> {
    await this.#tracker.closeAll();
  }
}

export const createMcpHarnessFactory = (): TestMcpHarnessFactory =>
  new McpHarnessFactoryImpl(new HarnessTracker());

const resolveExecutable = async (name: string): Promise<string> => {
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    if (directory.length === 0) continue;
    const candidate = path.join(directory, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue searching PATH.
    }
  }
  throw new Error(`Unable to resolve ${name} on PATH.`);
};

export const spawnPreviewHelpWithOnlyNodeAndPnpmOnPath = async (): Promise<{
  exitCode: number | null;
  pathContainsRtk: boolean;
}> => {
  const directory = await mkdtemp(path.join(tmpdir(), 'bridge-preview-path-'));
  try {
    await symlink(process.execPath, path.join(directory, 'node'));
    const pnpm = await resolveExecutable('pnpm');
    const pnpmLauncher = path.join(directory, 'pnpm');
    const runtimePath = [directory, '/usr/bin', '/bin'].join(path.delimiter);
    await writeFile(pnpmLauncher, [
      `#!${process.execPath}`,
      "const { spawn } = require('node:child_process');",
      `const child = spawn(${JSON.stringify(pnpm)}, process.argv.slice(2), {`,
      `  env: { ...process.env, PATH: ${JSON.stringify(runtimePath)} },`,
      "  stdio: 'inherit',",
      '});',
      "child.once('error', (error) => { console.error(error.message); process.exitCode = 1; });",
      "child.once('close', (code, signal) => {",
      "  if (signal !== null) process.kill(process.pid, signal);",
      "  else process.exitCode = code ?? 1;",
      '});',
      '',
    ].join('\n'), { mode: 0o700 });
    await chmod(pnpmLauncher, 0o700);
    const isolatedPath = directory;
    const child = spawn('pnpm', ['exec', 'vite', 'preview', '--help'], {
      cwd: repoRoot,
      env: { ...process.env, PATH: isolatedPath },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const exitCode = await withTimeout(new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    }), startupTimeoutMs, 'Vite preview help timed out.').catch(async (error: unknown) => {
      await stopChild(child);
      throw error;
    });
    return {
      exitCode,
      pathContainsRtk: isolatedPath.split(path.delimiter).some((entry) =>
        path.basename(entry) === 'rtk'),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

const auditPage = async (page: Page, use: (page: Page) => Promise<void>): Promise<void> => {
  // The example map intentionally loads its base style from the MapLibre demo
  // tiles host; every other external origin must stay absent from the page.
  const allowedExternalOrigins = new Set(['https://demotiles.maplibre.org']);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const failedResponses: string[] = [];
  const externalOrigins = new Set<string>();
  page.on('pageerror', (error) => { pageErrors.push(error.message); });
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', (request) => {
    failedRequests.push(`${request.url()}: ${request.failure()?.errorText ?? 'failed'}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
  });
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith('http://') && !url.startsWith('https://')) return;
    const origin = new URL(url).origin;
    if (origin !== bridgeOrigin && !allowedExternalOrigins.has(origin)) externalOrigins.add(origin);
  });
  let testError: unknown;
  try {
    await use(page);
  } catch (error) {
    testError = error;
  } finally {
    if (page.url().startsWith(bridgeOrigin)) {
      const hasWebGl2 = await page.evaluate(() =>
        document.createElement('canvas').getContext('webgl2') !== null);
      expect(hasWebGl2).toBe(true);
    }
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
    expect(failedResponses).toEqual([]);
    expect([...externalOrigins]).toEqual([]);
  }
  if (testError !== undefined) throw testError;
};

type Fixtures = {
  harness: McpHarness;
  httpHarness: HttpMcpHarness;
  harnessFactory: TestMcpHarnessFactory;
};

export const test = base.extend<Fixtures>({
  page: async ({ page }, use) => { await auditPage(page, use); },
  harnessFactory: async ({ browserName }, use) => {
    void browserName;
    const factory = createMcpHarnessFactory();
    try { await use(factory); } finally { await factory.closeAll(); }
  },
  harness: async ({ harnessFactory }, use) => {
    const harness = await harnessFactory.start();
    try { await use(harness); } finally { await harness.close(); }
  },
  httpHarness: async ({ harnessFactory }, use) => {
    const harness = await harnessFactory.startHttp();
    try { await use(harness); } finally { await harness.close(); }
  },
});

export { expect };
