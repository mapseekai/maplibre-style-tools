import { z } from 'zod';

import { capabilityRegistry } from '../capabilities/registry.js';
import type { CapabilityResult } from '../capabilities/contracts.js';
import { createStyleToolError, isStyleToolError, type JsonValue } from '../core/index.js';
import type { LiveMapRegistry } from '../bridge/registry.js';
import { BridgeMapAuthority } from './bridge-authority.js';
import type { McpResponseBoundary } from './message-boundary.js';
import { capabilityToolResult } from './output.js';
import { SessionStyleAuthority } from './session-authority.js';
import type { StyleSessionStore } from './session-store.js';
import type { McpTextToolResult } from './types.js';

const sessionTargetSchema = z.strictObject({
  kind: z.literal('session'),
  sessionId: z.string().min(1),
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
});
const mapTargetSchema = z.strictObject({ kind: z.literal('map'), mapId: z.string().min(1) });
const targetSchema = z.discriminatedUnion('kind', [sessionTargetSchema, mapTargetSchema]);

export const MCP_CAPABILITY_TOOL_NAMES = Object.freeze([
  'inspectStyle', 'applyStyleTransaction', 'applyStyleDocument', 'runMapCommand', 'queryMapFeatures',
] as const);
export type McpCapabilityToolName = (typeof MCP_CAPABILITY_TOOL_NAMES)[number];

export const openStyleSessionInputSchema = z.strictObject({ style: z.unknown() });
export const closeStyleSessionInputSchema = z.strictObject({ sessionId: z.string().min(1) });
export const exportStyleSessionInputSchema = z.strictObject({
  sessionId: z.string().min(1), revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
});

export interface McpToolHandlers {
  readonly openStyleSession: (input: unknown, signal?: AbortSignal) => Promise<McpTextToolResult>;
  readonly closeStyleSession: (input: unknown, signal?: AbortSignal) => Promise<McpTextToolResult>;
  readonly exportStyleSession: (input: unknown, signal?: AbortSignal) => Promise<McpTextToolResult>;
  readonly inspectStyle: (input: unknown, signal?: AbortSignal) => Promise<McpTextToolResult>;
  readonly applyStyleTransaction: (input: unknown, signal?: AbortSignal) => Promise<McpTextToolResult>;
  readonly applyStyleDocument: (input: unknown, signal?: AbortSignal) => Promise<McpTextToolResult>;
  readonly runMapCommand: (input: unknown, signal?: AbortSignal) => Promise<McpTextToolResult>;
  readonly queryMapFeatures: (input: unknown, signal?: AbortSignal) => Promise<McpTextToolResult>;
}

const invalid = (message: string): CapabilityResult<never> => ({
  success: false, message, error: createStyleToolError('INVALID_INPUT', message),
});
const failure = (error: unknown): CapabilityResult<never> => ({
  success: false,
  message: isStyleToolError(error) ? error.message : 'MCP tool failed internally.',
  error: isStyleToolError(error) ? error : createStyleToolError('INTERNAL', 'MCP tool failed internally.'),
});

const isAuthorityFreeInspect = (input: unknown): boolean => typeof input === 'object' && input !== null
  && ['validateDocument', 'validateTransaction', 'analyzeGeoJson'].includes((input as { action?: unknown }).action as string);

const adapterInput = (raw: unknown, allowOmittedTarget: boolean) => {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false as const };
  const record = raw as Record<string, unknown>;
  if (!Object.hasOwn(record, 'input')) return { ok: false as const };
  if (!Object.hasOwn(record, 'target')) return allowOmittedTarget ? { ok: true as const, input: record.input } : { ok: false as const };
  const target = targetSchema.safeParse(record.target);
  return target.success ? { ok: true as const, input: record.input, target: target.data } : { ok: false as const };
};

export const createMcpToolHandlers = (
  store: StyleSessionStore,
  boundary: McpResponseBoundary,
  registry?: LiveMapRegistry,
): McpToolHandlers => {
  const result = (value: CapabilityResult<JsonValue>): McpTextToolResult =>
    boundary.requireToolSuccess(capabilityToolResult(value));
  const sessionTool = async (raw: unknown, name: McpCapabilityToolName, signal?: AbortSignal): Promise<McpTextToolResult> => {
    const parsed = adapterInput(raw, name === 'inspectStyle' && isAuthorityFreeInspect((raw as { input?: unknown })?.input));
    if (!parsed.ok) return result(invalid('Expected a strict object with target and input.'));
    if (parsed.target === undefined) return result(await capabilityRegistry[name].execute(
      () => null,
      parsed.input,
      signal === undefined ? undefined : { abortSignal: signal },
    ) as CapabilityResult<JsonValue>);
    const target = parsed.target;
    if (target.kind === 'map') {
      if (registry === undefined) return result(invalid('Live map targets are unavailable on this MCP server.'));
      return result(await capabilityRegistry[name].execute(
        () => new BridgeMapAuthority(registry, target.mapId),
        parsed.input,
        signal === undefined ? undefined : { abortSignal: signal },
      ) as CapabilityResult<JsonValue>);
    }
    if (target.kind !== 'session') return result(invalid('Unsupported authority target.'));
    const sessionTarget = sessionTargetSchema.parse(target);
    if (name === 'runMapCommand' || name === 'queryMapFeatures') {
      return result(invalid(`${name} requires a map target.`));
    }
    try {
      const snapshot = await store.read(sessionTarget.sessionId);
      const expectedRevision = sessionTarget.expectedRevision ?? snapshot.revision;
      const authority = new SessionStyleAuthority(
        store, sessionTarget.sessionId, expectedRevision, snapshot.style,
      );
      const executed = await capabilityRegistry[name].execute(
        () => authority,
        parsed.input,
        signal === undefined ? undefined : { abortSignal: signal },
      ) as CapabilityResult<JsonValue>;
      if (executed.success && (name === 'applyStyleTransaction' || name === 'applyStyleDocument')
        && typeof executed.data === 'object' && executed.data !== null && !Array.isArray(executed.data)) {
        const exported = await store.export(sessionTarget.sessionId);
        return result({ ...executed, data: { ...executed.data, revision: exported.revision } });
      }
      return result(executed);
    } catch (error) { return result(failure(error)); }
  };
  return {
    openStyleSession: async (raw) => {
      const parsed = openStyleSessionInputSchema.safeParse(raw);
      if (!parsed.success) return result(invalid('Expected { style }.'));
      try {
        const opened = await store.open(parsed.data.style);
        return result({ success: true, message: 'Style session opened.', data: opened as unknown as JsonValue });
      } catch (error) { return result(failure(error)); }
    },
    closeStyleSession: async (raw) => {
      const parsed = closeStyleSessionInputSchema.safeParse(raw);
      if (!parsed.success) return result(invalid('Expected { sessionId }.'));
      try { return result({ success: true, message: 'Style session closed.', data: await store.close(parsed.data.sessionId) as unknown as JsonValue }); }
      catch (error) { return result(failure(error)); }
    },
    exportStyleSession: async (raw) => {
      const parsed = exportStyleSessionInputSchema.safeParse(raw);
      if (!parsed.success) return result(invalid('Expected { sessionId, revision? }.'));
      try { return result({ success: true, message: 'Style session exported.', data: await store.export(parsed.data.sessionId, parsed.data.revision) as unknown as JsonValue }); }
      catch (error) { return result(failure(error)); }
    },
    inspectStyle: (raw) => sessionTool(raw, 'inspectStyle'),
    applyStyleTransaction: (raw, signal) => sessionTool(raw, 'applyStyleTransaction', signal),
    applyStyleDocument: (raw, signal) => sessionTool(raw, 'applyStyleDocument', signal),
    runMapCommand: (raw, signal) => sessionTool(raw, 'runMapCommand', signal),
    queryMapFeatures: (raw) => sessionTool(raw, 'queryMapFeatures'),
  };
};
