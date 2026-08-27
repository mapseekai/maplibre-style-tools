import type { Map as MapLibreMap } from 'maplibre-gl';
import {
  createBrowserMapRuntime,
  type BrowserMapRuntime,
  type BrowserRuntimeOptions,
} from '../bridge/browser-runtime.js';
import type { BridgeCapability } from '../bridge/protocol.js';
import { normalizeResourcePolicy } from '../bridge/resource-policy.js';
import {
  authorityNotReadyError,
  capabilityRegistry,
  type CapabilityResult,
} from '../capabilities/index.js';
import { createStyleToolError } from '../core/index.js';
import { WebMcpMapAuthority } from './runtime-authority.js';
import type {
  MapLibreWebMcpToolName,
  RegisterMapLibreWebMcpToolsOptions,
  WebMcpExecutionBoundary,
  WebMcpInvocationEvent,
} from './types.js';

interface WebMcpExecutionBoundaryDependencies {
  createRuntime(
    map: MapLibreMap,
    options: BrowserRuntimeOptions,
  ): Promise<BrowserMapRuntime>;
  dispatchCapability(
    name: MapLibreWebMcpToolName,
    authority: WebMcpMapAuthority,
    input: unknown,
    signal: AbortSignal,
  ): Promise<CapabilityResult<unknown>>;
  now(): number;
}

const dispatchCapability = async (
  name: MapLibreWebMcpToolName,
  authority: WebMcpMapAuthority,
  input: unknown,
  signal: AbortSignal,
): Promise<CapabilityResult<unknown>> => {
  const getAuthority = () => authority;
  switch (name) {
    case 'inspectStyle':
      return capabilityRegistry.inspectStyle.execute(getAuthority, input);
    case 'applyStyleTransaction':
      return capabilityRegistry.applyStyleTransaction.execute(
        getAuthority, input, { abortSignal: signal },
      );
    case 'applyStyleDocument':
      return capabilityRegistry.applyStyleDocument.execute(
        getAuthority, input, { abortSignal: signal },
      );
    case 'runMapCommand':
      return capabilityRegistry.runMapCommand.execute(
        getAuthority, input, { abortSignal: signal },
      );
    case 'queryMapFeatures':
      return capabilityRegistry.queryMapFeatures.execute(
        getAuthority, input, { abortSignal: signal },
      );
  }
};

const DEFAULT_DEPENDENCIES: WebMcpExecutionBoundaryDependencies = {
  createRuntime: createBrowserMapRuntime,
  dispatchCapability,
  now: Date.now,
};

const AUTHORIZATION_DENIED_MESSAGE = 'WebMCP invocation was not authorized.';
const UNEXPECTED_INVOCATION_MESSAGE = 'WebMCP invocation failed.';

const authorizationDenied = (): Extract<
  CapabilityResult<unknown>,
  { success: false }
> => ({
  success: false,
  message: AUTHORIZATION_DENIED_MESSAGE,
  error: createStyleToolError('CAPABILITY_DENIED', AUTHORIZATION_DENIED_MESSAGE),
});

const readOnlyTool = (name: MapLibreWebMcpToolName): boolean =>
  name === 'inspectStyle' || name === 'queryMapFeatures';

const invocationAction = (input: unknown): string | undefined => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined;
  try {
    const descriptor = Object.getOwnPropertyDescriptor(input, 'action');
    return descriptor !== undefined
      && 'value' in descriptor
      && typeof descriptor.value === 'string'
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
};

const runtimeCapabilities = (allowMutations: boolean): readonly BridgeCapability[] => [
  'style.read',
  'features.query',
  ...(allowMutations
    ? [
      'style.write',
      'runtime.state',
      'assets.write',
      'network.load',
    ] as const
    : []),
];

const normalizedRuntimeOptions = (
  options: RegisterMapLibreWebMcpToolsOptions,
): BrowserRuntimeOptions => {
  const pageDocument = options.document
    ?? (typeof globalThis.document === 'undefined' ? undefined : globalThis.document);
  const baseUrl = options.resourcePolicy?.baseUrl ?? pageDocument?.baseURI;
  const pageOrigin = pageDocument === undefined
    ? undefined
    : pageDocument.location.origin;
  const allowedResourceOrigins = options.resourcePolicy?.allowedResourceOrigins
    ?? (pageOrigin === undefined ? undefined : [pageOrigin]);
  if (baseUrl === undefined || allowedResourceOrigins === undefined) {
    throw new TypeError(
      'WebMCP resource policy requires a document or explicit base URL and origins.',
    );
  }
  return {
    capabilities: runtimeCapabilities(options.allowMutations === true),
    resourcePolicy: normalizeResourcePolicy({
      ...options.resourcePolicy,
      baseUrl,
      allowedResourceOrigins,
    }),
    ...(options.imageLoader === undefined ? {} : { imageLoader: options.imageLoader }),
  };
};

const mapNotReady = (): CapabilityResult<unknown> => {
  const error = authorityNotReadyError();
  return { success: false, message: error.message, error };
};

export function createWebMcpExecutionBoundary(
  options: RegisterMapLibreWebMcpToolsOptions,
  dependencies: Partial<WebMcpExecutionBoundaryDependencies> = {},
): WebMcpExecutionBoundary {
  const resolvedDependencies: WebMcpExecutionBoundaryDependencies = {
    ...DEFAULT_DEPENDENCIES,
    ...dependencies,
  };
  const runtimeOptions = normalizedRuntimeOptions(options);
  let tail = Promise.resolve();
  let activeMap: MapLibreMap | null = null;
  let runtimePromise: Promise<BrowserMapRuntime> | undefined;
  let closed = false;

  const emit = (event: WebMcpInvocationEvent): void => {
    try {
      options.onInvocation?.(event);
    } catch {
      // Invocation observers must not influence tool execution.
    }
  };

  const enqueue = <T>(
    signal: AbortSignal,
    operation: () => Promise<T>,
  ): Promise<T> => {
    const run = tail.then(async () => {
      if (closed) {
        throw new DOMException('WebMCP registration is closed.', 'AbortError');
      }
      if (signal.aborted) throw signal.reason;
      return operation();
    });
    tail = run.then(() => undefined, () => undefined);
    return run;
  };

  const resolveAuthority = async (): Promise<WebMcpMapAuthority | null> => {
    let map: MapLibreMap | null;
    try {
      map = options.getMap();
    } catch {
      return null;
    }
    if (map === null) return null;
    if (map !== activeMap || runtimePromise === undefined) {
      activeMap = map;
      runtimePromise = resolvedDependencies.createRuntime(map, runtimeOptions);
    }
    const runtime = await runtimePromise;
    await runtime.noteExternalStyle();
    return new WebMcpMapAuthority(runtime, options.getContext);
  };

  const invoke = async (
    name: MapLibreWebMcpToolName,
    input: unknown,
    signal: AbortSignal,
  ): Promise<CapabilityResult<unknown>> => {
    const startedAt = resolvedDependencies.now();
    const action = invocationAction(input);
    const identity = {
      toolName: name,
      ...(action === undefined ? {} : { action }),
    };
    emit({ phase: 'started', ...identity, startedAt });
    const durationMs = (): number => Math.max(
      0,
      resolvedDependencies.now() - startedAt,
    );

    try {
      if (options.authorizeInvocation !== undefined) {
        let authorized = false;
        try {
          authorized = await options.authorizeInvocation({
            toolName: name,
            input,
            readOnly: readOnlyTool(name),
          });
        } catch {
          authorized = false;
        }
        if (!authorized) {
          const result = authorizationDenied();
          emit({
            phase: 'failed',
            ...identity,
            durationMs: durationMs(),
            message: result.message,
            code: result.error.code,
          });
          return result;
        }
      }

      const authority = await resolveAuthority();
      const result = authority === null
        ? mapNotReady()
        : await resolvedDependencies.dispatchCapability(name, authority, input, signal);
      if (result.success) {
        emit({
          phase: 'succeeded',
          ...identity,
          durationMs: durationMs(),
          message: result.message,
        });
      } else {
        emit({
          phase: 'failed',
          ...identity,
          durationMs: durationMs(),
          message: result.message,
          code: result.error.code,
        });
      }
      return result;
    } catch (error) {
      if (signal.aborted) {
        emit({ phase: 'aborted', ...identity, durationMs: durationMs() });
      } else {
        emit({
          phase: 'errored',
          ...identity,
          durationMs: durationMs(),
          message: UNEXPECTED_INVOCATION_MESSAGE,
        });
      }
      throw error;
    }
  };

  return {
    execute: (name, input, signal) => enqueue(
      signal,
      () => invoke(name, input, signal),
    ),
    close: () => {
      closed = true;
    },
  };
}
