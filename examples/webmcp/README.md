# WebMCP MapLibre example

This standalone Vite page shows a collaborative map-comment workflow for a
live MapLibre map. It uses the free, keyless
[`demotiles.maplibre.org`](https://demotiles.maplibre.org/) demo style. Keep
the visible map attribution intact, and do not use this public demo tile
service for production traffic.

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
then. Turn it on, then click the map. When rendered features overlap, choose
the intended candidate and select the explicit **Next** button before drafting
the comment. Enter a non-empty comment of at most 1,000 characters, choose one
of these scopes, and select **Add**:

- **Feature** — one feature (requires a stable feature ID).
- **Property class** — features in this layer with a selected scalar property
  value.
- **Layer** — all features in this layer.

Use **Cancel** to abandon a draft. Adding a comment creates a numbered,
persistent map pin and an accessible summary containing the selection UUID,
visible feature identity, scope, and comment context. Focusing, hovering, or
opening its pin highlights the selected geometry on demand; the pin's
**Cancel pending comment** action removes that pin and its pending context.
After **Add**, comment mode stays active so another map comment can be added.

## Native Annotation handoff and submission

The page does not create a ChatGPT composer tag. After page **Add**, use native
**Annotation** mode to annotate the accessible pin or its summary. This is the
handoff boundary: native Annotation creates the composer tag, which includes
the visible selection identity and comment context. Add any extra ChatGPT text
needed in the composer, then submit one or several tags.

For submitted tags, expect ChatGPT to make one batch
`consumeMapSelectionContexts` call with all related selection UUIDs **before**
calling the applicable style tools. The pending pins must disappear before the
requested live style change appears. A UUID from a cancelled pin, page reset,
or reload is stale: consumption safely returns `NOT_FOUND`; remove the stale
native composer tag manually and submit only current tags.

Native tag creation and submission remain manual acceptance checks because
there is no public composer automation API. Behavioral verification uses
headless Chromium for the page-owned flow and native-plugin manual acceptance
for this handoff; it does not use Playwright runtime automation.

See the [WebMCP draft](https://webmachinelearning.github.io/webmcp/) and the
[OpenAI Site tools guide](https://help.openai.com/en/articles/20001423-using-site-tools-in-the-chatgpt-desktop-app).
