# WebMCP Map Comment Collaboration Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the standalone WebMCP example into a map-first collaborative styling surface with persistent comment mode, progressive rendered-feature selection, immutable pending comments, accessible native-annotation targets, and live style-tool updates over a free online basemap.

**Architecture:** Keep the package-level WebMCP facade unchanged. Split the example's current composition file into focused comment domain, picker, highlight, popup, marker, and controller modules; keep `main.ts` as the page composition root and retain the existing `selectionId` consumption tool. The page owns the live MapLibre surface and accessible annotation targets; the external ChatGPT built-in browser/plugin owns native composer tags and conversation UI.

**Tech Stack:** TypeScript 5.9, Node.js `>=22.13.0`, pnpm `10.10.0`, MapLibre GL JS `^6.3.0`, Vite 8, Zod 4, Node test runner, Playwright.

## Global Constraints

- Prefix every shell command with `rtk`.
- Before modifying an existing function, class, or method, run GitNexus upstream impact analysis for that symbol. Warn the user before proceeding on HIGH or CRITICAL risk.
- Before modifying or removing an exported symbol, run LSP references and migrate every caller in the same clean cutover.
- Run GitNexus `detect_changes({ scope: "all" })` before every commit; investigate unexpected flows before committing.
- Do not build, imitate, or test a project-owned ChatGPT composer, transcript, native tag UI, or browser plugin.
- Keep the five package-level WebMCP tools and their capability schemas unchanged; the example continues to add only `consumeMapSelectionContexts`.
- Use `https://demotiles.maplibre.org/style.json` as free, keyless example data and retain visible MapLibre attribution.
- Keep `resourcePolicy.allowedResourceOrigins` limited to the page origin and `https://demotiles.maplibre.org`.
- Query all features MapLibre actually rendered at the click point without a layer allowlist; preserve topmost order, deduplicate before limiting, and present at most 10 candidates.
- Retain at most 20 scalar properties; property names are at most 80 characters and scalar strings at most 240 characters.
- Store trimmed comment text containing 1–1,000 characters.
- Use `map-selection-${crypto.randomUUID()}` IDs; IDs are 1–128 characters and one consume call contains 1–20 unique IDs.
- Store at most 20 pending comments; reject the 21st instead of evicting an existing context.
- Keep `consumeMany` atomic: one invalid or unknown ID removes nothing.
- Treat added comments as immutable; editing means cancel and create a replacement.
- Native Annotation mode is an external manual handoff: after Add, the user annotates a visible pin or summary to create a ChatGPT composer tag.
- Write the failing behavioral test before each implementation change and commit each independently reviewable task.

## File Structure

### Create

- `examples/webmcp/src/comment-highlight.ts` — owner-aware temporary GeoJSON highlight source/layers and style-reload lifecycle.
- `examples/webmcp/src/comment-highlight.test.ts` — fake-map point, line, polygon, ownership, restore, and teardown tests.
- `examples/webmcp/src/comment-popup.ts` — progressive candidate/draft popup, exact scope options, validation, focus, add/cancel contract.
- `examples/webmcp/src/comment-popup.test.ts` — comment normalization, scope availability/reasons, property ordering, and popup state model tests.
- `examples/webmcp/src/comment-markers.ts` — numbered accessible annotation targets and page-only pending geometry.
- `examples/webmcp/src/comment-controller.ts` — disabled/enabled map control, interaction reducer, map click, popup, Escape, reset, and abort orchestration.
- `examples/webmcp/src/comment-controller.test.ts` — reducer and cleanup contract tests.
- `examples/webmcp/src/feature-picker.test.ts` — query, order, dedupe, bound, scalar projection, and geometry tests.

### Modify

- `examples/webmcp/src/comment-targets.ts` — clean rename to pending-comment types/store; bounded comment and never-reused ID invariants.
- `examples/webmcp/src/comment-targets.test.ts` — replace eviction behavior; cover comments, capacity, ID reuse, immutability, and atomic batches.
- `examples/webmcp/src/feature-picker.ts` — return safe `FeatureCandidate` geometry in a bounded `FeaturePickResult`.
- `examples/webmcp/src/main.ts` — compose the map-first page, six tools, online style lifecycle, drawer, retry, reset, and comment modules.
- `examples/webmcp/src/main.test.ts` — migrate domain names and verify comment-bearing consumption and unsupported fallback.
- `examples/webmcp/index.html` — map-first shell, overlay header/status, error host, and explicit bottom technical drawer.
- `examples/webmcp/src/style.css` — full-viewport map, control, progressive popup, pins, drawer, responsive/focus/error styles.
- `examples/webmcp/e2e/webmcp.spec.ts` — deterministic style interception and complete page-owned workflow.
- `examples/webmcp/README.md` — online-basemap notice, page flow, native Annotation handoff, stale-tag safety, and manual acceptance.

### Remove

- `examples/webmcp/src/demo-style.ts` — obsolete production inline style; deterministic inline data lives only in the Playwright fixture.

---

### Task 1: Immutable Pending Comment Domain

**Files:**
- Modify: `examples/webmcp/src/comment-targets.ts:1-174`
- Modify: `examples/webmcp/src/comment-targets.test.ts:1-114`
- Modify: `examples/webmcp/src/main.test.ts:7-23,77-139`
- Modify: `examples/webmcp/src/main.ts:10-17,61-142`

**Interfaces:**
- Consumes: Existing `FeatureReference` bounds and `onRemove` cleanup callback.
- Produces:
  - `type Scalar = string | number | boolean | null`
  - `type PendingMapCommentInput` — three scope variants plus required `comment`
  - `type PendingMapComment` — immutable input plus `selectionId`
  - `class PendingMapCommentStore`
  - `add(input: PendingMapCommentInput): PendingMapComment`
  - `get(selectionId: string): PendingMapComment | undefined`
  - `consumeMany(selectionIds: readonly string[]): readonly PendingMapComment[]`
  - `remove(selectionId: string): boolean`
  - `clear(): void`

- [ ] **Step 1: Check the existing store blast radius and references**

Run GitNexus upstream impact for `CommentTargetStore`. Run LSP references for `CommentTargetStore`, `MapCommentTarget`, and `MapCommentTargetInput`. Expected current scope: `examples/webmcp/src/main.ts`, `main.test.ts`, and `comment-targets.test.ts`; stop and report any additional production caller before editing.

- [ ] **Step 2: Write failing pending-comment invariant tests**

```ts
import {
  PendingMapCommentStore,
  type FeatureReference,
  type PendingMapComment,
} from './comment-targets.js';

const mutableFeature = () => ({
  layerId: 'places-fill', sourceId: 'places', featureId: 1,
  lngLat: [0, 0] as [number, number],
  properties: { class: 'park', name: 'original' } as Record<string, string>,
});

const createStore = (
  ids: string[] = ['map-selection-a', 'map-selection-b', 'map-selection-c'],
  capacity = 20,
  onRemove?: (comment: PendingMapComment) => void,
) => new PendingMapCommentStore({
  capacity,
  idFactory: () => ids.shift() ?? 'map-selection-exhausted',
  onRemove,
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

test('rejects capacity without evicting or reusing an issued id', () => {
  const store = createStore(['map-selection-a', 'map-selection-b', 'map-selection-a'], 2);
  const first = store.add({ comment: 'One', scope: 'layer', feature: mutableFeature() });
  store.add({ comment: 'Two', scope: 'layer', feature: mutableFeature() });
  assert.throws(() => store.add({ comment: 'Three', scope: 'layer', feature: mutableFeature() }), /capacity/u);
  assert.equal(store.get(first.selectionId), first);

  store.remove('map-selection-a');
  assert.throws(() => store.add({ comment: 'Reused', scope: 'layer', feature: mutableFeature() }), /already issued/u);
});
```

Update all existing scope, property, identity, cleanup, and atomic-consumption tests to pass valid comments and use the new names. Assert a mixed valid/unknown batch retains every valid context and callback count remains zero.

- [ ] **Step 3: Run the unit suite and verify the clean-cutover tests fail**

Run: `rtk pnpm run test:example:webmcp`

Expected: FAIL because the new exports and comment/issued-ID/capacity behavior do not exist.

- [ ] **Step 4: Implement the domain cutover**

```ts
export type Scalar = string | number | boolean | null;

export type PendingMapCommentInput =
  | { readonly comment: string; readonly scope: 'feature'; readonly feature: FeatureReference & { readonly featureId: string | number } }
  | { readonly comment: string; readonly scope: 'property-class'; readonly feature: FeatureReference; readonly selector: { readonly property: string; readonly value: Scalar } }
  | { readonly comment: string; readonly scope: 'layer'; readonly feature: FeatureReference };

export type PendingMapComment = PendingMapCommentInput & { readonly selectionId: string };

const boundedComment = (value: unknown): string => {
  if (typeof value !== 'string') throw new TypeError('Comment must be a string.');
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new TypeError('Comment must be non-empty.');
  if (trimmed.length > 1_000) throw new RangeError('Comment must not exceed 1,000 characters.');
  return trimmed;
};
```

`PendingMapCommentStore` keeps both `#comments` and `#issuedIds`. Validate capacity before calling the ID factory. Validate the returned ID, reject any ID already in `#issuedIds`, freeze the complete comment, add the ID to `#issuedIds`, then insert. Removing/consuming clears `#comments` only; issued IDs remain reserved for the page lifetime. Remove `MapCommentTarget`, `MapCommentTargetInput`, and `CommentTargetStore`, and migrate every reference found in Step 1.

- [ ] **Step 5: Run unit tests and example typecheck**

Run: `rtk pnpm run test:example:webmcp`

Run: `rtk pnpm run example:typecheck:webmcp`

Expected: both PASS.

- [ ] **Step 6: Detect affected flows and commit**

Run GitNexus `detect_changes({ scope: "all" })`. Expected: low-risk changes restricted to the WebMCP example and tests.

```bash
rtk git add examples/webmcp/src/comment-targets.ts examples/webmcp/src/comment-targets.test.ts examples/webmcp/src/main.ts examples/webmcp/src/main.test.ts
rtk git commit -m "feat(example): store pending map comments"
```

### Task 2: Rendered Feature Candidate Projection

**Files:**
- Modify: `examples/webmcp/src/feature-picker.ts:1-72`
- Create: `examples/webmcp/src/feature-picker.test.ts`
- Modify: `examples/webmcp/src/main.ts:17,273-327,382-385`

**Interfaces:**
- Consumes: `FeatureReference` and `Scalar` from Task 1; MapLibre `MapGeoJSONFeature` and `MapMouseEvent`.
- Produces:
  - `type FeatureGeometry = MapGeoJSONFeature['geometry']`
  - `interface FeatureCandidate { feature: FeatureReference; geometry: FeatureGeometry; label: string }`
  - `interface FeaturePickResult { candidates: readonly FeatureCandidate[]; truncated: boolean }`
  - `pickRenderedFeatures(map, event): FeaturePickResult`
  - `propertyOptionsFor(feature): readonly { property: string; value: Scalar; label: string }[]`
  - preserved `featureLabel(feature): string`

- [ ] **Step 1: Check picker impact and references**

Run GitNexus upstream impact for `pickRenderedFeatures` and `featureLabel`. Run LSP references for both exports. Expected callers: `examples/webmcp/src/main.ts` and the new/updated example tests.

- [ ] **Step 2: Write failing picker tests**

```ts
test('queries every rendered feature without a layer allowlist', () => {
  const calls: unknown[][] = [];
  const map = {
    queryRenderedFeatures(...args: unknown[]) {
      calls.push(args);
      return [rawFeature({ id: 7, layerId: 'road', source: 'base' })];
    },
  } as unknown as MapLibreMap;

  const result = pickRenderedFeatures(map, event);

  assert.deepEqual(calls, [[event.point]]);
  assert.equal(result.candidates[0]?.feature.layerId, 'road');
  assert.equal(result.candidates[0]?.geometry.type, 'LineString');
});

test('deduplicates before retaining the topmost ten', () => {
  const rendered = [
    rawFeature({ id: 1, layerId: 'top', source: 'base' }),
    rawFeature({ id: 1, layerId: 'top', source: 'base' }),
    ...Array.from({ length: 11 }, (_, index) =>
      rawFeature({ id: index + 2, layerId: `layer-${index}`, source: 'base' })),
  ];
  const result = pickRenderedFeatures(fakeMap(rendered), event);

  assert.equal(result.candidates.length, 10);
  assert.equal(result.candidates[0]?.feature.layerId, 'top');
  assert.equal(result.truncated, true);
});

test('sorts scalar property choices and preserves scalar types', () => {
  assert.deepEqual(propertyOptionsFor({
    layerId: 'road', sourceId: 'base', lngLat: [0, 0],
    properties: { z: null, a: false, n: 2, s: 'two' },
  }).map(({ property, value }) => [property, value]), [
    ['a', false], ['n', 2], ['s', 'two'], ['z', null],
  ]);
});
```

Add cases proving: stable-ID duplicates collapse; no-ID candidates collapse only when layer/source/source-layer, sorted scalar properties, geometry type, and coordinates all match; the same source feature in two style layers stays distinct; invalid identities are excluded; 20/80/240 bounds remain.

- [ ] **Step 3: Run tests and verify projection failures**

Run: `rtk pnpm run test:example:webmcp`

Expected: FAIL because the old picker passes a layer allowlist, returns an array, retains no geometry, and does not deduplicate.

- [ ] **Step 4: Implement deterministic projection**

```ts
export interface FeatureCandidate {
  readonly feature: FeatureReference;
  readonly geometry: MapGeoJSONFeature['geometry'];
  readonly label: string;
}

export interface FeaturePickResult {
  readonly candidates: readonly FeatureCandidate[];
  readonly truncated: boolean;
}

const candidateKey = (candidate: FeatureCandidate): string => {
  const { feature, geometry } = candidate;
  const identity = [feature.layerId, feature.sourceId, feature.sourceLayer ?? null];
  return feature.featureId !== undefined
    ? JSON.stringify([...identity, 'id', feature.featureId])
    : JSON.stringify([
        ...identity,
        'geometry', geometry,
        'properties', Object.entries(feature.properties).sort(([left], [right]) => left.localeCompare(right)),
      ]);
};
```

Call `map.queryRenderedFeatures(event.point)` with no options. Iterate MapLibre's topmost-first result once, project and deduplicate into a bounded array, stop retaining after the 11th unique candidate so `truncated` can be set without allocating every remaining candidate, and return the first 10 frozen candidates. `propertyOptionsFor` sorts projected property names lexically.

- [ ] **Step 5: Run unit tests and typecheck**

Run: `rtk pnpm run test:example:webmcp`

Run: `rtk pnpm run example:typecheck:webmcp`

Expected: both PASS.

- [ ] **Step 6: Detect affected flows and commit**

Run GitNexus `detect_changes({ scope: "all" })`. Expected: picker callers and example click flow only.

```bash
rtk git add examples/webmcp/src/feature-picker.ts examples/webmcp/src/feature-picker.test.ts examples/webmcp/src/main.ts
rtk git commit -m "feat(example): project map comment candidates"
```

### Task 3: Owner-Aware GeoJSON Highlight Controller

**Files:**
- Create: `examples/webmcp/src/comment-highlight.ts`
- Create: `examples/webmcp/src/comment-highlight.test.ts`

**Interfaces:**
- Consumes: `FeatureGeometry` from Task 2 and page lifetime `AbortSignal`.
- Produces:
  - `show(owner: string, geometry: FeatureGeometry): void`
  - `clear(owner: string): void` — clears only when `owner` currently owns the overlay
  - `clearAll(): void`
  - `restore(): void`
  - `destroy(): void`
  - `createCommentHighlight(map, signal): CommentHighlightController`
- Reserved IDs: source `webmcp-comment-highlight`; layers ending `-fill`, `-line`, and `-point`.

- [ ] **Step 1: Write failing fake-map tests for all geometry and ownership paths**

```ts
test('renders point, line, and polygon through the reserved source', () => {
  const map = new FakeHighlightMap();
  const controller = createCommentHighlight(map.asMap(), new AbortController().signal);
  for (const geometry of [pointGeometry, lineGeometry, polygonGeometry]) {
    controller.show('draft', geometry);
    assert.deepEqual(map.currentData.features[0]?.geometry, geometry);
  }
  assert.deepEqual(map.addedLayers.map(({ id }) => id), [
    'webmcp-comment-highlight-fill',
    'webmcp-comment-highlight-line',
    'webmcp-comment-highlight-point',
  ]);
});

test('does not let a pin clear a draft-owned highlight', () => {
  const map = new FakeHighlightMap();
  const controller = createCommentHighlight(map.asMap(), new AbortController().signal);
  controller.show('draft', polygonGeometry);
  controller.clear('map-selection-a');
  assert.deepEqual(map.currentData.features[0]?.geometry, polygonGeometry);
  controller.clear('draft');
  assert.equal(map.currentData.features.length, 0);
});

test('restores current geometry after style load and tears down on abort', () => {
  const map = new FakeHighlightMap();
  const lifetime = new AbortController();
  const controller = createCommentHighlight(map.asMap(), lifetime.signal);
  controller.show('map-selection-a', pointGeometry);
  map.dropStyleOwnedData();
  map.emit('style.load');
  assert.deepEqual(map.currentData.features[0]?.geometry, pointGeometry);
  lifetime.abort();
  assert.equal(map.listenerCount('style.load'), 0);
});
```

Also test `clearAll` and idempotent `destroy`.

- [ ] **Step 2: Run tests and verify the new module is missing**

Run: `rtk pnpm run test:example:webmcp`

Expected: FAIL because `comment-highlight.ts` does not exist.

- [ ] **Step 3: Implement the highlight source and layers**

Use one `FeatureCollection` with zero or one feature. Add three filtered layers for polygon fill, line stroke, and point circle using high-contrast amber styling. `show` updates owner/current geometry and calls `restore`; `clear` checks owner; `clearAll` resets both; `restore` idempotently recreates missing source/layers and reapplies the current geometry; `destroy` unregisters `style.load`, removes only reserved resources, and becomes a no-op on later calls.

```ts
export interface CommentHighlightController {
  show(owner: string, geometry: FeatureGeometry): void;
  clear(owner: string): void;
  clearAll(): void;
  restore(): void;
  destroy(): void;
}
```

Catch no errors inside this low-level component; the controller in Task 4 normalizes preview failures without destroying pending state.

- [ ] **Step 4: Run tests and browser typecheck**

Run: `rtk pnpm run test:example:webmcp`

Run: `rtk pnpm run example:typecheck:webmcp`

Expected: both PASS.

- [ ] **Step 5: Detect changes and commit**

Run GitNexus `detect_changes({ scope: "all" })`. Expected: two new example-only files and no package execution flow.

```bash
rtk git add examples/webmcp/src/comment-highlight.ts examples/webmcp/src/comment-highlight.test.ts
rtk git commit -m "feat(example): highlight map comment features"
```

### Task 4: Complete Map-First Comment Interaction Slice

**Files:**
- Create: `examples/webmcp/src/comment-popup.ts`
- Create: `examples/webmcp/src/comment-popup.test.ts`
- Create: `examples/webmcp/src/comment-markers.ts`
- Create: `examples/webmcp/src/comment-controller.ts`
- Create: `examples/webmcp/src/comment-controller.test.ts`
- Modify: `examples/webmcp/index.html:9-54`
- Modify: `examples/webmcp/src/style.css:1-124`
- Modify: `examples/webmcp/src/main.ts:1-432`
- Modify: `examples/webmcp/src/main.test.ts:1-183`
- Modify: `examples/webmcp/e2e/webmcp.spec.ts:1-179`
- Remove: `examples/webmcp/src/demo-style.ts`

**Interfaces:**
- Consumes: Tasks 1–3 plus existing activity log, registration helpers, hash observer, and selection-consumption tool.
- Produces:
  - `ScopeOption { scope; label; enabled; disabledReason? }`
  - `PopupState` plus `initialPopupState`/`reducePopupState`
  - `normalizeCommentDraft(value)` and `scopeOptionsFor(candidate)`
  - `CommentPopupHandle { close(): void }`
  - `openCommentPopup(options): CommentPopupHandle`
  - `PendingCommentMarkerView`
  - `CommentModeState`/`CommentModeEvent` plus `reduceCommentMode`
  - `MapCommentController { setEnabled; cancelDraftForStyleChange; clear; destroy }`
  - full-viewport page with online style, disabled-until-loaded map control, drawer, retry, reset, pins, and progressive popup.

- [ ] **Step 1: Check the composition blast radius and exported references**

Run GitNexus upstream impact for `startWebMcpExample`, `renderWebMcpSupport`, `registerMapSelectionConsumptionTool`, `registerMapSelectionConsumptionToolSafely`, and `createDemoStyle`. Run LSP references for `createDemoStyle` and every exported helper changed in `main.ts`. Expected scope is the WebMCP example and its tests; warn before proceeding if risk is HIGH or CRITICAL.

- [ ] **Step 2: Write failing popup and controller unit tests**

```ts
test('normalizes exact bounds and exposes disabled scope reasons', () => {
  assert.deepEqual(normalizeCommentDraft(' x '), { ok: true, value: 'x' });
  assert.equal(normalizeCommentDraft('x'.repeat(1_000)).ok, true);
  assert.equal(normalizeCommentDraft('x'.repeat(1_001)).ok, false);

  const options = scopeOptionsFor(candidate({ featureId: undefined, properties: {} }));
  assert.deepEqual(options.map(({ scope, enabled }) => [scope, enabled]), [
    ['feature', false], ['property-class', false], ['layer', true],
  ]);
  assert.match(options[0]?.disabledReason ?? '', /stable feature ID/u);
  assert.match(options[1]?.disabledReason ?? '', /scalar property/u);
});

test('requires explicit Next for overlapping candidates', () => {
  let state = initialPopupState([roadCandidate, waterCandidate]);
  assert.equal(state.step, 'candidate');
  state = reducePopupState(state, { type: 'choose', index: 1 });
  assert.equal(state.step, 'candidate');
  state = reducePopupState(state, { type: 'next' });
  assert.equal(state.step, 'draft');
  assert.equal(state.selectedIndex, 1);
});

test('keeps comment mode after add or draft cancel and uses two-stage Escape', () => {
  assert.equal(reduceCommentMode('drafting', { type: 'add' }), 'comment-mode');
  assert.equal(reduceCommentMode('drafting', { type: 'escape' }), 'comment-mode');
  assert.equal(reduceCommentMode('comment-mode', { type: 'escape' }), 'idle');
});
```

Add reducer cases for zero/one/many picker results, ignored map click while popup is open, toggle during draft, picker/preview failure, reset, style replacement, and abort.

- [ ] **Step 3: Write the failing primary Playwright workflow before page implementation**

Add this concrete deterministic style fixture to `webmcp.spec.ts` and intercept the production URL:

```ts
const DEMO_STYLE_URL = 'https://demotiles.maplibre.org/style.json';
const TEST_STYLE = {
  version: 8,
  sources: {
    places: {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', id: 1, properties: { class: 'water', name: 'Central Lake', visible: true, rank: 2 }, geometry: { type: 'Polygon', coordinates: [[[-8, -8], [8, -8], [8, 8], [-8, 8], [-8, -8]]] } },
          { type: 'Feature', properties: { class: 'district', name: 'Central District' }, geometry: { type: 'Polygon', coordinates: [[[-12, -12], [12, -12], [12, 12], [-12, 12], [-12, -12]]] } },
        ],
      },
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#dfe8e1' } },
    { id: 'places-fill', type: 'fill', source: 'places', paint: { 'fill-color': '#3b82a0', 'fill-opacity': 0.7 } },
    { id: 'places-outline', type: 'line', source: 'places', paint: { 'line-color': '#17324d', 'line-width': 2 } },
  ],
} as const;

await page.route(DEMO_STYLE_URL, (route) => route.fulfill({
  contentType: 'application/json', body: JSON.stringify(TEST_STYLE),
}));
```

Write a test that opens the drawer-free map surface, verifies the comment control starts disabled then enables after style load, enters comment mode, clicks the center, chooses `Central Lake`, clicks explicit Next, enters a comment, chooses `property-class` and `class`, adds it, verifies one UUID-based pin and persistent mode, calls the fake consume tool, asserts returned comment/scope, and verifies the pin disappears.

- [ ] **Step 4: Run focused tests and verify they fail before implementation**

Run: `rtk pnpm run test:example:webmcp`

Expected: FAIL because popup/controller modules and state exports do not exist.

Run: `rtk pnpm run test:e2e:webmcp -- --grep "adds and consumes a map comment"`

Expected: FAIL because the map-first shell, disabled control, progressive popup, pin, and comment-bearing context are not composed.

- [ ] **Step 5: Implement the progressive popup contract**

```ts
export interface ScopeOption {
  readonly scope: PendingMapCommentInput['scope'];
  readonly label: string;
  readonly enabled: boolean;
  readonly disabledReason?: string;
}

export interface CommentPopupHandle {
  close(): void;
}

export interface CommentPopupOptions {
  readonly map: MapLibreMap;
  readonly candidates: readonly FeatureCandidate[];
  readonly truncated: boolean;
  readonly lngLat: readonly [number, number];
  readonly highlight: CommentHighlightController;
  readonly signal: AbortSignal;
  readonly onAdd: (input: PendingMapCommentInput, geometry: FeatureGeometry) => string | undefined;
  readonly onCancel: () => void;
}

export type OpenCommentPopup = (options: CommentPopupOptions) => CommentPopupHandle;
```

For one candidate, begin at draft. For several, show a focusable topmost-first list, candidate preview, Cancel, and explicit Next. The draft step shows textarea, scope, lexically sorted property selector, disabled reasons, Cancel, and Add. `onAdd` returning `undefined` closes successfully; returning an error string preserves every field and displays the error. This exact contract lets store-capacity failure preserve the draft. Escape cancels once and returns focus to the map canvas.

- [ ] **Step 6: Implement pending markers and owner-safe highlighting**

```ts
export interface PendingCommentMarkerView {
  add(comment: PendingMapComment, geometry: FeatureGeometry): void;
  remove(selectionId: string): void;
  clear(): void;
  destroy(): void;
}

export interface PendingCommentMarkerViewOptions {
  readonly map: MapLibreMap;
  readonly highlight: CommentHighlightController;
  readonly createMarker: (element: HTMLElement) => MapLibreMarker;
  readonly onCancel: (selectionId: string) => void;
}
```

Each target is focusable, has `data-testid="pending-comment-pin"` and `data-selection-id`, shows a compact ordinal, and exposes selection ID, stored comment, feature label, source/layer, scope/selector, and location in accessible summary text. Hover/focus calls `highlight.show(selectionId, geometry)`; leave/blur calls `highlight.clear(selectionId)`, which cannot clear draft owner `draft`. Cancel calls the provided callback. `remove`, `clear`, and `destroy` remove marker, target DOM, listeners, geometry, and owned highlight.

- [ ] **Step 7: Implement the controller and disabled map control**

```ts
export interface MapCommentController {
  setEnabled(enabled: boolean, reason?: string): void;
  cancelDraftForStyleChange(): void;
  clear(): void;
  destroy(): void;
}

export interface MapCommentControllerOptions {
  readonly map: MapLibreMap;
  readonly store: PendingMapCommentStore;
  readonly markers: PendingCommentMarkerView;
  readonly highlight: CommentHighlightController;
  readonly status: HTMLElement;
  readonly signal: AbortSignal;
}

export type CreateMapCommentController = (
  options: MapCommentControllerOptions,
) => MapCommentController;
```

Create the standard MapLibre control immediately with `aria-label="Add map comment"`, `aria-pressed`, `data-testid="comment-mode-toggle"`, and `disabled` until the first successful style load. The controller queries only in comment mode, ignores clicks while popup is open, catches picker/highlight/popup preview errors, cancels only the active draft on such failures, and preserves pending entries.

On popup Add:

```ts
let added: PendingMapComment | undefined;
try {
  added = store.add(input);
  markers.add(added, geometry);
  return undefined;
} catch {
  if (added !== undefined) store.remove(added.selectionId);
  return store.size >= 20
    ? 'Submit or cancel an existing comment before adding another.'
    : 'Unable to add this map comment.';
}
```

The popup remains intact when an error string is returned. `clear` cancels a draft, clears store entries (whose `onRemove` removes markers), clears highlight, and returns to idle. `destroy` calls `clear`, removes keyboard/map/control listeners, and is invoked by page lifetime abort.

- [ ] **Step 8: Replace the page shell and compose the online map**

Use this explicit shell; retain the existing status/test hooks inside the drawer:

```html
<main class="app-shell">
  <section id="map" data-testid="map" aria-label="Collaborative MapLibre style map"></section>
  <header class="map-header">
    <div><p class="eyebrow">WebMCP example</p><h1>Map Style Collaborator</h1></div>
    <p data-testid="webmcp-support" aria-live="polite">Checking Site tools</p>
  </header>
  <p class="map-message" data-testid="comment-status" aria-live="polite"></p>
  <section class="map-error" data-testid="map-load-error" hidden>
    <p>Unable to load the demonstration map.</p>
    <button type="button" data-testid="retry-map">Retry</button>
  </section>
  <details class="technical-drawer" data-testid="technical-drawer">
    <summary>Site tools and activity</summary>
    <div class="drawer-content">
      <dl class="status-grid">
        <dt>Browser security</dt><dd data-testid="secure-context">checking</dd>
        <dt>Map revision</dt><dd data-testid="map-revision">0</dd>
        <dt>Style hash</dt><dd data-testid="map-style-hash">checking</dd>
        <dt>Layers</dt><dd data-testid="map-layer-count">0</dd>
      </dl>
      <section><h2>Registered site tools</h2><div data-testid="registered-tools">Waiting for WebMCP support.</div></section>
      <section><h2>Recent activity</h2><ol data-testid="activity-log" aria-live="polite"></ol></section>
      <section><h2>Map controls</h2><button type="button" data-testid="reset-map">Reset local map</button></section>
      <section><h2>Test prompts</h2><ul><li>List the layers in this map.</li><li>Make the selected roads more prominent.</li><li>Reset the style after a map edit.</li></ul></section>
    </div>
  </details>
</main>
```

Compose:

```ts
const DEMO_STYLE_URL = 'https://demotiles.maplibre.org/style.json';
const map = new Map({
  container: 'map', style: DEMO_STYLE_URL,
  center: [0, 20], zoom: 1.5, attributionControl: true,
});
```

Create highlight, markers, store, then controller. Break the marker/store callback cycle with a definitely-assigned local:

```ts
let store!: PendingMapCommentStore;
const markers = createPendingCommentMarkerView({
  map, highlight, createMarker: (element) => new Marker({ element }),
  onCancel: (selectionId) => { store.remove(selectionId); },
});
store = new PendingMapCommentStore({
  capacity: 20,
  idFactory: () => `map-selection-${crypto.randomUUID()}`,
  onRemove: ({ selectionId }) => markers.remove(selectionId),
});
```

On initial `style.load`, clear the load-error banner and enable the controller. Before the first successful style load, treat an `error` as initial-style failure only when `map.isStyleLoaded()` is false; show Retry and keep the controller disabled. Retry hides the banner, calls `map.setStyle(DEMO_STYLE_URL)`, and waits for `style.load`. Later style loads call `controller.cancelDraftForStyleChange()` and `highlight.restore()` while preserving pending contexts.

Reset calls `activity.clear()`, `controller.clear()`, disables the controller, and `map.setStyle(DEMO_STYLE_URL)`. Page lifetime abort calls `controller.destroy()`, `markers.destroy()`, `highlight.destroy()`, and aborts tools. Keep `allowMutations: true`, all-or-nothing six-tool registration, hash/revision observation, and the demo origin policy. Remove the old side-panel candidates/cards/markers and delete `demo-style.ts`.

- [ ] **Step 9: Implement page-owned styles and update main unit tests**

Add full-height map, floating header/status, 40px map control, active/disabled states, progressive popup, disabled-reason text, error banner, numbered pins, read-only pin summary, collapsed bottom drawer, narrow-screen rules, visible focus, and unobscured attribution. Update `main.test.ts` to use `PendingMapCommentStore`; assert consumed results include comment text; preserve core/custom registration failure tests; unsupported copy is `Site tools unavailable · local preview`.

- [ ] **Step 10: Run unit, E2E, typecheck, and build checks**

Run: `rtk pnpm run test:example:webmcp`

Run: `rtk pnpm run test:e2e:webmcp -- --grep "adds and consumes a map comment"`

Run: `rtk pnpm run example:typecheck:webmcp`

Run: `rtk pnpm run build:example:webmcp`

Expected: all PASS. Use the repository grep tool to confirm no `CommentTargetStore`, `MapCommentTarget`, `createDemoStyle`, or `comment-target-panel` reference remains in `examples/webmcp`.

- [ ] **Step 11: Detect affected flows and commit the vertical slice**

Run GitNexus `detect_changes({ scope: "all" })`. Expected: WebMCP example modules, page startup flow, and tests only; no package public API flow.

```bash
rtk git add examples/webmcp/index.html examples/webmcp/src examples/webmcp/e2e/webmcp.spec.ts
rtk git commit -m "feat(example): redesign WebMCP map collaboration"
```

### Task 5: Boundary, Cleanup, and Failure Matrix

**Files:**
- Modify: `examples/webmcp/src/comment-popup.test.ts`
- Modify: `examples/webmcp/src/comment-controller.test.ts`
- Modify: `examples/webmcp/src/comment-popup.ts`
- Modify: `examples/webmcp/src/comment-markers.ts`
- Modify: `examples/webmcp/src/comment-controller.ts`
- Modify: `examples/webmcp/src/main.ts`
- Modify: `examples/webmcp/e2e/webmcp.spec.ts`

**Interfaces:**
- Consumes: Task 4's working vertical slice.
- Produces: complete specified boundaries, all three successful scopes, deterministic cleanup, style failure/retry, stale-ID safety, and full page-owned acceptance coverage.

- [ ] **Step 1: Check changed-symbol impact and references**

Run GitNexus upstream impact and LSP references for `openCommentPopup`, `createMapCommentController`, `createPendingCommentMarkerView`, and `startWebMcpExample` before modifying them. Expected scope is the example and tests.

- [ ] **Step 2: Add failing unit cleanup tests**

Add assertions that:

- exact 1 and 1,000 characters are accepted and 0/1,001 rejected;
- `scopeOptionsFor` preserves exact string/number/boolean/`null` values and lexical default property;
- explicit Next is required after candidate choice;
- popup cancel returns focus to map canvas;
- leaving comment mode returns focus to the control;
- preview failure returns to comment mode and does not call store removal;
- reset and abort call draft close, store clear, marker clear, and highlight clear in deterministic order;
- destroy is idempotent.

Use spies passed through controller dependencies rather than a DOM shim for cleanup order.

- [ ] **Step 3: Add failing E2E cases before fixes**

Add separate Playwright tests for:

1. zero, one, several, and 11 unique overlapping candidates; topmost 10 and truncation copy;
2. successful `feature`, `property-class`, and `layer` comments, including returned selector/value types;
3. disabled feature/property scopes with visible explanations;
4. empty and 1,001-character errors preserving text, plus successful 1- and 1,000-character Adds;
5. draft Cancel, pending Cancel, consecutive Adds, and two-stage Escape;
6. pin focus/hover summary and on-demand highlight;
7. store capacity error preserving the 21st draft;
8. valid two-ID batch consumption;
9. stale plus valid ID returning `NOT_FOUND` while the valid pin remains;
10. reset clearing comments/activity and restoring the remote style URL;
11. style replacement cancelling a draft and restoring pending highlight layers;
12. page lifetime abort clearing store, markers, targets, geometry, listeners, and highlight;
13. initial style request failure showing Retry, control disabled, then successful retry enabling it;
14. unsupported WebMCP local preview with usable map comment and reset UI.

Extend the deterministic fixture with enough overlapping features for the 11-candidate case and one feature with no ID/no scalar properties.

- [ ] **Step 4: Run focused suites and record the concrete failures**

Run: `rtk pnpm run test:example:webmcp`

Run: `rtk pnpm run test:e2e:webmcp`

Expected: newly added boundary cases FAIL while the Task 4 primary workflow remains PASS.

- [ ] **Step 5: Implement only the failing boundary behavior**

Use the already-declared interfaces. Required outcomes:

- disabled scope options render `disabledReason` adjacent to the disabled control;
- `onAdd` error keeps the exact candidate, comment, scope, property, and focus;
- preview exceptions call `highlight.clear('draft')`, close only the draft, and preserve markers/store;
- `controller.destroy()` calls `clear()` before removing listeners/control;
- reset/abort removal flows through store `onRemove` so one path owns marker/geometry cleanup;
- `style.load` cancels only the current draft, then highlight restore can reveal pending geometry on next pin focus;
- initial load error uses the pre-first-`style.load` guard and Retry creates exactly one new style load attempt;
- selection consumption remains atomic and never removes a valid pin from a mixed invalid batch.

- [ ] **Step 6: Run the complete changed-surface verification**

Run: `rtk pnpm run test:example:webmcp`

Run: `rtk pnpm run test:e2e:webmcp`

Run: `rtk pnpm run build:example:webmcp`

Expected: all PASS with no page errors, console errors, required resource failures, or unexpected origins.

- [ ] **Step 7: Detect affected flows and commit robustness coverage**

Run GitNexus `detect_changes({ scope: "all" })`. Expected: WebMCP example behavior and test flows only.

```bash
rtk git add examples/webmcp/src examples/webmcp/e2e/webmcp.spec.ts
rtk git commit -m "test(webmcp): cover collaborative comment lifecycle"
```

### Task 6: Documentation, Native Acceptance, and Final Verification

**Files:**
- Modify: `examples/webmcp/README.md:1-40`

**Interfaces:**
- Consumes: final page copy, six tools, online style, native Annotation boundary, UUID IDs, consume-first instruction, and stale-ID safety.
- Produces: reproducible startup/manual acceptance guide and final repository evidence.

- [ ] **Step 1: Rewrite the README with exact prerequisites and workflow**

Document all of the following:

- start with `rtk pnpm run example:dev:webmcp` and open `http://127.0.0.1:5175`;
- latest supported ChatGPT desktop built-in browser or equivalent plugin environment, Site tools enabled, eligible account, supported model, site access approved, and native Annotation mode available;
- two read and four write Site tools by name;
- free/keyless MapLibre demo style, visible attribution, and non-production tile-service warning;
- map comment toggle, overlapping candidate choice plus explicit Next, bounded comment, three scopes, Add, Cancel, persistent mode, pins, and on-demand highlight;
- after page Add, use native Annotation mode on the pin or summary to create a native composer tag containing visible selection identity and comment context;
- add extra composer text, submit several tags, and expect one batch `consumeMapSelectionContexts` call before related style-tool calls;
- verify pins disappear before the requested live style change appears;
- cancel/reset/reload stale-tag `NOT_FOUND` safety and manual stale-tag removal;
- unsupported Site tools local preview;
- native tag behavior remains manual because no public composer automation API exists.

- [ ] **Step 2: Run focused verification**

Run: `rtk pnpm run test:example:webmcp`

Run: `rtk pnpm run test:e2e:webmcp`

Run: `rtk pnpm run build:example:webmcp`

Expected: all PASS.

- [ ] **Step 3: Run repository static verification once**

Run: `rtk pnpm run typecheck`

Run: `rtk pnpm run lint`

Expected: both PASS. Do not run unrelated bridge E2E unless shared-code changes or these checks expose a shared regression.

- [ ] **Step 4: Smoke-test the real online surface**

Start the managed development process with `rtk pnpm run example:dev:webmcp`. Browser-drive `http://127.0.0.1:5175/` and verify:

1. remote demo map and attribution load;
2. map fills the viewport and drawer starts collapsed;
3. comment control enables only after style load;
4. real rendered candidates can be selected and highlighted;
5. explicit Next reaches the draft step;
6. bounded comment Add creates a numbered pin and leaves comment mode active;
7. pin focus restores the highlight and pending Cancel removes it;
8. browser console/network contains no unexpected errors.

Record native ChatGPT verification separately with the README checklist; do not claim native tag success from Playwright.

- [ ] **Step 5: Detect final scope and commit documentation**

Run GitNexus `detect_changes({ scope: "all" })`. Expected: only the approved WebMCP example, its tests, and README are affected; no package public API contract changes.

```bash
rtk git add examples/webmcp/README.md
rtk git commit -m "docs(webmcp): explain collaborative comment flow"
```
