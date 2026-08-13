import assert from 'node:assert/strict';
import test from 'node:test';

import type { StyleDocument } from '../core/index.js';
import { toolFailure, toolSuccess } from './output.js';
import {
  DOCUMENT_TOOL_NAMES,
  documentToolInputSchemas,
  documentToolResponseDataSchemas,
  parseDocumentToolSuccessData,
  styleAnalyzeGeoJsonInputSchema,
  styleApplyTransactionInputSchema,
  styleInspectInputSchema,
  styleValidateInputSchema,
} from './schemas.js';

const validStyle: StyleDocument = { version: 8, sources: {}, layers: [] };
const points = {
  type: 'FeatureCollection',
  features: [],
};

test('all eight tools own complete strict schemas with nested cross-field rules', () => {
  assert.deepEqual(Object.keys(documentToolInputSchemas), [...DOCUMENT_TOOL_NAMES]);
  assert.equal(DOCUMENT_TOOL_NAMES.length, 8);
  for (const schema of Object.values(documentToolInputSchemas)) {
    assert.equal(schema.safeParse({ unexpected: true }).success, false);
  }
  assert.equal(styleValidateInputSchema.safeParse({}).success, false);
  assert.equal(styleValidateInputSchema.safeParse({
    target: { kind: 'inline', style: validStyle, sessionId: 's1' },
  }).success, false);
  assert.equal(styleInspectInputSchema.safeParse({
    sessionId: 's1', selection: { view: 'layer', sourceId: 'wrong' },
  }).success, false);
  assert.equal(styleAnalyzeGeoJsonInputSchema.safeParse({
    target: { kind: 'inline', data: points, sessionId: 's1' },
  }).success, false);
});

test('apply leaves the transaction reference opaque while parsing its strict outer object', () => {
  const transaction = Object.freeze({ operations: 'not-yet-core-validated' });
  const parsed = styleApplyTransactionInputSchema.parse({
    sessionId: 's1', expectedRevision: 0, transaction,
  });
  assert.strictEqual(parsed.transaction, transaction);
  assert.equal(styleApplyTransactionInputSchema.safeParse({
    sessionId: 's1', expectedRevision: 0, transaction, extra: true,
  }).success, false);
});

test('command response schemas require command-specific success fields', () => {
  const open = parseDocumentToolSuccessData(
    'style_session_open',
    toolSuccess({ sessionId: 's1', revision: 0, expiresAt: 100 }).structuredContent,
  );
  assert.equal(open.sessionId, 's1');
  assert.equal(documentToolResponseDataSchemas.style_session_open.safeParse({
    sessionId: 's1', revision: 0,
  }).success, false);
  assert.throws(() => parseDocumentToolSuccessData(
    'style_session_open',
    toolFailure({ code: 'NOT_FOUND', message: 'missing' }).structuredContent,
  ));
});
