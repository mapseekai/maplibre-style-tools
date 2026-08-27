# WebMCP Map Comment Collaboration Redesign

Date: 2026-08-27
Status: Approved design

## Summary

Redesign the standalone WebMCP example as a map-first collaborative styling
surface. A user enters a persistent comment mode from a control on the map,
selects any rendered feature, writes a bounded adjustment request in an
anchored popup, chooses the request scope, and adds the comment as an immutable
selection context. The browser's ChatGPT plugin owns the composer, native
annotation tags, and conversation UI. The page owns the live MapLibre map,
accessible annotation targets, comment context lifecycle, and WebMCP tools.

The selected handoff uses the existing `selectionId` contract. Native ChatGPT
comments reference one or more selection IDs. ChatGPT first calls
`consumeMapSelectionContexts` with those IDs, then uses the existing MapLibre
Site tools to inspect or modify the live style. Consumption atomically removes
the corresponding page contexts and visuals.

The example uses the free, keyless MapLibre demonstration style at
`https://demotiles.maplibre.org/style.json` as test data. It remains an example
resource rather than a production basemap dependency.

## Relationship to the existing WebMCP design

This design revises the standalone example and the native map-comment workflow
described in
`docs/superpowers/specs/2026-08-27-webmcp-support-design.md`. It does not change
the package-level five-tool WebMCP facade, capability registry, runtime
authority, or public package entry point.

The example continues to expose six Site tools when mutations are enabled:

- read-only: `inspectStyle`, `queryMapFeatures`;
- write: `applyStyleTransaction`, `applyStyleDocument`, `runMapCommand`,
  `consumeMapSelectionContexts`.

## Goals

- Make the map the primary surface instead of a demonstration beside a
  permanent developer sidebar.
- Put comment activation, feature selection, feature highlighting, comment
  drafting, scope selection, add, and cancel on the map.
- Permit candidates from every visible, feature-bearing rendered style layer.
- Handle overlapping rendered features without crowding one popup.
- Preserve multiple pending comments and submit them together through native
  ChatGPT annotation tags.
- Keep the page-to-agent handoff bounded, immutable, batchable, and explicit.
- Let ChatGPT inspect and adjust the live MapLibre style through the existing
  WebMCP tools.
- Keep the map and a local comment preview useful when Site tools or the plugin
  are unavailable.
- Preserve accessible controls, visible attribution, deterministic automated
  tests, and a documented native ChatGPT acceptance path.

## Non-goals

- Building or imitating the ChatGPT composer, chat transcript, native tag UI,
  browser plugin, or Site tools panel.
- Adding a backend service, persistence, accounts, multi-user synchronization,
  or a comment database.
- Adding geographic-radius, drawn-area, or viewport scopes.
- Editing an already-added pending comment in place.
- Making MapLibre demo tiles a production basemap recommendation.
- Changing the core capability schemas or package-level WebMCP registration
  semantics.

## Selected architecture

The architecture has three owners with one narrow contract between them.

### MapLibre page

The page owns:

- the online map and visible attribution;
- the map comment-mode control;
- rendered-feature picking and candidate projection;
- the progressive popup;
- temporary GeoJSON highlighting;
- pending comment contexts and map pins;
- accessible DOM annotation targets;
- the technical status drawer;
- all six WebMCP tool registrations.

### Browser plugin and ChatGPT

The browser plugin owns:

- native annotation mode;
- native composer tags;
- composer submission and additional free-form user text;
- routing Site tool invocations between ChatGPT and `document.modelContext`.

The page derives Site tools availability from the structural
`document.modelContext` registration result. It does not claim to detect a
ChatGPT account, model, conversation, or plugin connection. The project does
not draw or simulate any ChatGPT surface.

### Selection handoff

Each added map comment receives an immutable `selectionId`. Its accessible DOM
target visibly exposes the ID, stored comment, feature label, and scope. To add
that target to the ChatGPT composer with the currently documented integration,
the user enables native Annotation mode and selects the pin or its summary. The
browser plugin then owns the native tag. A future plugin may automate that
selection, but the page contract does not depend on an unpublished injection
API.

A submitted message may reference several IDs. The
`consumeMapSelectionContexts` description instructs the agent to call it with
all referenced IDs before applying map changes. This ordering is an agent
instruction and a native acceptance criterion, not a restriction the page can
enforce on unrelated core tool calls. The consume call validates the complete
batch, returns the corresponding contexts, removes them from page memory, and
removes their pins and annotation targets.

The current ChatGPT composer exposes no public page event or page-owned composer
API. The page therefore cannot create, update, or delete native tags. Removing
a page target makes its selection ID stale; submitting a stale tag produces an
atomic `NOT_FOUND` result. Native tag creation, cleanup, and synchronization are
verified manually in the supported ChatGPT built-in browser/plugin environment.

## Page layout

Use the approved map-first layout:

- The MapLibre map fills the viewport.
- A compact title and Site tools indicator float over the map without blocking
  normal navigation. The indicator reflects registration support, not ChatGPT
  account, model, conversation, or plugin connection state.
- A map control in the standard control stack toggles comment mode.
- Technical information moves to a collapsed bottom drawer:
  - secure-context and Site tools state;
  - registered tools;
  - map revision, style hash, and layer count;
  - recent invocation activity;
  - reset action and sample prompts.
- No permanent right-side comment or developer panel remains.
- Pending comments appear as compact numbered pins on the map.
- Hovering, focusing, or activating a pin shows its read-only summary and
  temporarily restores its feature highlight.

The layout must remain usable at narrow viewport widths. The bottom drawer may
expand to most of the viewport height, but the comment control and active popup
remain reachable.

## Interaction state model

The comment controller uses explicit states:

```text
idle
  -> comment-mode
  -> picking
  -> choosing-candidate (only when several features overlap)
  -> drafting
  -> comment-mode
```

`picking` is the bounded asynchronous query state. Added comments are durable
store entries, not a controller state; the controller returns to
`comment-mode` immediately after Add.

### Entering and leaving comment mode

- Activating the map control sets `aria-pressed="true"`, changes the cursor, and
  displays a concise instruction.
- Comment mode remains active after add or draft cancel so the user can create
  several comments in sequence.
- If a popup is open, Escape cancels only that draft and remains in comment
  mode. A second Escape with no popup exits comment mode.
- Activating the map control while a popup is open discards that draft and exits
  comment mode.
- Exiting comment mode clears temporary draft visuals but does not remove
  already-added comments.

### Picking features

On a map click in comment mode:

1. Call `queryRenderedFeatures` without a layer allowlist so MapLibre supplies
   every vector feature actually rendered at that point after zoom, visibility,
   filter, and style evaluation. Background, raster, hillshade, and custom
   layers produce no candidates.
2. Preserve MapLibre's topmost-first render order.
3. Exclude results without a bounded layer ID and source ID. Retain at most 20
   scalar properties, property names of at most 80 characters, and scalar
   strings of at most 240 characters.
4. Deduplicate before applying the result cap. With a stable feature ID, the key
   is layer, source, source layer, and ID. Without one, deduplicate only exact
   matches of layer/source identity, projected scalar properties, geometry type,
   and geometry coordinates. Features rendered through different style layers
   remain distinct because their layer scopes differ.
5. Offer the first ten safe, deduplicated candidates. If more exist, state that
   only the topmost ten are shown.
6. Preserve candidate geometry only in page-owned visual state.

“All visible layers” defines the query universe, not an unbounded popup result.
No result produces a lightweight message and leaves comment mode active. One
result goes directly to the draft form. Multiple results open the first step of
the approved progressive popup. Map clicks are ignored while a popup is open.

### Progressive popup

The popup is anchored to the clicked map location.

Step one, shown only for overlapping results:

- lists concise feature labels;
- previews the selected candidate's highlight;
- offers Cancel and Next.

Step two:

- shows the selected feature identity;
- accepts a required comment draft;
- offers the valid scope choices;
- offers Cancel and Add.

The stored comment is the trimmed input and must contain between 1 and 1,000
characters. Validation errors remain in the popup and are associated with the
relevant field.

### Scope semantics

The approved scopes describe the intended style rule, not a page-side spatial
query:

- `feature`: the selected style layer constrained to the rendered feature's
  bounded string or finite numeric `feature.id`;
- `property-class`: the selected style layer constrained by exact JSON-scalar
  equality on one projected property; string, number, boolean, and `null` stay
  type-distinct;
- `layer`: the entire selected style layer, independent of current viewport.

The popup sorts eligible scalar property names lexically and selects the first
by default. `feature` is disabled with an explanation when the candidate has no
bounded string or finite numeric ID. `property-class` is disabled when no
eligible scalar property exists. `layer` remains available for every projected
candidate. These scopes are immutable instructions for the agent; the page does
not directly apply a filter when a comment is created.

### Add, cancel, and pending comments

Cancel closes the uncommitted popup, clears its highlight, creates no context,
and returns to comment mode.

Add validates the form, creates the immutable context, renders an accessible
numbered pin and DOM annotation target, and returns to comment mode. The pending
pin is normally compact. Hover, keyboard focus, or activation shows a read-only
summary and highlights the target on demand.

An added comment cannot be edited in place. A user changes it by cancelling the
pending comment and creating a replacement. This prevents page context from
silently changing underneath a native composer tag.

Cancelling a pending comment removes its page context, marker, annotation
target, stored highlight geometry, and highlight. Because the page has no
native composer API, it cannot remove a tag that the user already created. The
user or plugin must remove that stale tag; if submitted, its unknown selection
ID fails atomically without consuming any valid context in the same batch.

## Data model

Use a clean cutover from the existing target-only type to a pending-comment
model:

```ts
type Scalar = string | number | boolean | null;

type FeatureReference = {
  readonly layerId: string;
  readonly sourceId: string;
  readonly sourceLayer?: string;
  readonly featureId?: string | number;
  readonly lngLat: readonly [number, number];
  readonly properties: Readonly<Record<string, Scalar>>;
};

type PendingMapComment =
  | {
      readonly selectionId: string;
      readonly comment: string;
      readonly scope: 'feature';
      readonly feature: FeatureReference & {
        readonly featureId: string | number;
      };
    }
  | {
      readonly selectionId: string;
      readonly comment: string;
      readonly scope: 'property-class';
      readonly feature: FeatureReference;
      readonly selector: {
        readonly property: string;
        readonly value: Scalar;
      };
    }
  | {
      readonly selectionId: string;
      readonly comment: string;
      readonly scope: 'layer';
      readonly feature: FeatureReference;
    };
```

The popup additionally uses an internal `FeatureCandidate` containing the safe
`FeatureReference`, display label, and GeoJSON geometry. On Add, page-only
`PendingCommentVisualState` retains that geometry and marker metadata under the
same selection ID so a pending pin can restore its highlight after the draft
candidate is gone or the style reloads. Neither geometry nor marker instances
enter the WebMCP result.

Selection IDs use `map-selection-${crypto.randomUUID()}` and are never reused by
one page instance. IDs must contain 1–128 characters. A consume request contains
1–20 unique IDs. Each feature reference retains at most 20 scalar properties;
property names are at most 80 characters and scalar strings at most 240
characters. The stored comment is the trimmed 1–1,000-character value.

The store capacity remains 20. Reaching capacity rejects a new add with a
visible error. It must not evict the oldest context because an existing native
composer tag may still reference that context.

`consumeMany` remains atomic: validate every ID and snapshot every context
before removing any item. Duplicate, empty, oversized, unknown, or excessive
ID lists fail without partial consumption.

## Component boundaries

The redesign splits only the responsibilities that currently make
`examples/webmcp/src/main.ts` difficult to reason about.

### `comment-controller.ts`

Owns the interaction state machine and coordinates the map, popup, picker,
highlight controller, store, and marker view. It does not own WebMCP tool
registration or permanent status UI.

### `comment-popup.ts`

Owns progressive popup rendering, focus management, field validation messages,
candidate selection, and the add/cancel result. It does not write to the store.

### `feature-picker.ts`

Extends the existing picker to return safe candidate context plus temporary
highlight geometry. It retains the existing candidate and property bounds.

### `comment-highlight.ts`

Owns one reserved GeoJSON source and point, line, and polygon highlight layers.
It can preview one draft candidate or one focused pending comment. The
controller supplies draft geometry directly and pending geometry from
`PendingCommentVisualState`. The controller clears that visual state whenever
the matching store entry is removed. The highlight component reattaches its
reserved source and layers after `style.load` because ChatGPT style replacement
removes example-owned overlay layers.

Using a separate overlay avoids reliance on `feature-state`, which is not
available for every online vector feature. The overlay is visual only and does
not expand the model-facing payload.

### `comment-targets.ts`

Retains the existing module location but cleanly migrates its public example
symbols to `PendingMapComment` and `PendingMapCommentStore`. It validates,
freezes, adds, gets, atomically consumes, removes, and clears contexts.

### `comment-markers.ts`

Owns numbered markers, accessible annotation targets, read-only summaries,
pending highlight geometry, and visual cleanup. Each visible target is a
focusable DOM element with `data-selection-id`; its accessible text contains
the selection ID, stored comment, feature label, and scope. It asks the
highlight controller to reveal the associated geometry on hover, focus, or
activation.

### `main.ts`

Becomes the composition root. It creates the map, comment modules, status
drawer, reset lifecycle, core WebMCP registration, and selection-consumption
tool. It retains page and tool `AbortController` ownership.

## Basemap and resource policy

Production example startup uses:

```text
https://demotiles.maplibre.org/style.json
```

Requirements:

- enable visible MapLibre attribution rather than disabling it;
- allow same-origin resources and `https://demotiles.maplibre.org` through the
  existing WebMCP `resourcePolicy`;
- initialize at a useful world view supported by the demo style;
- reset by restoring the same remote style and clearing pending comments and
  activity;
- display a non-blocking error banner with Retry when the initial style cannot
  load;
- disable comment mode until a usable style has loaded.

The example README must state that the MapLibre demo host is free, keyless test
data and is not a production tile-service commitment.

## Error and lifecycle semantics

- No rendered feature: show a lightweight message; keep comment mode active.
- Picker or highlight failure: close only the current draft, clear temporary
  visuals, and keep existing pending comments intact.
- Invalid or oversized comment: preserve form input and show a field error.
- Store full: preserve form input and tell the user to submit or cancel an
  existing pending comment.
- Core WebMCP registration failure: abort the tool lifetime, show Site tools as
  unavailable, and leave the map, comment preview, drawer, and reset usable.
- The example always requests `allowMutations: true`. The selection tool
  registers only after the five core tools succeed; failure preserves the
  existing all-or-nothing six-tool example behavior.
- Unknown ID in a consume batch: return `NOT_FOUND` and remove nothing.
- Reset while a popup is open cancels the draft, clears all pending contexts and
  visuals, clears activity, and restores the remote style.
- Navigation, reload, or page lifetime abort clears page state. Existing native
  tags then become stale because UUID-based selection IDs are not reused.
- An external style replacement cancels an open draft because its candidate
  belongs to the prior style snapshot. Pending model contexts remain immutable,
  and their stored visual geometry is reattached after `style.load`.
- Consumed contexts remain consumed even if a later style mutation fails. The
  activity drawer exposes the later failure, and ChatGPT can explain or retry
  the map operation without replaying stale comments.

## Accessibility

- The comment-mode control has an accessible name, visible focus, and
  `aria-pressed` state.
- Popup focus moves to the first relevant control and returns to the map canvas
  on draft cancel. Leaving comment mode returns focus to the comment control.
- Escape with an open popup cancels that draft and stays in comment mode;
  Escape with no popup exits comment mode.
- Candidate choices, scope controls, validation messages, pending pins, and
  remove actions are keyboard reachable.
- Candidate and pin labels include meaningful feature names where available,
  never only color or marker number.
- Status updates use a polite live region.
- The online basemap retains visible attribution.

## Detailed collaboration scenario

1. The user opens the example in the latest supported ChatGPT built-in browser
   or equivalent browser-plugin environment with Site tools enabled, an
   eligible account, and a supported model.
2. The page loads the online vector style and registers six tools.
3. The Site tools indicator reports registration availability; technical
   details remain in the collapsed bottom drawer.
4. The user activates comment mode and clicks a road.
5. If several features overlap, the user selects the road in popup step one.
6. The user writes “Make this road a more prominent blue,” chooses the whole
   layer, and adds the comment.
7. The page stores `map-selection-<uuid-a>` and displays pin 1.
8. In native Annotation mode, the user selects pin 1 or its accessible summary;
   the plugin creates the corresponding ChatGPT composer tag.
9. The user repeats the page flow for water, writes “Reduce this fill opacity,”
   chooses the matching property class, and creates `map-selection-<uuid-b>`.
   The user annotates that target to create the second native tag.
10. In ChatGPT, the user adds free text after the tags: “Keep both changes in a
    restrained, consistent cool palette.”
11. On submission, ChatGPT first calls
    `consumeMapSelectionContexts({ selectionIds:
    ["map-selection-<uuid-a>", "map-selection-<uuid-b>"] })`.
12. The page returns both immutable contexts and removes both pins and targets.
13. ChatGPT calls `inspectStyle` or `queryMapFeatures` if needed, then applies a
    bounded `applyStyleTransaction`.
14. The live map changes, and revision, style hash, and invocation activity
    update in the drawer.
15. ChatGPT reports what changed in its own conversation UI.

## Automated testing

### Unit tests

Cover:

- comment normalization, lower and upper length bounds, and deep immutability;
- all three scope variants and their preconditions;
- capacity rejection without eviction;
- atomic multi-ID consumption and no partial removal;
- remove, clear, and cleanup callbacks;
- popup transitions, candidate selection, scope availability, add, cancel, and
  the two-stage Escape behavior;
- all-rendered-feature picking, topmost ordering, deduplication before the
  ten-candidate bound, property projection, and geometry projection;
- point, line, and polygon highlights;
- highlight restoration after a style reload;
- controller transitions and cleanup on reset or abort.

### Playwright example tests

Automated tests must not depend on the public demo service. Intercept the remote
style request and serve a deterministic test style and data while keeping the
production URL unchanged.

Cover:

- map-first layout and collapsed technical drawer;
- comment control entry and exit;
- single and overlapping candidate paths;
- candidate-preview highlight changes;
- required comment validation and the 1,000-character boundary;
- every scope and its disabled-state explanation;
- add, draft cancel, pending cancel, consecutive adds, and Escape;
- compact pins, read-only summaries, and on-demand highlights;
- multiple ID batch consumption;
- all-or-nothing behavior for an invalid batch;
- reset and style-reload visual cleanup;
- unsupported WebMCP local preview;
- no page errors, console errors, failed required resources, or unapproved
  external origins.

### Native ChatGPT manual acceptance

Native composer tags have no public automation API. Run this checklist in the
latest ChatGPT desktop built-in browser or equivalent supported plugin
environment with Site tools enabled, an eligible account, a supported model,
site access approved, and native Annotation mode available:

1. Confirm two read and four write Site tools.
2. Add two page comments, then use native Annotation mode on their pins or
   summaries; confirm two native composer tags contain the visible selection
   identities and comment context.
3. Add extra free-form text after the tags.
4. Submit and confirm one batch `consumeMapSelectionContexts` call occurs before
   related style-tool calls. This is agent behavior verified here, not a
   page-enforced ordering rule.
5. Confirm referenced pins disappear before the map changes.
6. Confirm the requested style changes appear on the live map.
7. Create a native tag, cancel its pending page comment, and submit that stale
   tag together with one valid tag. Confirm the batch returns `NOT_FOUND` and
   the valid page context remains. Remove the stale native tag manually.
8. Reload or reset with an existing native tag and confirm the same stale-ID
   safety behavior; UUID selection IDs must not bind it to a new context.
9. Disable Site tools and reload; confirm the map and local preview remain
   usable and clearly identify the unsupported state.

## Completion criteria

The redesign is complete when:

- the map occupies the primary viewport and no permanent right panel remains;
- the map control exposes a persistent comment mode;
- every feature-bearing result returned by the all-visible rendered-feature
  query is eligible before deduplication, with the topmost ten presented when
  more candidates overlap;
- overlapping candidates use the approved progressive popup;
- selection preview and pending comments use temporary GeoJSON highlighting;
- the popup supports bounded draft text, the three approved scopes, add, and
  cancel;
- pending comments use numbered pins with on-demand highlight and read-only
  summary;
- added contexts are immutable and are never silently evicted;
- native ChatGPT tags can reference the accessible selection targets through
  native Annotation mode without any project-owned ChatGPT UI;
- ChatGPT can batch-consume comments and adjust the live map through the
  existing tools;
- the live example uses the free MapLibre demo style with attribution and a
  bounded resource policy;
- automated tests cover page-owned behavior and the documented manual checklist
  covers native plugin behavior.
