import {
  INSPECT_STYLE_DESCRIPTION,
  executeInspectStyle,
} from './inspect.js';
import {
  APPLY_STYLE_DOCUMENT_DESCRIPTION,
  APPLY_STYLE_TRANSACTION_DESCRIPTION,
  executeApplyStyleDocument,
  executeApplyStyleTransaction,
} from './mutate.js';
import {
  QUERY_MAP_FEATURES_DESCRIPTION,
  RUN_MAP_COMMAND_DESCRIPTION,
  executeQueryMapFeatures,
  executeRunMapCommand,
} from './runtime.js';
import {
  applyStyleDocumentInputSchema,
  applyStyleTransactionToolInputSchema,
  inspectStyleInputSchema,
  queryMapFeaturesInputSchema,
  runMapCommandInputSchema,
} from './schemas.js';

export const capabilityRegistry = {
  inspectStyle: {
    description: INSPECT_STYLE_DESCRIPTION,
    inputSchema: inspectStyleInputSchema,
    requiresRuntime: false,
    execute: executeInspectStyle,
  },
  applyStyleTransaction: {
    description: APPLY_STYLE_TRANSACTION_DESCRIPTION,
    inputSchema: applyStyleTransactionToolInputSchema,
    requiresRuntime: false,
    execute: executeApplyStyleTransaction,
  },
  applyStyleDocument: {
    description: APPLY_STYLE_DOCUMENT_DESCRIPTION,
    inputSchema: applyStyleDocumentInputSchema,
    requiresRuntime: false,
    execute: executeApplyStyleDocument,
  },
  runMapCommand: {
    description: RUN_MAP_COMMAND_DESCRIPTION,
    inputSchema: runMapCommandInputSchema,
    requiresRuntime: true,
    execute: executeRunMapCommand,
  },
  queryMapFeatures: {
    description: QUERY_MAP_FEATURES_DESCRIPTION,
    inputSchema: queryMapFeaturesInputSchema,
    requiresRuntime: true,
    execute: executeQueryMapFeatures,
  },
} as const;

export type CapabilityName = keyof typeof capabilityRegistry;
