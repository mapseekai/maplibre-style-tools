import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  StyleDocument as PublicStyleDocument,
  StyleLayer as PublicStyleLayer,
} from './index.js';

type PublicJsonObject = Record<string, unknown>;

const readPublicLayerMetadata = (
  layer: PublicStyleLayer,
): PublicJsonObject | undefined => layer.metadata;

test('public StyleLayer preserves JSON object metadata compatibility', () => {
  const style: PublicStyleDocument = {
    version: 8,
    sources: {},
    layers: [{ id: 'background', type: 'background', metadata: { owner: 'maps' } }],
  };
  const layer = style.layers[0];
  assert.ok(layer);
  const metadata: PublicJsonObject | undefined = readPublicLayerMetadata(layer);
  assert.deepEqual(metadata, { owner: 'maps' });
});
