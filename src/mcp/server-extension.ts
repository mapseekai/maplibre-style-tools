import {
  ResourceTemplate,
  type McpServer,
} from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import type { DocumentToolHandlers } from './document-handlers.js';
import type { McpResponseBoundary } from './message-boundary.js';
import {
  DOCUMENT_TOOL_NAMES,
  documentToolInputSchemas,
  type DocumentToolName,
} from './schemas.js';
import {
  documentResourceUriAdmission,
  styleResourceTemplates,
  type McpResourceResolver,
} from './resources.js';
import type {
  McpMessagePolicy,
  ResourceUriAdmission,
} from './types.js';

export interface McpServerExtensionContext {
  readonly messagePolicy: McpMessagePolicy;
  readonly responseBoundary: McpResponseBoundary;
  registerResourceUriAdmission(admission: ResourceUriAdmission): void;
  guardResourceHandler<Args extends unknown[], Result>(
    handler: (...args: Args) => Result | Promise<Result>,
  ): (...args: Args) => Promise<Result>;
}

export type McpServerExtension = (
  server: McpServer,
  context: McpServerExtensionContext,
) => undefined;

interface ToolMetadata {
  readonly title: string;
  readonly description: string;
  readonly annotations: ToolAnnotations;
}

const annotations = (
  readOnlyHint: boolean,
  destructiveHint: boolean,
  idempotentHint: boolean,
  openWorldHint: boolean,
): ToolAnnotations => Object.freeze({
  readOnlyHint,
  destructiveHint,
  idempotentHint,
  openWorldHint,
});

const documentToolMetadata = Object.freeze({
  style_session_open: {
    title: 'Open style session',
    description: 'Open one bounded in-memory session from inline Style JSON.',
    annotations: annotations(false, false, false, false),
  },
  style_session_close: {
    title: 'Close style session',
    description: 'Close one in-memory style session.',
    annotations: annotations(false, true, true, false),
  },
  style_validate: {
    title: 'Validate style',
    description: 'Validate inline Style JSON or one open session snapshot.',
    annotations: annotations(true, false, true, false),
  },
  style_inspect: {
    title: 'Inspect style',
    description: 'Read one context, layer, source, or source-layer view from a session.',
    annotations: annotations(true, false, true, false),
  },
  style_search_layers: {
    title: 'Search style layers',
    description: 'Search layer summaries in one session without mutation.',
    annotations: annotations(true, false, true, false),
  },
  style_analyze_geojson: {
    title: 'Analyze GeoJSON',
    description: 'Analyze inline GeoJSON or one session GeoJSON source.',
    annotations: annotations(true, false, true, false),
  },
  style_apply_transaction: {
    title: 'Apply style transaction',
    description: 'Dry-run or commit one revision-checked `{operations:[...]}` transaction whose shape and limits core validates.',
    annotations: annotations(false, true, false, false),
  },
  style_export: {
    title: 'Export style snapshot',
    description: 'Export the current or one retained revision of a session.',
    annotations: annotations(true, false, true, false),
  },
}) satisfies Readonly<Record<DocumentToolName, ToolMetadata>>;

const resourceMetadata = Object.freeze([
  Object.freeze({
    name: 'style-session',
    title: 'Style session metadata',
    description: 'Read bounded session metadata; the template contains the literal ~ marker, so pass the raw semantic sessionId.',
  }),
  Object.freeze({
    name: 'style-document',
    title: 'Style document',
    description: 'Read one current Style document; the template contains the literal ~ marker, so pass the raw semantic sessionId.',
  }),
  Object.freeze({
    name: 'style-context',
    title: 'Style context',
    description: 'Read one bounded Style context; the template contains the literal ~ marker, so pass the raw semantic sessionId.',
  }),
  Object.freeze({
    name: 'style-layer',
    title: 'Style layer',
    description: 'Read one exact layer; the template contains literal ~ markers, so pass raw semantic sessionId and layerId values.',
  }),
  Object.freeze({
    name: 'style-source',
    title: 'Style source',
    description: 'Read one exact source; the template contains literal ~ markers, so pass raw semantic sessionId and sourceId values.',
  }),
  Object.freeze({
    name: 'style-revision-diff',
    title: 'Style revision diff',
    description: 'Read one positive revision diff; the template contains literal ~ markers, so pass raw semantic sessionId and revision values.',
  }),
] as const);

type JsonSchemaObject = Record<string, unknown>;

const requireJsonSchemaObject = (value: unknown): JsonSchemaObject => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Document tool input schema could not be advertised.');
  }
  return value as JsonSchemaObject;
};

const requireSchemaVariant = (
  schema: JsonSchemaObject,
  property: string,
  discriminant: string,
): JsonSchemaObject => {
  const properties = requireJsonSchemaObject(schema.properties);
  const union = requireJsonSchemaObject(properties[property]);
  const variants = union.oneOf;
  if (!Array.isArray(variants)) {
    throw new TypeError('Document tool input union could not be advertised.');
  }
  for (const candidate of variants) {
    const variant = requireJsonSchemaObject(candidate);
    const variantProperties = requireJsonSchemaObject(variant.properties);
    const kind = requireJsonSchemaObject(variantProperties.kind);
    if (kind.const === discriminant) return variant;
  }
  throw new TypeError('Document tool input variant could not be advertised.');
};

const makeAdvertisedInputSchema = (name: DocumentToolName): JsonSchemaObject => {
  const schema = requireJsonSchemaObject(z.toJSONSchema(documentToolInputSchemas[name], {
    io: 'input',
    unrepresentable: 'any',
  }));
  Reflect.deleteProperty(schema, '$schema');
  if (name === 'style_session_open') schema.required = ['style'];
  if (name === 'style_validate') {
    requireSchemaVariant(schema, 'target', 'inline').required = ['kind', 'style'];
  }
  if (name === 'style_analyze_geojson') {
    requireSchemaVariant(schema, 'target', 'inline').required = ['kind', 'data'];
  }
  return schema;
};

const sdkAdvertisedSchemas = new WeakSet<object>();

const requireSdkAdvertisableInputSchema = (name: DocumentToolName) => {
  const schema = documentToolInputSchemas[name];
  if (!sdkAdvertisedSchemas.has(schema)) {
    const advertised = makeAdvertisedInputSchema(name);
    Object.defineProperty(schema._zod, 'toJSONSchema', {
      configurable: false,
      enumerable: false,
      writable: false,
      value: () => {
        const parent = schema._zod.parent;
        schema._zod.parent = undefined;
        queueMicrotask(() => {
          if (schema._zod.parent === undefined) schema._zod.parent = parent;
        });
        return structuredClone(advertised);
      },
    });
    sdkAdvertisedSchemas.add(schema);
  }
  return schema;
};

export interface McpServerExtensionDependencies {
  readonly handlers: DocumentToolHandlers;
  readonly resources: McpResourceResolver;
}

export const createMcpServerExtension = (
  dependencies: McpServerExtensionDependencies,
): McpServerExtension => (server, context) => {
  context.registerResourceUriAdmission(documentResourceUriAdmission);

  for (const name of DOCUMENT_TOOL_NAMES) {
    const metadata = documentToolMetadata[name];
    server.registerTool(name, {
      title: metadata.title,
      description: metadata.description,
      inputSchema: requireSdkAdvertisableInputSchema(name),
      annotations: metadata.annotations,
    }, (input: unknown) => dependencies.handlers[name](input));
  }

  for (let index = 0; index < styleResourceTemplates.length; index += 1) {
    const pattern = styleResourceTemplates[index];
    const metadata = resourceMetadata[index];
    if (pattern === undefined || metadata === undefined) continue;
    server.registerResource(
      metadata.name,
      new ResourceTemplate(pattern, { list: undefined }),
      {
        title: metadata.title,
        description: metadata.description,
        mimeType: 'application/json',
      },
      context.guardResourceHandler(async (uri) => {
        const result = await dependencies.resources.resolve(uri);
        return { contents: result.contents };
      }),
    );
  }
  return undefined;
};
