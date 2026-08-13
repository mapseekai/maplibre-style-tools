import { createStyleToolError } from '../core/index.js';
import type { BridgeCapability, BridgeCommand } from './protocol.js';

export function requiredCapabilityForCommand(command: BridgeCommand): BridgeCapability {
  switch (command.type) {
    case 'getStyle':
    case 'listImages':
      return 'style.read';
    case 'applyTransaction':
      return 'style.write';
    case 'querySourceFeatures':
    case 'queryRenderedFeatures':
      return 'features.query';
    case 'setFeatureState':
    case 'removeFeatureState':
    case 'setGlobalState':
      return 'runtime.state';
    case 'addImage':
    case 'removeImage':
      return 'images.write';
  }
}

export function assertCapability(
  capabilities: readonly BridgeCapability[],
  command: BridgeCommand,
): void {
  const requiredCapability = requiredCapabilityForCommand(command);
  if (!capabilities.includes(requiredCapability)) {
    throw createStyleToolError(
      'CAPABILITY_DENIED',
      'Bridge capability denied.',
      undefined,
      { commandType: command.type, requiredCapability },
    );
  }
}
