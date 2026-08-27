import { createWebMcpExecutionBoundary } from './execution.js';
import { createMapLibreWebMcpToolDefinitions } from './tool-definitions.js';
import type {
  MapLibreWebMcpRegistration,
  RegisterMapLibreWebMcpToolsOptions,
  WebMcpModelContextLike,
} from './types.js';

type WebMcpDocument = Document & { readonly modelContext?: WebMcpModelContextLike };

const resolveDocument = (documentValue?: Document): Document | undefined =>
  documentValue ?? (typeof document === 'undefined' ? undefined : document);

const modelContextFor = (documentValue?: Document): WebMcpModelContextLike | undefined => {
  const candidate = resolveDocument(documentValue);
  return candidate === undefined ? undefined : (candidate as WebMcpDocument).modelContext;
};

export function isWebMcpSupported(documentValue?: Document): boolean {
  return typeof modelContextFor(documentValue)?.registerTool === 'function';
}

const normalizeExposedTo = (
  exposedTo: readonly string[] | undefined,
): readonly string[] | undefined => {
  if (exposedTo === undefined) return undefined;
  const normalized = exposedTo.map((value) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new TypeError('WebMCP exposedTo entries must be secure origins.');
    }
    if (url.protocol !== 'https:' || url.origin !== value) {
      throw new TypeError('WebMCP exposedTo entries must be secure origins.');
    }
    return url.origin;
  });
  return Object.freeze(normalized);
};

const unsupportedRegistration = (): MapLibreWebMcpRegistration => ({
  supported: false,
  toolNames: [],
  close: () => {},
});

export async function registerMapLibreWebMcpTools(
  options: RegisterMapLibreWebMcpToolsOptions,
): Promise<MapLibreWebMcpRegistration> {
  const documentValue = resolveDocument(options.document);
  const modelContext = modelContextFor(documentValue);
  if (typeof modelContext?.registerTool !== 'function') return unsupportedRegistration();

  const exposedTo = normalizeExposedTo(options.exposedTo);
  if (options.signal?.aborted) throw options.signal.reason;

  const normalizedOptions: RegisterMapLibreWebMcpToolsOptions = {
    ...options,
    ...(documentValue === undefined ? {} : { document: documentValue }),
    allowMutations: options.allowMutations === true,
    ...(exposedTo === undefined ? {} : { exposedTo }),
  };
  const execution = createWebMcpExecutionBoundary(normalizedOptions);
  const tools = createMapLibreWebMcpToolDefinitions({
    allowMutations: normalizedOptions.allowMutations === true,
    execute: execution.execute,
  });
  const controller = new AbortController();
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    if (!controller.signal.aborted) controller.abort();
    execution.close();
  };

  options.signal?.addEventListener('abort', close, { once: true });

  const throwIfClosed = (): void => {
    if (!closed && !controller.signal.aborted) return;
    throw options.signal?.aborted ? options.signal.reason : controller.signal.reason;
  };

  try {
    for (const tool of tools) {
      throwIfClosed();
      await modelContext.registerTool(tool, {
        signal: controller.signal,
        ...(exposedTo === undefined ? {} : { exposedTo: [...exposedTo] }),
      });
      throwIfClosed();
    }
  } catch (error) {
    close();
    if (options.signal?.aborted) throw options.signal.reason;
    throw error;
  }

  return {
    supported: true,
    toolNames: tools.map((tool) => tool.name),
    close,
  };
}
