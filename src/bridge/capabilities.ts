import { createStyleToolError } from '../core/index.js';
import type { BridgeCapability, BridgeCommand } from './protocol.js';

export function requiredCapabilityForCommand(command: BridgeCommand): BridgeCapability {
  switch (command.type) {
    case 'getStyle':
    case 'listImages':
    case 'listSprites':
      return 'style.read';
    case 'applyTransaction':
    case 'applyStyleDocument':
    case 'updateGeoJsonData':
      return 'style.write';
    case 'querySourceFeatures':
    case 'queryRenderedFeatures':
      return 'features.query';
    case 'setFeatureState':
    case 'removeFeatureState':
    case 'setGlobalState':
    case 'setSourceTileLodParams':
      return 'runtime.state';
    case 'addImage':
    case 'removeImage':
    case 'addSprite':
    case 'removeSprite':
      return 'assets.write';
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
