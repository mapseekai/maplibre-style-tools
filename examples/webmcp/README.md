# WebMCP MapLibre example

This standalone Vite page exposes two read-only and four write Site tools for
the live MapLibre map. Automated Playwright coverage uses a page-scoped fake
WebMCP host; use the following checklist for the native ChatGPT Desktop path.

## Native ChatGPT Desktop checklist

1. Run `pnpm run example:dev:webmcp` from the repository root.
2. Open `http://127.0.0.1:5175` in the ChatGPT desktop app's built-in browser.
3. Use GPT-5.6 Sol or Terra and enable Site tools.
4. Open the Site tools list and confirm two read tools (`inspectStyle` and
   `queryMapFeatures`) and four write tools (`applyStyleTransaction`,
   `applyStyleDocument`, `runMapCommand`, and
   `consumeMapSelectionContexts`).
5. Exercise style inspection, a rendered or source feature query, a style
   transaction, a runtime command, and an allowed Style document replacement.
6. Turn on Annotation mode. Select a map feature, create a target, and submit
   one comment for each scope: **Single feature**, **Matching property value in
   this layer**, and **All features in this layer**.
7. For each submitted comment, confirm ChatGPT calls
   `consumeMapSelectionContexts` first. The corresponding target card and map
   marker must disappear before the core tools update the map.
8. Submit several native comments in one composer message and verify ChatGPT
   consumes all referenced selection IDs in one batch before applying the map
   changes.
9. Disable Site tools in Browser settings and reload the page. Confirm the map,
   feature picker, target controls, and **Reset local map** button remain usable.

Native Annotation comments and composer submission are manual checks because
ChatGPT's Annotation overlay has no public automation API. The automated suite
therefore verifies the page-owned picker, target lifecycle, batch-consumption
contract, reset behavior, and unsupported fallback without attempting to
automate ChatGPT UI.

As of 2026-08-27, Site tools require an eligible ChatGPT account, a supported
model, and the ChatGPT desktop built-in browser. Availability can vary during
rollout. See the [WebMCP draft](https://webmachinelearning.github.io/webmcp/),
[OpenAI Site tools guide](https://help.openai.com/en/articles/20001423-using-site-tools-in-the-chatgpt-desktop-app),
and [OpenAI built-in browser guide](https://help.openai.com/en/articles/20001277-using-the-built-in-browser-in-the-chatgpt-desktop-app).
