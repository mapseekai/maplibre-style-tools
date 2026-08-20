import type { LiveMapRegistry } from '../bridge/registry.js';
import {
  liveMapResourceUriAdmission,
  registerLiveMapResources,
} from './live-resources.js';
import type { McpServerExtension } from './server-extension.js';

export function createLiveMapMcpExtension(registry: LiveMapRegistry): McpServerExtension {
  return (server, context) => {
    context.setLiveMapRegistry(registry);
    context.registerResourceUriAdmission(liveMapResourceUriAdmission);
    registerLiveMapResources(server, registry, context);
    return undefined;
  };
}
