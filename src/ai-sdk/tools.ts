import type {
  CreateMapLibreStyleToolsOptions,
  MapLibreStyleTools,
} from './contracts.js';
import { createInspectStyleTool } from './inspect.js';
import { createApplyStyleTransactionTool, createApplyStyleDocumentTool } from './mutate.js';
import { createRunMapCommandTool, createQueryMapFeaturesTool } from './runtime.js';

export function createMapLibreStyleTools(
  options: CreateMapLibreStyleToolsOptions,
): MapLibreStyleTools {
  return {
    inspectStyle: createInspectStyleTool(options),
    applyStyleTransaction: createApplyStyleTransactionTool(options),
    applyStyleDocument: createApplyStyleDocumentTool(options),
    runMapCommand: createRunMapCommandTool(options),
    queryMapFeatures: createQueryMapFeaturesTool(options),
  };
}
