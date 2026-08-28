import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PendingMapCommentStore,
  type FeatureReference,
  type PendingMapComment,
  type PendingMapCommentInput,
} from './comment-targets.js';

const mutableFeature = () => ({
  layerId: 'places-fill',
  sourceId: 'places',
  featureId: 1,
  lngLat: [0, 0] as [number, number],
  properties: { class: 'park', name: 'original' } as Record<string, string>,
});

const feature = mutableFeature() satisfies FeatureReference;
const withoutId = { ...feature, featureId: undefined };
const featureTarget = { comment: 'Feature comment', scope: 'feature' as const, feature };
const layerTarget = { comment: 'Layer comment', scope: 'layer' as const, feature };
const createStore = (
  ids: string[] = ['map-selection-a', 'map-selection-b', 'map-selection-c'],
  capacity = 20,
  onRemove?: (comment: PendingMapComment) => void,
) => new PendingMapCommentStore({
  capacity,
  idFactory: () => ids.shift() ?? 'map-selection-exhausted',
  onRemove,
});

test('feature scope requires a stable feature id', () => {
  const store = createStore();
  assert.throws(() => store.add({ comment: 'Feature comment', scope: 'feature', feature: withoutId } as unknown as PendingMapCommentInput), /feature ID/u);
});

test('property class accepts only scalar properties', () => {
  const store = createStore();
  assert.throws(() => store.add({
    comment: 'Property comment',
    scope: 'property-class',
    feature,
    selector: {
      property: 'nested',
      value: { unsafe: true } as unknown as string,
    },
  }), /scalar/u);
});

test('property class requires an exact own projected scalar property match', () => {
  const store = createStore(['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']);
  const propertyInput = (property: string, value: string | number | boolean | null): PendingMapCommentInput => ({
    comment: 'Property comment', scope: 'property-class', feature: mutableFeature(), selector: { property, value },
  });

  assert.throws(() => store.add(propertyInput('missing', 'park')), /projected feature property/u);
  assert.throws(() => store.add(propertyInput('class', '1')), /match/u);
  assert.throws(() => store.add(propertyInput('class', Number.NaN as unknown as number)), /scalar/u);
  for (const [value, properties] of [
    [null, { value: null }],
    [true, { value: true }],
    [7, { value: 7 }],
    ['park', { value: 'park' }],
  ] as const) {
    const pending = store.add({
      comment: 'Property comment',
      scope: 'property-class',
      feature: { ...mutableFeature(), properties },
      selector: { property: 'value', value },
    });
    assert.equal(pending.scope, 'property-class');
  }
});

test('stores trimmed comments and immutable feature snapshots', () => {
  const feature = mutableFeature();
  const pending = createStore().add({
    comment: '  Make this layer quieter.  ', scope: 'layer', feature,
  });
  feature.properties.name = 'changed';

  assert.equal(pending.comment, 'Make this layer quieter.');
  assert.equal(pending.feature.properties.name, 'original');
  assert.throws(() => { (pending as { comment: string }).comment = 'changed'; });
});

test('accepts exact bounds and rejects comments outside them', () => {
  const store = createStore();
  assert.equal(store.add({ comment: 'x', scope: 'layer', feature: mutableFeature() }).comment, 'x');
  assert.equal(store.add({ comment: 'x'.repeat(1_000), scope: 'layer', feature: mutableFeature() }).comment.length, 1_000);
  assert.throws(() => store.add({ comment: '   ', scope: 'layer', feature: mutableFeature() }), /non-empty/u);
  assert.throws(() => store.add({ comment: 'x'.repeat(1_001), scope: 'layer', feature: mutableFeature() }), /1,000/u);
});

test('accepts selection IDs through 128 characters and rejects 129', () => {
  const shortest = 'a';
  const longest = 'b'.repeat(128);
  const tooLong = 'c'.repeat(129);
  const store = createStore([shortest, longest, tooLong]);

  assert.equal(store.add({ comment: 'One', scope: 'layer', feature: mutableFeature() }).selectionId, shortest);
  assert.equal(store.add({ comment: 'Two', scope: 'layer', feature: mutableFeature() }).selectionId, longest);
  assert.throws(() => store.add({ comment: 'Three', scope: 'layer', feature: mutableFeature() }), /128/u);
});

test('rejects capacity without evicting or reusing an issued id', () => {
  const store = createStore(['map-selection-a', 'map-selection-b', 'map-selection-a'], 2);
  const first = store.add({ comment: 'One', scope: 'layer', feature: mutableFeature() });
  store.add({ comment: 'Two', scope: 'layer', feature: mutableFeature() });
  assert.throws(() => store.add({ comment: 'Three', scope: 'layer', feature: mutableFeature() }), /capacity/u);
  assert.equal(store.get(first.selectionId), first);

  store.remove('map-selection-a');
  assert.throws(() => store.add({ comment: 'Reused', scope: 'layer', feature: mutableFeature() }), /already issued/u);
});

test('preserves exact whitespace-bearing layer, source, source-layer, and property identities', () => {
  const store = createStore();
  const target = store.add({
    comment: 'Identity comment',
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
    comment: 'Feature comment',
    scope: 'feature',
    feature: { ...feature, featureId: '   ' },
  });

  assert.equal(target.feature.featureId, '   ');
});

test('update keeps the selection identity and revalidates the comment', () => {
  const store = createStore();
  const added = store.add(featureTarget);

  const updated = store.update(added.selectionId, { comment: 'Rewritten comment', scope: 'feature', feature });

  assert.equal(updated.selectionId, added.selectionId);
  assert.equal(updated.comment, 'Rewritten comment');
  assert.equal(store.get(added.selectionId)?.comment, 'Rewritten comment');
  assert.throws(() => store.update('unknown', featureTarget), /unknown/u);
  assert.throws(() => store.update(added.selectionId, { comment: '   ', scope: 'feature', feature }), /non-empty/u);
  assert.equal(store.get(added.selectionId)?.comment, 'Rewritten comment');
});

test('submitAll locks edits and removes while keeping contexts consumable', () => {
  const store = createStore();
  const one = store.add(featureTarget);
  const two = store.add(layerTarget);

  const submitted = store.submitAll();

  assert.deepEqual(submitted.map((item) => item.selectionId), [one.selectionId, two.selectionId]);
  assert.equal(store.isSubmitted(one.selectionId), true);
  assert.equal(store.size, 2);
  assert.throws(() => store.update(one.selectionId, layerTarget), /submitted/u);
  assert.equal(store.remove(one.selectionId), false);
  assert.equal(store.get(one.selectionId)?.comment, 'Feature comment');

  const consumed = store.consumeMany([one.selectionId, two.selectionId]);
  assert.equal(consumed.length, 2);
  assert.equal(store.size, 0);
  assert.equal(store.isSubmitted(one.selectionId), false);
});

test('onChange fires for add, update, submit, remove, consume, and clear', () => {
  let changes = 0;
  let issued = 0;
  const store = new PendingMapCommentStore({
    capacity: 20,
    idFactory: () => `map-selection-${(issued += 1)}`,
    onChange: () => { changes += 1; },
  });
  const added = store.add(featureTarget);
  store.update(added.selectionId, layerTarget);
  store.submitAll();
  assert.equal(changes, 3);

  store.consumeMany([added.selectionId]);
  assert.equal(changes, 4);

  const second = store.add(featureTarget);
  assert.equal(changes, 5);
  store.remove(second.selectionId);
  assert.equal(changes, 6);
  store.add(featureTarget);
  assert.equal(changes, 7);
  store.clear();
  assert.equal(changes, 8);
  store.clear();
  assert.equal(changes, 8);
});

test('consumeMany returns contexts and removes their UI state atomically', () => {
  let removed = 0;
  const store = createStore(undefined, 20, () => { removed += 1; });
  const one = store.add(featureTarget);
  const two = store.add(layerTarget);

  const result = store.consumeMany([one.selectionId, two.selectionId]);

  assert.deepEqual(result.map((item) => item.selectionId), [one.selectionId, two.selectionId]);
  assert.equal(store.size, 0);
  assert.equal(removed, 2);
});

test('consumeSubmitted consumes only submitted comments and keeps pending ones editable', () => {
  let changes = 0;
  const store = new PendingMapCommentStore({
    capacity: 20,
    idFactory: (() => { let next = 0; return () => `map-selection-${(next += 1)}`; })(),
    onChange: () => { changes += 1; },
  });
  const first = store.add(featureTarget);
  const second = store.add(layerTarget);
  const submitted = store.submitAll();
  assert.deepEqual(submitted.map((comment) => comment.selectionId), [first.selectionId, second.selectionId]);
  const reopened = store.add(featureTarget);
  assert.equal(changes, 4);

  const consumed = store.consumeSubmitted();

  assert.deepEqual(consumed.map((comment) => comment.selectionId), [first.selectionId, second.selectionId]);
  assert.equal(store.size, 1);
  assert.equal(store.get(reopened.selectionId), reopened);
  assert.equal(store.isSubmitted(reopened.selectionId), false);
  assert.equal(changes, 5);
  assert.deepEqual(store.consumeSubmitted(), []);
  assert.equal(changes, 5);
});

test('consumeMany rejects duplicate or unknown ids without deleting any target', () => {
  let removed = 0;
  const store = createStore(undefined, 20, () => { removed += 1; });
  const one = store.add(featureTarget);
  const two = store.add(layerTarget);

  assert.throws(() => store.consumeMany([one.selectionId, 'unknown']), /unknown/u);
  assert.equal(store.get(one.selectionId), one);
  assert.equal(store.get(two.selectionId), two);
  assert.equal(removed, 0);
  assert.throws(() => store.consumeMany([one.selectionId, one.selectionId]), /unique/u);
  assert.equal(store.get(one.selectionId), one);
  assert.equal(store.get(two.selectionId), two);
  assert.equal(removed, 0);
});
