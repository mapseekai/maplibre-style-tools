# maplibre-style-tools

AI SDK tools for inspecting and editing MapLibre GL styles.

The package exposes a compact tool set for token-efficient workflows and a full tool set for broad style editing. It is currently maintained as a standalone local project and has not been published to npm.

## Requirements

- Node.js 22 or newer
- `maplibre-gl` 5.21 or a compatible release
- An AI SDK 6 tool consumer

## Local installation

Build the package once, then add it from a sibling project:

```bash
cd ../maplibre-style-tools
pnpm install
pnpm run build
cd ../your-project
pnpm add ../maplibre-style-tools
pnpm add maplibre-gl
```

## Compact tools

```ts
import { createCompactMapLibreStyleTools } from 'maplibre-style-tools';

const tools = createCompactMapLibreStyleTools({
  getMap: () => map,
  getContext: () => ({
    activeSourceId: 'basemap',
    selectedLayerId: 'road-primary',
  }),
});
```

The compact factory provides style context, layer search and inspection, validated batch operations, and patch JSON validation.

## Full tools

```ts
import { createMapLibreStyleTools } from 'maplibre-style-tools';

const tools = createMapLibreStyleTools({
  getMap: () => map,
});
```

The full factory exposes detailed tools for layers, sources, paint and layout properties, filters, zoom ranges, metadata, camera, terrain, sprites, glyphs, images, and other MapLibre style features.

## Development

```bash
pnpm install
pnpm run lint
pnpm run typecheck
pnpm run build
pnpm test
npm pack --dry-run
```

Build output is written to `dist/`. Tests use Node's built-in test runner and compile into `.tmp/test-dist/`.
