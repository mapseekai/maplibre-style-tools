import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CommentTargetStore,
  type FeatureReference,
  type MapCommentTargetInput,
  type MapCommentTarget,
} from './comment-targets.js';

let nextId = 0;
const idFactory = () => `map-selection-${++nextId}`;
const feature = {
  layerId: 'places-fill',
  sourceId: 'places',
  featureId: 1,
  lngLat: [0, 0] as const,
  properties: { class: 'park', name: 'original' },
} satisfies FeatureReference;
const withoutId = { ...feature, featureId: undefined };
const featureTarget = { scope: 'feature' as const, feature };
const layerTarget = { scope: 'layer' as const, feature };
const createStore = (
  capacity = 20,
  onRemove?: (target: MapCommentTarget) => void,
) => new CommentTargetStore({ capacity, idFactory, onRemove });

test('feature scope requires a stable feature id', () => {
  const store = createStore();
  assert.throws(() => store.add({ scope: 'feature', feature: withoutId } as unknown as MapCommentTargetInput), /feature ID/u);
});

test('property class accepts only scalar properties', () => {
  const store = createStore();
  assert.throws(() => store.add({
    scope: 'property-class',
    feature,
    selector: {
      property: 'nested',
      value: { unsafe: true } as unknown as string,
    },
  }), /scalar/u);
});

test('created targets are immutable snapshots', () => {
  const store = createStore();
  const mutableFeature = structuredClone(feature);
  const target = store.add({ scope: 'layer', feature: mutableFeature });
  mutableFeature.properties.name = 'changed';
  assert.equal(target.feature.properties.name, 'original');
  assert.throws(() => { (target as { scope: string }).scope = 'feature'; });
});

test('capacity evicts the oldest unconsumed target', () => {
  const store = createStore(2);
  const first = store.add(layerTarget);
  store.add(layerTarget);
  store.add(layerTarget);
  assert.equal(store.get(first.selectionId), undefined);
});

test('preserves exact whitespace-bearing layer, source, source-layer, and property identities', () => {
  const store = createStore();
  const target = store.add({
    scope: 'property-class',
    feature: {
      ...feature,
      layerId: ' places-fill ',
      sourceId: ' places ',
      sourceLayer: ' districts ',
      properties: { ' name ': 'West Park' },
    },
    selector: { property: ' name ', value: 'West Park' },
  });

  assert.equal(target.feature.layerId, ' places-fill ');
  assert.equal(target.feature.sourceId, ' places ');
  assert.equal(target.feature.sourceLayer, ' districts ');
  assert.equal(target.scope, 'property-class');
  if (target.scope !== 'property-class') throw new Error('Expected property-class target.');
  assert.equal(target.selector.property, ' name ');
  assert.equal(target.feature.properties[' name '], 'West Park');
});

test('feature scope accepts a whitespace-only stable feature id', () => {
  const store = createStore();
  const target = store.add({
    scope: 'feature',
    feature: { ...feature, featureId: '   ' },
  });

  assert.equal(target.feature.featureId, '   ');
});
