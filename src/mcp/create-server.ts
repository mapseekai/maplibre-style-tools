import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  createStyleToolError,
  isStyleToolError,
} from '../core/index.js';
import { createDocumentToolHandlers } from './document-handlers.js';
import {
  assertInboundMcpFraming,
  createBoundedMcpTransport,
  createInboundMcpFramingContext,
  createMcpResponseBoundary,
  createResourceUriAdmissionRegistry,
  resolveMcpMessagePolicy,
  type FrozenResourceUriAdmissions,
  type InboundMcpFramingContext,
  type McpResponseBoundary,
  type ResourceUriAdmissionRegistry,
} from './message-boundary.js';
import { createResourceResolver } from './resources.js';
import {
  assertFactoryStyleSessionStore,
  createStyleSessionStore,
  type StyleSessionStore,
} from './session-store.js';
import {
  createMcpServerExtension,
  type McpServerExtension,
  type McpServerExtensionContext,
} from './server-extension.js';
import type {
  McpMessagePolicy,
  StyleSessionStoreOptions,
} from './types.js';
import { MCP_SERVER_VERSION } from './version.generated.js';

type McpTransport = Parameters<McpServer['connect']>[0];
type TerminalHandler = (error: unknown) => void | Promise<void>;

const factoryError = (message: string, reason: string) => createStyleToolError(
  'INVALID_INPUT', message, undefined, { reason },
);

export interface CreateMapLibreStyleMcpServerOptions {
  readonly extensions?: readonly McpServerExtension[];
  readonly store?: StyleSessionStore;
  readonly storeOptions?: StyleSessionStoreOptions;
  readonly maxMessageBytes?: number;
}

export interface CreatedMapLibreStyleMcpServer {
  readonly server: McpServer;
  readonly store: StyleSessionStore;
  readonly messagePolicy: McpMessagePolicy;
  connect(rawTransport: McpTransport, onTerminal?: TerminalHandler): Promise<void>;
  close(): Promise<void>;
}

export interface ServerCompositionDependencies {
  readonly resolveMessagePolicy: typeof resolveMcpMessagePolicy;
  readonly responseBoundaryFactory: typeof createMcpResponseBoundary;
  readonly storeFactory: typeof createStyleSessionStore;
  readonly serverFactory: (info: { name: string; version: string }) => McpServer;
  readonly handlerFactory: typeof createDocumentToolHandlers;
  readonly resourceFactory: typeof createResourceResolver;
  readonly resourceAdmissionRegistryFactory: typeof createResourceUriAdmissionRegistry;
  readonly boundedTransportFactory: typeof createBoundedMcpTransport;
  readonly inboundContextFactory: typeof createInboundMcpFramingContext;
  readonly assertInboundFraming: typeof assertInboundMcpFraming;
}

export const defaultServerCompositionDependencies: ServerCompositionDependencies = Object.freeze({
  resolveMessagePolicy: resolveMcpMessagePolicy,
  responseBoundaryFactory: createMcpResponseBoundary,
  storeFactory: createStyleSessionStore,
  serverFactory: (info: { name: string; version: string }) => new McpServer(info),
  handlerFactory: createDocumentToolHandlers,
  resourceFactory: createResourceResolver,
  resourceAdmissionRegistryFactory: createResourceUriAdmissionRegistry,
  boundedTransportFactory: createBoundedMcpTransport,
  inboundContextFactory: createInboundMcpFramingContext,
  assertInboundFraming: assertInboundMcpFraming,
});

export const createOwnedClose = (
  closeServer: () => void | Promise<void>,
  disposeOwnedStore?: () => void,
): (() => Promise<void>) => {
  let latched: Promise<void> | undefined;
  return (): Promise<void> => {
    if (latched !== undefined) return latched;
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    latched = new Promise<void>((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    let serverClose: void | Promise<void>;
    try {
      serverClose = closeServer();
    } catch (error: unknown) {
      serverClose = Promise.reject(error);
    }
    void Promise.resolve(serverClose).then(
      () => {
        try {
          disposeOwnedStore?.();
          resolve();
        } catch (error: unknown) {
          reject(error);
        }
      },
      (primary: unknown) => {
        try {
          disposeOwnedStore?.();
        } catch {
          // Protocol close remains the primary failure.
        }
        reject(primary);
      },
    );
    return latched;
  };
};

type ServerLifecycleState =
  | 'composing'
  | 'new'
  | 'connecting'
  | 'connected'
  | 'closing'
  | 'closed';

interface ServerLifecycle {
  readonly connect: CreatedMapLibreStyleMcpServer['connect'];
  readonly close: CreatedMapLibreStyleMcpServer['close'];
  readonly state: ServerLifecycleState;
  finishComposition(inboundContext: InboundMcpFramingContext): void;
  abortComposition(): void;
}

const createServerLifecycle = (options: {
  readonly sdkProtocolConnect: (transport: McpTransport) => Promise<void>;
  readonly sdkProtocolClose: () => Promise<void>;
  readonly disposeOwnedStore?: () => void;
  readonly makeBoundedTransport: (
    raw: McpTransport,
    inbound: InboundMcpFramingContext,
    terminal: TerminalHandler,
  ) => McpTransport;
}): ServerLifecycle => {
  let state: ServerLifecycleState = 'composing';
  let inboundContext: InboundMcpFramingContext | undefined;
  let connectPromise: Promise<void> | undefined;

  const ownedClose = createOwnedClose(
    options.sdkProtocolClose,
    options.disposeOwnedStore,
  );

  const close = (): Promise<void> => {
    if (state === 'closed') return ownedClose();
    state = 'closing';
    const closing = ownedClose();
    void closing.then(
      () => { state = 'closed'; },
      () => { state = 'closed'; },
    );
    return closing;
  };

  const rejectClosedTransport = async (raw: McpTransport, reason: string): Promise<never> => {
    try {
      await raw.close();
    } catch {
      // The stable lifecycle error remains authoritative.
    }
    throw factoryError('The MCP server is closed.', reason);
  };

  const connect = (
    raw: McpTransport,
    onTerminal: TerminalHandler = () => undefined,
  ): Promise<void> => {
    if (state === 'composing') {
      return rejectClosedTransport(raw, 'serverCompositionInProgress');
    }
    if (state === 'closing' || state === 'closed') {
      return rejectClosedTransport(raw, 'serverClosed');
    }
    if (state === 'connecting' || state === 'connected' || inboundContext === undefined) {
      return rejectClosedTransport(raw, 'serverAlreadyConnected');
    }
    state = 'connecting';
    const bounded = options.makeBoundedTransport(
      raw,
      inboundContext,
      async (error) => {
        try {
          await onTerminal(error);
        } finally {
          try {
            await close();
          } catch {
            // Terminal cleanup failures are consumed by the bounded latch.
          }
        }
      },
    );
    const operation = (async () => {
      try {
        await options.sdkProtocolConnect(bounded);
        if (state !== 'connecting') {
          try {
            await close();
          } catch {
            // Closing won the race; its stable state error is authoritative here.
          }
          throw factoryError('The MCP server is closed.', 'serverClosed');
        }
        state = 'connected';
      } catch (error: unknown) {
        try {
          await close();
        } catch {
          // Connect's primary failure remains authoritative.
        }
        throw error;
      }
    })();
    connectPromise = operation;
    return operation;
  };

  return {
    connect,
    close,
    get state() { return state; },
    finishComposition(context) {
      if (state !== 'composing') {
        throw factoryError('MCP server composition is invalid.', 'serverCompositionState');
      }
      inboundContext = context;
      state = 'new';
    },
    abortComposition() {
      if (state === 'closed') return;
      void close().catch(() => undefined);
      void connectPromise?.catch(() => undefined);
    },
  };
};

const sealServerCapabilities = (
  server: McpServer,
  capabilities: Pick<CreatedMapLibreStyleMcpServer, 'connect' | 'close'>,
): void => {
  for (const target of [server, server.server]) {
    Object.defineProperty(target, 'connect', {
      configurable: false,
      enumerable: false,
      writable: false,
      value: capabilities.connect,
    });
    Object.defineProperty(target, 'close', {
      configurable: false,
      enumerable: false,
      writable: false,
      value: capabilities.close,
    });
  }
};

const internalResourceFailure = () => createStyleToolError(
  'INTERNAL', 'The resource failed internally.',
);

const createExtensionContext = (
  messagePolicy: McpMessagePolicy,
  responseBoundary: McpResponseBoundary,
  register: ResourceUriAdmissionRegistry['register'],
): McpServerExtensionContext => Object.freeze({
  messagePolicy,
  responseBoundary,
  registerResourceUriAdmission: register,
  guardResourceHandler: <Args extends unknown[], Result>(
    handler: (...args: Args) => Result | Promise<Result>,
  ) => async (...args: Args): Promise<Result> => {
    try {
      return responseBoundary.requireResourceResult(await handler(...args));
    } catch (error: unknown) {
      throw responseBoundary.requireResourceFailure(
        isStyleToolError(error) ? error : internalResourceFailure(),
      );
    }
  },
});

const rejectInvalidExtensionReturn = (returned: unknown): never => {
  if ((typeof returned === 'object' && returned !== null) || typeof returned === 'function') {
    try {
      const then = Reflect.get(returned, 'then');
      if (typeof then === 'function') {
        void Promise.resolve(returned).catch(() => undefined);
      }
    } catch {
      // Hostile then access is normalized below.
    }
  }
  throw factoryError('MCP extensions must be synchronous.', 'asyncMcpExtension');
};

interface CreatedMcpInboundCapability {
  readonly messagePolicy: McpMessagePolicy;
  readonly inboundContext: InboundMcpFramingContext;
  readonly assertInbound: typeof assertInboundMcpFraming;
  readonly isLive: () => boolean;
}

const createdMcpInboundCapabilities = new WeakMap<object, CreatedMcpInboundCapability>();

const invalidMcpServerHandle = (): never => {
  throw factoryError('Invalid MCP server handle.', 'invalidMcpServerHandle');
};

export const preflightCreatedMcpInbound = (
  created: unknown,
  parsedMessage: unknown,
): void => {
  if ((typeof created !== 'object' || created === null) && typeof created !== 'function') {
    invalidMcpServerHandle();
  }
  const capability = createdMcpInboundCapabilities.get(created as object)
    ?? invalidMcpServerHandle();
  if (!capability.isLive()) invalidMcpServerHandle();
  capability.assertInbound(parsedMessage, capability.messagePolicy, capability.inboundContext);
};

export const createMapLibreStyleMcpServerWithDependencies = (
  options: CreateMapLibreStyleMcpServerOptions,
  dependencies: ServerCompositionDependencies,
  preResolvedPolicy?: McpMessagePolicy,
  inboundByteAuthority: 'canonical' | 'transport-prebounded' = 'canonical',
): CreatedMapLibreStyleMcpServer => {
  if (options.store !== undefined && options.storeOptions !== undefined) {
    throw factoryError('Choose either store or storeOptions.', 'conflictingStoreOptions');
  }
  const messagePolicy = preResolvedPolicy
    ?? dependencies.resolveMessagePolicy({ maxMessageBytes: options.maxMessageBytes });
  const responseBoundary = dependencies.responseBoundaryFactory(messagePolicy);
  const ownsStore = options.store === undefined;
  const store = assertFactoryStyleSessionStore(
    options.store ?? dependencies.storeFactory(options.storeOptions),
  );

  let server: McpServer;
  try {
    server = dependencies.serverFactory({
      name: 'maplibre-style-mcp-server',
      version: MCP_SERVER_VERSION,
    });
  } catch (error: unknown) {
    if (ownsStore) store.dispose();
    throw error;
  }

  const sdkProtocolConnect = server.server.connect.bind(server.server);
  const sdkProtocolClose = server.server.close.bind(server.server);
  const lifecycle = createServerLifecycle({
    sdkProtocolConnect,
    sdkProtocolClose,
    ...(ownsStore ? { disposeOwnedStore: () => store.dispose() } : {}),
    makeBoundedTransport: (raw, inbound, terminal) =>
      dependencies.boundedTransportFactory(raw, messagePolicy, inbound, terminal),
  });
  sealServerCapabilities(server, lifecycle);
  const admissionRegistry = dependencies.resourceAdmissionRegistryFactory();
  const extensionContext = createExtensionContext(
    messagePolicy,
    responseBoundary,
    admissionRegistry.register.bind(admissionRegistry),
  );

  try {
    const handlers = dependencies.handlerFactory(store, responseBoundary);
    const resources = dependencies.resourceFactory(store, responseBoundary);
    const extensions = [
      createMcpServerExtension({ handlers, resources }),
      ...(options.extensions ?? []),
    ];
    for (const extension of extensions) {
      const returned: unknown = extension(server, extensionContext);
      if (returned !== undefined) rejectInvalidExtensionReturn(returned);
    }
    const frozenAdmissions: FrozenResourceUriAdmissions = admissionRegistry.freeze();
    const inboundContext = dependencies.inboundContextFactory({
      admissions: frozenAdmissions,
      totalBytesAlreadyBounded: inboundByteAuthority === 'transport-prebounded',
    });
    lifecycle.finishComposition(inboundContext);
    const created = Object.freeze({
      server,
      store,
      messagePolicy,
      connect: lifecycle.connect,
      close: lifecycle.close,
    });
    createdMcpInboundCapabilities.set(created, {
      messagePolicy,
      inboundContext,
      assertInbound: dependencies.assertInboundFraming,
      isLive: () => lifecycle.state === 'new'
        || lifecycle.state === 'connecting'
        || lifecycle.state === 'connected',
    });
    return created;
  } catch (error: unknown) {
    admissionRegistry.abort();
    lifecycle.abortComposition();
    throw error;
  }
};

export const createMapLibreStyleMcpServer = (
  options: CreateMapLibreStyleMcpServerOptions = {},
): CreatedMapLibreStyleMcpServer => createMapLibreStyleMcpServerWithDependencies(
  options,
  defaultServerCompositionDependencies,
);
