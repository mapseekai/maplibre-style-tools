# WebMCP MapLibre example

This standalone Vite page shows a collaborative map-comment workflow for a
live MapLibre map. It uses the free, keyless
[`demotiles.maplibre.org`](https://demotiles.maplibre.org/) demo style. Keep
the visible map attribution intact, and do not use this public demo tile
service for production traffic.

## Live demo

The latest `main` build is deployed to GitHub Pages:
<https://mapseekai.github.io/maplibre-style-tools/>. It is served over HTTPS
(a secure context), so Site-tools detection works exactly as on localhost.

## Prerequisites and startup

1. Use the latest supported ChatGPT desktop built-in browser, or an equivalent
   plugin environment that supports WebMCP Site tools.
2. Use an eligible account and supported model, enable Site tools, approve
   access to this site, and ensure native **Annotation** mode is available.
3. From the repository root, run:

   ```sh
   rtk pnpm run example:dev:webmcp
   ```

4. Open `http://127.0.0.1:5175`.

The page exposes six Site tools:

- **Read-only:** `inspectStyle`, `queryMapFeatures`
- **Map mutations:** `applyStyleTransaction`, `applyStyleDocument`,
  `runMapCommand`, `consumeMapSelectionContexts`

If the browser does not support Site tools, the page remains a local preview:
the demo map and its comment controls still work, while the Site tools status
reports that they are unavailable.

## Page-owned map comments

Wait for the style to load; the **Add map comment** control is disabled until
then. Turn it on — the map cursor switches to a comment glyph — then click the
map. When rendered features overlap, choose the intended candidate and select
**下一步 (Next)** before drafting the comment. Enter a non-empty comment of at
most 1,000 characters, choose one of these scopes, and select **添加 (Add)**:

- **要素 (Feature)** — one feature (requires a stable feature ID).
- **属性类 (Property class)** — features in this layer with a selected scalar
  property value.
- **图层 (Layer)** — all features in this layer.

Use **取消 (Cancel)** to abandon a draft. Clicking another map location with
an empty draft discards it and starts a new one there; a draft that already
contains text is protected and clicks elsewhere are ignored. Adding a comment
creates a numbered, persistent map pin (pins always renumber from 1) whose
accessible summary contains the selection UUID, visible feature identity,
scope, and comment context. Clicking a pin reopens the same popup in edit
mode with **保存 (Save)**, **删除 (Delete)**, and **取消 (Cancel)**; hovering
or focusing a pin still highlights the selected geometry on demand. After
**添加**, comment mode stays active so another map comment can be added.

Pending comments are listed in the **地图评论 (Map comments)** panel at the
top right. Each entry shows the feature label and scope badge; the pin icon
locates and expands the map pin, the pencil edits the comment text in place
(the scope and feature stay fixed), and the trash icon deletes the entry.

## Custom styles

The technical drawer's **Custom style** section loads any MapLibre style by
URL or by pasting a style JSON document. Loading a custom style clears all
pending comments and pins because their feature references belong to the
previous style.

## Native Annotation handoff and submission

**提交给 ChatGPT (Submit to ChatGPT)** in the panel locks every pending
comment, removes their map pins, and shows a Chinese digest of the submitted
comments. The digest is auto-selected and copied to the clipboard as a
convenience, but no manual composer step is required: there is no public API
for the page to create native composer tags, so submission relies on the
consumption tool instead.

For submitted comments, expect ChatGPT to call `consumeMapSelectionContexts`
**before** calling the applicable style tools. The tool accepts an explicit
`selectionIds` list; when omitted, it consumes **every submitted comment at
once**, so ChatGPT can process the whole submission directly after the user
asks for it. Consumed pins disappear before the requested live style change
appears. A UUID from a deleted comment, page reset, or reload is stale:
consumption safely returns `NOT_FOUND`.

Verify the page-owned flow with headless Chromium or a manual browser session.

See the [WebMCP draft](https://webmachinelearning.github.io/webmcp/) and the
[OpenAI Site tools guide](https://help.openai.com/en/articles/20001423-using-site-tools-in-the-chatgpt-desktop-app).
