import assert from 'node:assert/strict';
import test from 'node:test';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

import { createStyleToolError } from '../core/index.js';
import type { DocumentToolHandlers } from './document-handlers.js';
import {
  createMcpResponseBoundary,
  resolveMcpMessagePolicy,
  type McpResponseBoundary,
} from './message-boundary.js';
import { documentToolInputSchemas } from './schemas.js';
import {
  createMcpServerExtension,
  type McpServerExtensionContext,
} from './server-extension.js';
import type { McpResourceResolver } from './resources.js';
import type { ResourceUriAdmission } from './types.js';

const expectedTools = Object.freeze({
  style_session_open: ['Open style session', 'Open one bounded in-memory session from inline Style JSON.', false, false, false, false],
  style_session_close: ['Close style session', 'Close one in-memory style session.', false, true, true, false],
  style_validate: ['Validate style', 'Validate inline Style JSON or one open session snapshot.', true, false, true, false],
  style_inspect: ['Inspect style', 'Read one context, layer, source, or source-layer view from a session.', true, false, true, false],
  style_search_layers: ['Search style layers', 'Search layer summaries in one session without mutation.', true, false, true, false],
  style_analyze_geojson: ['Analyze GeoJSON', 'Analyze inline GeoJSON or one session GeoJSON source.', true, false, true, false],
  style_apply_transaction: ['Apply style transaction', 'Dry-run or commit one revision-checked `{operations:[...]}` transaction whose shape and limits core validates.', false, true, false, false],
  style_export: ['Export style snapshot', 'Export the current or one retained revision of a session.', true, false, true, false],
} as const);

class RecordingServer {
  readonly tools: Array<{ name: string; config: Record<string, unknown>; handler: unknown }> = [];
  readonly resources: Array<{ name: string; template: ResourceTemplate; config: Record<string, unknown>; handler: unknown }> = [];

  registerTool(name: string, config: Record<string, unknown>, handler: unknown): void {
    this.tools.push({ name, config, handler });
  }

  registerResource(
    name: string,
    template: ResourceTemplate,
    config: Record<string, unknown>,
    handler: unknown,
  ): void {
    this.resources.push({ name, template, config, handler });
  }
}

const handlers = Object.fromEntries(Object.keys(expectedTools).map((name) => [
  name,
  async () => ({ content: [{ type: 'text', text: '{"ok":true,"data":{}}' }], structuredContent: { ok: true, data: {} } }),
])) as unknown as DocumentToolHandlers;

const resources: McpResourceResolver = {
  resolve: async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: '{}' }] }),
};

const makeContext = (boundary: McpResponseBoundary) => {
  const admissions: ResourceUriAdmission[] = [];
  const guardResourceHandler: McpServerExtensionContext['guardResourceHandler'] =
    (handler) => async (...args) => {
      try {
        return boundary.requireResourceResult(await handler(...args));
      } catch (error: unknown) {
        const authentic = error === sentinel
          ? sentinel
          : createStyleToolError('INTERNAL', 'The resource failed internally.');
        throw boundary.requireResourceFailure(authentic);
      }
    };
  const context: McpServerExtensionContext = Object.freeze({
    messagePolicy: boundary.policy,
    responseBoundary: boundary,
    registerResourceUriAdmission: (admission: ResourceUriAdmission) => { admissions.push(admission); },
    guardResourceHandler,
  });
  return { context, admissions };
};

const sentinel = createStyleToolError(
  'INVALID_INPUT', 'too large', undefined, { reason: 'responseTooLarge' },
);

test('extension registers exact eight tool contracts and six ResourceTemplate entries', () => {
  const server = new RecordingServer();
  const boundary = createMcpResponseBoundary(resolveMcpMessagePolicy());
  const { context, admissions } = makeContext(boundary);
  createMcpServerExtension({ handlers, resources })(server as unknown as McpServer, context);

  assert.deepEqual(server.tools.map(({ name }) => name), Object.keys(expectedTools));
  for (const entry of server.tools) {
    const [title, description, readOnlyHint, destructiveHint, idempotentHint, openWorldHint] =
      expectedTools[entry.name as keyof typeof expectedTools];
    assert.equal(entry.config.title, title);
    assert.equal(entry.config.description, description);
    assert.strictEqual(entry.config.inputSchema, documentToolInputSchemas[entry.name as keyof typeof documentToolInputSchemas]);
    assert.deepEqual(entry.config.annotations, {
      readOnlyHint, destructiveHint, idempotentHint, openWorldHint,
    });
    assert.equal('outputSchema' in entry.config, false);
  }
  assert.equal(server.resources.length, 6);
  assert.ok(server.resources.every(({ template }) => template instanceof ResourceTemplate));
  assert.deepEqual(admissions.map(({ scheme, authority }) => [scheme, authority]), [
    ['maplibre-style', 'sessions'],
  ]);
});

test('guarded ResourceTemplate callback forwards official arguments and bounds failures', async () => {
  const server = new RecordingServer();
  const boundary = createMcpResponseBoundary(resolveMcpMessagePolicy());
  const { context } = makeContext(boundary);
  const calls: unknown[][] = [];
  const guarded = context.guardResourceHandler((...args: unknown[]) => {
    calls.push(args);
    return resources.resolve(args[0] as URL);
  });
  const uri = new URL('maplibre-style://sessions/~s1/style');
  const variables = { sessionId: 's1' };
  const extra = { signal: AbortSignal.timeout(1_000) };
  const success = await guarded(uri, variables, extra);
  assert.equal(success.contents[0]?.uri, uri.href);
  assert.deepEqual(calls, [[uri, variables, extra]]);

  await assert.rejects(
    () => context.guardResourceHandler(() => { throw sentinel; })(),
    (error: unknown) => JSON.stringify(error).includes('responseTooLarge'),
  );
  await assert.rejects(
    () => context.guardResourceHandler(() => { throw new Error('private-secret'); })(),
    (error: unknown) => !JSON.stringify(error).includes('private-secret'),
  );
  void server;
});
