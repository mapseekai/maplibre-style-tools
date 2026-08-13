import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import type { Map as MapLibreMap } from 'maplibre-gl';

import {
  applyPreparedStyleToMap,
  type PreparedMapStyleTransaction,
} from '../adapters/maplibre/index.js';
import type { JsonValue, StyleDocument } from '../core/index.js';

function compileOnlyOpaqueContract(
  opaquePrepared: PreparedMapStyleTransaction,
  map: MapLibreMap,
): void {
  void opaquePrepared.view.baselineHash;
  void opaquePrepared.view.transactionResult.style;
  // @ts-expect-error private authority is not a public top-level field
  void opaquePrepared.transactionResult;
  // @ts-expect-error private canonical baseline is not exported
  void opaquePrepared.baselineCanonical;
  // @ts-expect-error the public inspection graph cannot be mutated
  opaquePrepared.view.transactionResult.style.layers.push({ id: 'x', type: 'background' });
  // @ts-expect-error a DeepReadonly inspection value is not a mutable StyleDocument
  const mutableCandidate: StyleDocument = opaquePrepared.view.transactionResult.style;
  // @ts-expect-error a DeepReadonly inspection value is not mutable JsonValue
  const mutableJson: JsonValue = opaquePrepared.view.transactionResult.style;
  // @ts-expect-error phase two deliberately rejects transaction limits
  void applyPreparedStyleToMap(map, opaquePrepared, { maxStyleBytes: 1 });
  void mutableCandidate;
  void mutableJson;
}

void compileOnlyOpaqueContract;

test('browser runtime uses only the opaque prepared view and exact phase-two call', async () => {
  const source = await readFile(resolve('src/bridge/browser-runtime.ts'), 'utf8');
  assert.doesNotMatch(
    source,
    /prepared\.(?:transactionResult|baselineCanonical|baselineHash|candidateStyle)/u,
  );
  assert.doesNotMatch(
    source,
    /prepared\.view[\s\S]{0,120}\bas\s+(?:StyleDocument|JsonValue|unknown|never)\b/u,
  );
  assert.match(source, /applyPreparedStyleToMap\(map,\s*prepared,\s*\{\s*deadline:/u);
});
