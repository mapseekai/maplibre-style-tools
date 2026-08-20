import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import type { LiveMapRegistry } from '../bridge/registry.js';
import { capabilityRegistry } from '../capabilities/registry.js';
import { createMcpToolHandlers, MCP_CAPABILITY_TOOL_NAMES, type McpCapabilityToolName } from './tool-handlers.js';
import type { McpResponseBoundary } from './message-boundary.js';
import type { StyleSessionStore } from './session-store.js';
import { documentResourceUriAdmission, styleResourceTemplates, type McpResourceResolver } from './resources.js';
import type { McpMessagePolicy, ResourceUriAdmission } from './types.js';

export interface McpServerExtensionContext {
  readonly messagePolicy: McpMessagePolicy;
  readonly responseBoundary: McpResponseBoundary;
  registerResourceUriAdmission(admission: ResourceUriAdmission): void;
  setLiveMapRegistry(registry: LiveMapRegistry): void;
  getLiveMapRegistry(): LiveMapRegistry | undefined;
  guardResourceHandler<Args extends unknown[], Result>(handler: (...args: Args) => Result | Promise<Result>): (...args: Args) => Promise<Result>;
}
export type McpServerExtension = (server: McpServer, context: McpServerExtensionContext) => undefined;

const annotations = (readOnlyHint: boolean, destructiveHint: boolean): ToolAnnotations => ({
  readOnlyHint, destructiveHint, idempotentHint: false, openWorldHint: false,
});
const sessionTools = Object.freeze({
  openStyleSession: { title: 'Open style session', description: 'Open a validated in-memory style session.', annotations: annotations(false, false), schema: z.strictObject({ style: z.unknown() }) },
  closeStyleSession: { title: 'Close style session', description: 'Close an in-memory style session.', annotations: annotations(false, true), schema: z.strictObject({ sessionId: z.string().min(1) }) },
  exportStyleSession: { title: 'Export style session', description: 'Export the current or retained style session revision.', annotations: annotations(true, false), schema: z.strictObject({ sessionId: z.string().min(1), revision: z.number().int().nonnegative().optional() }) },
});
const targetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('session'), sessionId: z.string().min(1), expectedRevision: z.number().int().nonnegative().optional() }),
  z.strictObject({ kind: z.literal('map'), mapId: z.string().min(1) }),
]);
const capabilitySchema = (name: McpCapabilityToolName) => z.strictObject({
  ...(name === 'inspectStyle' ? { target: targetSchema.optional() } : { target: targetSchema }),
  input: z.unknown(),
});
const metadata = (name: McpCapabilityToolName) => ({
  title: name,
  description: capabilityRegistry[name].description,
  annotations: annotations(
    name === 'inspectStyle' || name === 'queryMapFeatures',
    name.startsWith('apply') || name === 'runMapCommand',
  ),
  inputSchema: capabilitySchema(name),
});

export interface McpServerExtensionDependencies { readonly store: StyleSessionStore; readonly resources: McpResourceResolver; }
export const createMcpServerExtension = ({ store, resources }: McpServerExtensionDependencies): McpServerExtension => (server, context) => {
  context.registerResourceUriAdmission(documentResourceUriAdmission);
  const handlers = createMcpToolHandlers(store, context.responseBoundary, context.getLiveMapRegistry());
  for (const name of MCP_CAPABILITY_TOOL_NAMES) {
    const item = metadata(name);
    server.registerTool(name, item, (input: unknown) => handlers[name](input));
  }
  for (const [name, item] of Object.entries(sessionTools) as Array<[keyof typeof sessionTools, (typeof sessionTools)[keyof typeof sessionTools]]>) {
    server.registerTool(name, item, (input: unknown) => handlers[name](input));
  }
  for (let index = 0; index < styleResourceTemplates.length; index += 1) {
    const pattern = styleResourceTemplates[index];
    if (pattern === undefined) continue;
    server.registerResource(`style-resource-${index}`, new ResourceTemplate(pattern, { list: undefined }), { mimeType: 'application/json' }, context.guardResourceHandler(async (uri) => {
      const resolved = await resources.resolve(uri);
      return { contents: resolved.contents };
    }));
  }
  return undefined;
};
