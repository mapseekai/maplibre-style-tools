import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMapLibreStyleTools } from './ai/index.js';
import type {
  AiStyleToolResult,
  ApplyStyleDocumentInput,
  ApplyStyleTransactionInput,
  CreateMapLibreStyleToolsOptions,
  FeatureQueryProjection,
  InspectStyleInput,
  MapCommandReceipt,
  MapLibreAiTool,
  MapLibreStyleTools,
  QueryMapFeaturesInput,
  RunMapCommandInput,
  StyleMutationReceipt,
} from './ai/index.js';

// @ts-expect-error root AI factory was removed.
import type { createMapLibreStyleTools as RootFactory } from './index.js';
// @ts-expect-error root compact AI factory was removed.
import type { createCompactMapLibreStyleTools as RootCompactFactory } from './index.js';
// @ts-expect-error root AI options were removed.
import type { CreateMapLibreStyleToolsOptions as RootOptions } from './index.js';
// @ts-expect-error root style accessor was removed.
import type { StyleAccessor } from './index.js';
// @ts-expect-error root result wrapper was removed.
import type { ToolCallResult } from './index.js';
// @ts-expect-error root operation type was removed.
import type { StyleOperation } from './index.js';
// @ts-expect-error root operation result was removed.
import type { StyleOperationResult } from './index.js';
// @ts-expect-error compact AI factory was removed from /ai.
import type { createCompactMapLibreStyleTools } from './ai/index.js';
// @ts-expect-error removed AI name arrays remain unavailable.
import type { FULL_LEGACY_TOOL_NAMES } from './ai/index.js';
// @ts-expect-error removed parser module remains unavailable.
import type { parseStrictJson } from  './ai/compatibility.js';
// @ts-expect-error removed result converter remains unavailable.
import type { toAiToolResult } from './ai-sdk/result.js';
// The imports above intentionally fail to verify removed public exports. The type-only
// reference keeps their fixtures observable to ESLint without adding an extra public surface.
type RemovedPublicExports =
  | RootFactory
  | RootCompactFactory
  | RootOptions
  | StyleAccessor
  | ToolCallResult
  | StyleOperation
  | StyleOperationResult
  | createCompactMapLibreStyleTools
  | FULL_LEGACY_TOOL_NAMES
  | parseStrictJson
  | toAiToolResult;

void (null as unknown as RemovedPublicExports);


type NewAiSurface =
  | AiStyleToolResult<unknown>
  | ApplyStyleDocumentInput
  | ApplyStyleTransactionInput
  | CreateMapLibreStyleToolsOptions
  | FeatureQueryProjection
  | InspectStyleInput
  | MapCommandReceipt
  | MapLibreAiTool<InspectStyleInput, FeatureQueryProjection>
  | MapLibreStyleTools
  | QueryMapFeaturesInput
  | RunMapCommandInput
  | StyleMutationReceipt;

void createMapLibreStyleTools;
void (null as unknown as NewAiSurface);

test('keeps the unified /ai factory as the only AI public surface', async () => {
  const root = await import('./index.js');
  const ai = await import('./ai/index.js');
  assert.equal('createMapLibreStyleTools' in root, false);
  assert.equal('createCompactMapLibreStyleTools' in root, false);
  assert.deepEqual(Object.keys(ai), ['createMapLibreStyleTools']);
});
