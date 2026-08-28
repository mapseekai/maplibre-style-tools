import type { Map as MapLibreMap } from 'maplibre-gl';
import type { RuntimeImageLoader } from '../adapters/maplibre/index.js';
import type {
  CapabilityName,
  CapabilityResult,
  MapToolContext,
} from '../capabilities/index.js';
import type { ResourcePolicy } from '../bridge/resource-policy.js';

export type MapLibreWebMcpToolName = CapabilityName;

export interface WebMcpAuthorizationRequest {
  readonly toolName: MapLibreWebMcpToolName;
  readonly input: unknown;
  readonly readOnly: boolean;
}

export type WebMcpInvocationEvent =
  | { readonly phase: 'started'; readonly toolName: MapLibreWebMcpToolName; readonly action?: string; readonly startedAt: number }
  | { readonly phase: 'succeeded'; readonly toolName: MapLibreWebMcpToolName; readonly action?: string; readonly durationMs: number; readonly message: string }
  | { readonly phase: 'failed'; readonly toolName: MapLibreWebMcpToolName; readonly action?: string; readonly durationMs: number; readonly message: string; readonly code: string }
  | { readonly phase: 'aborted'; readonly toolName: MapLibreWebMcpToolName; readonly action?: string; readonly durationMs: number }
  | { readonly phase: 'errored'; readonly toolName: MapLibreWebMcpToolName; readonly action?: string; readonly durationMs: number; readonly message: string };

export interface RegisterMapLibreWebMcpToolsOptions {
  readonly getMap: () => MapLibreMap | null;
  readonly document?: Document;
  readonly getContext?: () => MapToolContext;
  readonly imageLoader?: RuntimeImageLoader;
  readonly allowMutations?: boolean;
  readonly resourcePolicy?: Partial<ResourcePolicy>;
  readonly exposedTo?: readonly string[];
  readonly signal?: AbortSignal;
  readonly authorizeInvocation?: (request: WebMcpAuthorizationRequest) => boolean | Promise<boolean>;
  readonly onInvocation?: (event: WebMcpInvocationEvent) => void;
}

export type MapLibreWebMcpRegistration =
  | { readonly supported: false; readonly toolNames: readonly []; close(): void }
  | { readonly supported: true; readonly toolNames: readonly MapLibreWebMcpToolName[]; close(): void };

export interface WebMcpToolAnnotationsLike {
  readonly readOnlyHint: boolean;
  readonly untrustedContentHint: boolean;
}

export interface WebMcpToolDefinitionLike {
  readonly name: MapLibreWebMcpToolName;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly annotations: WebMcpToolAnnotationsLike;
  readonly execute: (input: Record<string, unknown>, options?: { readonly signal?: AbortSignal }) => unknown | Promise<unknown>;
}

export interface WebMcpModelContextLike {
  registerTool(
    tool: WebMcpToolDefinitionLike,
    options?: { readonly exposedTo?: readonly string[]; readonly signal?: AbortSignal },
  ): Promise<void>;
}

export type WebMcpToolExecutor = (
  name: MapLibreWebMcpToolName,
  input: unknown,
  signal: AbortSignal,
) => Promise<CapabilityResult<unknown>>;

export interface WebMcpExecutionBoundary {
  readonly execute: WebMcpToolExecutor;
  close(): void;
}
