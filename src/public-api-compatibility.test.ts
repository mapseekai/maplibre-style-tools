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
// @ts-expect-error root legacy AI options were removed.
import type { CreateMapLibreStyleToolsOptions as RootOptions } from './index.js';
// @ts-expect-error root legacy style accessor was removed.
import type { StyleAccessor } from './index.js';
// @ts-expect-error root legacy result wrapper was removed.
import type { ToolCallResult } from './index.js';
// @ts-expect-error root legacy operation type was removed.
import type { StyleOperation } from './index.js';
// @ts-expect-error root legacy operation result was removed.
import type { StyleOperationResult } from './index.js';
// @ts-expect-error compact AI factory was removed from /ai.
import type { createCompactMapLibreStyleTools } from './ai/index.js';
// @ts-expect-error legacy AI name arrays were removed.
import type { FULL_LEGACY_TOOL_NAMES } from './ai/index.js';
// @ts-expect-error legacy parser module was removed.
import type { parseStrictJson } from  './ai/compatibility.js';
// @ts-expect-error legacy result converter was removed.
import type { toAiToolResult } from './ai-sdk/result.js';
// The imports above intentionally fail to verify removed public exports. The type-only
// reference keeps their fixtures observable to ESLint without adding a compatibility surface.
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

test('removes legacy AI factories from root and exposes only the unified /ai factory', async () => {
  const root = await import('./index.js');
  const ai = await import('./ai/index.js');
  assert.equal('createMapLibreStyleTools' in root, false);
  assert.equal('createCompactMapLibreStyleTools' in root, false);
  assert.deepEqual(Object.keys(ai), ['createMapLibreStyleTools']);
});
