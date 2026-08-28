import { capabilityModelJsonSchema } from '../capabilities/model-schema.js';
import { capabilityRegistry, type CapabilityName } from '../capabilities/registry.js';
import type { WebMcpToolDefinitionLike, WebMcpToolExecutor } from './types.js';

export const WEB_MCP_READ_ONLY_TOOLS = Object.freeze([
  'inspectStyle',
  'queryMapFeatures',
] as const satisfies readonly CapabilityName[]);

export const WEB_MCP_MUTATION_TOOLS = Object.freeze([
  'applyStyleTransaction',
  'applyStyleDocument',
  'runMapCommand',
] as const satisfies readonly CapabilityName[]);

const titles: Readonly<Record<CapabilityName, string>> = Object.freeze({
  inspectStyle: 'Inspect MapLibre style',
  queryMapFeatures: 'Query MapLibre features',
  applyStyleTransaction: 'Apply MapLibre style transaction',
  applyStyleDocument: 'Apply MapLibre style document',
  runMapCommand: 'Run MapLibre map command',
});

const readOnlyTools = new Set<CapabilityName>(WEB_MCP_READ_ONLY_TOOLS);

const neverAborted = new AbortController().signal;

export function createMapLibreWebMcpToolDefinitions(options: {
  readonly allowMutations: boolean;
  readonly execute: WebMcpToolExecutor;
}): readonly WebMcpToolDefinitionLike[] {
  const names: readonly CapabilityName[] = options.allowMutations
    ? [...WEB_MCP_READ_ONLY_TOOLS, ...WEB_MCP_MUTATION_TOOLS]
    : WEB_MCP_READ_ONLY_TOOLS;
  return Object.freeze(names.map((name) => Object.freeze({
    name,
    title: titles[name],
    description: capabilityRegistry[name].description,
    inputSchema: capabilityModelJsonSchema(name),
    annotations: Object.freeze({
      readOnlyHint: readOnlyTools.has(name),
      untrustedContentHint: true,
    }),
    execute: (input: Record<string, unknown>, execOptions?: { readonly signal?: AbortSignal }) =>
      options.execute(name, input, execOptions?.signal ?? neverAborted),
  })));
}
