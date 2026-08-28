import { createWebMcpExecutionBoundary } from './execution.js';
import { createMapLibreWebMcpToolDefinitions } from './tool-definitions.js';
import type {
  MapLibreWebMcpRegistration,
  RegisterMapLibreWebMcpToolsOptions,
  WebMcpModelContextLike,
} from './types.js';

type WebMcpDocument = Document & { readonly modelContext?: WebMcpModelContextLike };
type WebMcpNavigator = Navigator & { readonly modelContext?: WebMcpModelContextLike };

const resolveDocument = (documentValue?: Document): Document | undefined =>
  documentValue ?? (typeof document === 'undefined' ? undefined : document);

export const resolveWebMcpModelContext = (documentValue?: Document): WebMcpModelContextLike | undefined => {
  const explicit = documentValue === undefined
    ? undefined
    : (documentValue as WebMcpDocument).modelContext;
  if (explicit !== undefined) return explicit;
  if (documentValue === undefined && typeof document !== 'undefined') {
    const fromDocument = (document as WebMcpDocument).modelContext;
    if (fromDocument !== undefined) return fromDocument;
  }
  if (typeof navigator !== 'undefined') {
    const fromNavigator = (navigator as WebMcpNavigator).modelContext;
    if (fromNavigator !== undefined) return fromNavigator;
  }
  return undefined;
};

export function isWebMcpSupported(documentValue?: Document): boolean {
  return typeof resolveWebMcpModelContext(documentValue)?.registerTool === 'function';
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
    const loopbackHttp = url.protocol === 'http:' && (
      url.hostname === 'localhost'
      || /^127(?:\.\d{1,3}){3}$/u.test(url.hostname)
      || url.hostname === '[::1]'
    );
    if ((url.protocol !== 'https:' && !loopbackHttp) || url.origin !== value) {
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
  const modelContext = resolveWebMcpModelContext(options.document);
  if (typeof modelContext?.registerTool !== 'function') return unsupportedRegistration();

  const documentValue = resolveDocument(options.document);
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
