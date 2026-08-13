import type { LiveMapRegistry } from '../bridge/registry.js';
import {
  liveMapResourceUriAdmission,
  registerLiveMapResources,
} from './live-resources.js';
import { registerLiveMapTools } from './live-tools.js';
import type { McpServerExtension } from './server-extension.js';

export function createLiveMapMcpExtension(registry: LiveMapRegistry): McpServerExtension {
  return (server, context) => {
    context.registerResourceUriAdmission(liveMapResourceUriAdmission);
    registerLiveMapTools(server, registry, context);
    registerLiveMapResources(server, registry, context);
    return undefined;
  };
}
