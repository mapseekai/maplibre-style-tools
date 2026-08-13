import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test, { type TestContext } from 'node:test';

const execFileAsync = promisify(execFile);
const packageSmoke = process.env.MAPLIBRE_PACKAGE_SMOKE === '1' ? test : test.skip;
const repositoryRoot = process.cwd();
const repositoryTsc = join(repositoryRoot, 'node_modules/typescript/bin/tsc');

const parsePackOutput = (stdout: string): [{ filename: string; files: { path: string }[] }] => {
  const jsonStart = stdout.lastIndexOf('\n[');
  const parsed: unknown = JSON.parse(stdout.slice(jsonStart < 0 ? 0 : jsonStart + 1));
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new TypeError('npm pack did not return exactly one result.');
  }
  return parsed as [{ filename: string; files: { path: string }[] }];
};

const run = async (
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> => execFileAsync(command, [...args], {
  cwd,
  encoding: 'utf8',
  env: { ...process.env, NODE_PATH: undefined },
  maxBuffer: 16 * 1024 * 1024,
});

interface FreshPackedConsumer {
  readonly consumerDir: string;
  readonly installedPackageDir: string;
  readonly packlist: readonly string[];
  readonly manifest: Record<string, unknown>;
}

const createFreshPackedConsumer = async (
  t: TestContext,
): Promise<FreshPackedConsumer> => {
  const packDir = await mkdtemp(join(tmpdir(), 'maplibre-style-mcp-pack-'));
  const consumerDir = await mkdtemp(join(tmpdir(), 'maplibre-style-mcp-consumer-'));
  t.after(async () => {
    await Promise.all([
      rm(packDir, { recursive: true, force: true }),
      rm(consumerDir, { recursive: true, force: true }),
    ]);
  });
  await writeFile(join(consumerDir, 'package.json'), JSON.stringify({
    private: true,
    type: 'module',
  }));
  const packed = parsePackOutput((await run('npm', [
    'pack', '--json', '--pack-destination', packDir,
  ], repositoryRoot)).stdout)[0];
  const tarball = join(packDir, packed.filename);
  await run('npm', [
    'install', '--ignore-scripts', '--no-package-lock', '--no-audit', '--no-fund',
    tarball,
  ], consumerDir);
  const installedPackageDir = join(
    consumerDir, 'node_modules', 'maplibre-style-tools',
  );
  return {
    consumerDir,
    installedPackageDir,
    packlist: packed.files.map(({ path }) => path),
    manifest: JSON.parse(
      await readFile(join(installedPackageDir, 'package.json'), 'utf8'),
    ) as Record<string, unknown>,
  };
};

const rootConsumer = `import {
  createCompactMapLibreStyleTools,
  createMapLibreStyleTools,
} from 'maplibre-style-tools';
void [createCompactMapLibreStyleTools, createMapLibreStyleTools];
`;

const coreConsumer = `import {
  applyStyleTransaction,
  validateStyleDocument,
} from 'maplibre-style-tools/core';
void [applyStyleTransaction, validateStyleDocument];
// @ts-expect-error core must not load the Node Buffer global.
void Buffer;
// @ts-expect-error core must not load DOM globals.
void document;
`;

const mcpConsumer = `import {
  MAX_MCP_MESSAGE_BYTES,
  MAX_STYLE_SESSION_ID_BYTES,
  createMapLibreStyleMcpServer,
  createStyleSessionStore,
  resolveMcpMessagePolicy,
} from 'maplibre-style-tools/mcp';
import type {
  CreateMapLibreStyleMcpServerOptions,
  McpMessagePolicy,
  McpServerExtension,
  McpServerExtensionContext,
  ResourceUriAdmission,
  RunStdioMcpOptions,
  StartStreamableHttpMcpOptions,
  StyleSessionStore,
} from 'maplibre-style-tools/mcp';

declare global {
  type HeadersInit =
    | readonly (readonly [string, string])[]
    | Readonly<Record<string, string | readonly string[]>>
    | Headers;
}

const policy: McpMessagePolicy = resolveMcpMessagePolicy();
const admission: ResourceUriAdmission = {
  scheme: 'example',
  authority: 'styles',
  assertCanonical(rawUri: string): void { void rawUri; },
};
const extension: McpServerExtension = (server, context: McpServerExtensionContext) => {
  context.registerResourceUriAdmission(admission);
  context.responseBoundary.requireToolSuccess({ ready: true });
  void server;
  return undefined;
};
const store = createStyleSessionStore();
const options: CreateMapLibreStyleMcpServerOptions = { store, extensions: [extension] };
const stdio: RunStdioMcpOptions = { startupDiagnosticLine: null };
const http: StartStreamableHttpMcpOptions = { bearerToken: 'secret' };
const created = createMapLibreStyleMcpServer(options);
declare const transport: Parameters<typeof created.connect>[0];
if (false) void created.connect(transport);
void created.server.server;

const plainStore = {
  size: 0,
  limits: store.limits,
  open: store.open,
  close: store.close,
  read: store.read,
  readRevision: store.readRevision,
  apply: store.apply,
  export: store.export,
  dispose: store.dispose,
};
// @ts-expect-error only a factory-created branded store can be injected.
const forgedStore: StyleSessionStore = plainStore;
// @ts-expect-error MCP extensions must be synchronous.
const asyncExtension: McpServerExtension = async () => undefined;
void [
  policy, stdio, http, forgedStore, asyncExtension,
  MAX_MCP_MESSAGE_BYTES, MAX_STYLE_SESSION_ID_BYTES,
];
`;

const configs = Object.freeze({
  root: {
    compilerOptions: {
      target: 'ES2023', lib: ['ES2023', 'DOM', 'DOM.Iterable'],
      module: 'ESNext', moduleResolution: 'Bundler', strict: true,
      noEmit: true, types: [], skipLibCheck: false,
    },
    include: ['root-consumer.ts'],
  },
  core: {
    compilerOptions: {
      target: 'ES2023', lib: ['ES2023'], module: 'NodeNext',
      moduleResolution: 'NodeNext', strict: true, noEmit: true,
      types: [], skipLibCheck: false,
    },
    include: ['core-consumer.ts'],
  },
  mcp: {
    compilerOptions: {
      target: 'ES2023', lib: ['ES2023'], module: 'NodeNext',
      moduleResolution: 'NodeNext', strict: true, noEmit: true,
      types: [], skipLibCheck: false,
    },
    include: ['mcp-consumer.ts'],
  },
});

const writeAndCheckConsumers = async (consumerDir: string): Promise<string> => {
  await Promise.all([
    writeFile(join(consumerDir, 'root-consumer.ts'), rootConsumer),
    writeFile(join(consumerDir, 'core-consumer.ts'), coreConsumer),
    writeFile(join(consumerDir, 'mcp-consumer.ts'), mcpConsumer),
    ...Object.entries(configs).map(([name, config]) => writeFile(
      join(consumerDir, `tsconfig.${name}-consumer.json`),
      JSON.stringify(config),
    )),
  ]);
  await run(process.execPath, [repositoryTsc, '-p', 'tsconfig.root-consumer.json'], consumerDir);
  await run(process.execPath, [repositoryTsc, '-p', 'tsconfig.core-consumer.json'], consumerDir);
  const result = await run(process.execPath, [
    repositoryTsc, '-p', 'tsconfig.mcp-consumer.json', '--listFiles',
  ], consumerDir);
  return result.stdout;
};

packageSmoke('packed package exposes mcp without import-time handles', async (t) => {
  const packed = await createFreshPackedConsumer(t);
  const output = await run(process.execPath, ['--input-type=module', '--eval',
    "import('maplibre-style-tools/mcp').then(m => console.log(typeof m.createMapLibreStyleMcpServer))",
  ], packed.consumerDir);
  assert.equal(output.stdout.trim(), 'function');
  assert.equal(output.stderr, '');
  assert.ok(packed.packlist.includes('dist/mcp/main.js'));
  assert.ok(packed.packlist.includes('dist/mcp/main.d.ts'));
  assert.match(
    await readFile(join(packed.installedPackageDir, 'dist/mcp/main.d.ts'), 'utf8'),
    /^\/\/\/ <reference types="node" preserve="true" \/>/m,
  );
  assert.equal(packed.packlist.some(
    (path) => path === 'evals' || path.startsWith('evals/'),
  ), false);
});

packageSmoke('packed manifest, NodeNext types, and binary all resolve from the exact tgz', async (t) => {
  const packed = await createFreshPackedConsumer(t);
  const exportsMap = packed.manifest.exports as Record<string, unknown>;
  assert.deepEqual(exportsMap['./mcp'], {
    types: './dist/mcp/main.d.ts',
    import: './dist/mcp/main.js',
    default: './dist/mcp/main.js',
  });
  assert.deepEqual(packed.manifest.bin, {
    'maplibre-style': './dist/cli/main.js',
    'maplibre-style-mcp': './dist/mcp/main.js',
  });
  const listFiles = await writeAndCheckConsumers(packed.consumerDir);
  assert.doesNotMatch(
    listFiles,
    /node_modules\/maplibre-style-tools\/dist\/(?:index\.(?:d\.ts|js)|ai-sdk\/|adapters\/maplibre\/)/mu,
  );
  assert.doesNotMatch(listFiles, /lib\.dom\.d\.ts/u);
  const binary = await run(
    join(packed.consumerDir, 'node_modules/.bin/maplibre-style-mcp'),
    ['--help'],
    packed.consumerDir,
  );
  assert.equal(binary.stdout, '');
  assert.match(binary.stderr, /Usage:/u);
});

test('README documents the discoverable nested MCP inputs and error boundary', async () => {
  const readme = await readFile('README.md', 'utf8');
  assert.match(readme, /style_validate[\s\S]*target[\s\S]*kind/u);
  assert.match(readme, /style_inspect[\s\S]*selection[\s\S]*view/u);
  assert.match(readme, /SDK schema rejection[\s\S]*business envelope/u);
  assert.match(readme, /sessions\/~\{sessionId\}[\s\S]*raw semantic[\s\S]*RFC6570/u);
  assert.match(readme, /style_apply_transaction[\s\S]*transaction[\s\S]*core validates/u);
  assert.match(readme, /startupDiagnosticLine[\s\S]*null[\s\S]*composite/u);
  assert.match(readme, /maxMessageBytes[\s\S]*responseTooLarge[\s\S]*inbound[\s\S]*outbound/u);
  assert.match(readme, /ResourceUriAdmission[\s\S]*scheme[\s\S]*authority[\s\S]*synchronous/u);
  assert.match(readme, /Streamable HTTP[\s\S]*SSE[\s\S]*batch/u);
});
