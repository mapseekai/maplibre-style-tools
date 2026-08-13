#!/usr/bin/env node

import {
  createStyleSessionStore,
  runStdioMcp,
} from '../dist/mcp/main.js';
import { writeMcpStderrLine } from '../dist/mcp/stdio.js';

const evaluationIds = Object.freeze(Array.from(
  { length: 10 },
  (_unused, index) => `eval-${String(index + 1).padStart(2, '0')}`,
));

const evaluationStyle = Object.freeze({
  version: 8,
  name: 'MapLibre Style MCP read-only evaluation fixture',
  metadata: { purpose: 'deterministic-read-only-evaluation' },
  sources: {
    basemap: {
      type: 'vector',
      tiles: ['https://example.test/{z}/{x}/{y}.pbf'],
    },
    points: {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { name: 'Alpha' },
            geometry: { type: 'Point', coordinates: [0, 0] },
          },
          {
            type: 'Feature',
            properties: { name: 'Beta' },
            geometry: { type: 'Point', coordinates: [1, 1] },
          },
        ],
      },
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#ffffff' } },
    {
      id: 'roads',
      type: 'line',
      source: 'basemap',
      'source-layer': 'transportation',
      paint: { 'line-color': '#336699' },
    },
    {
      id: 'boundaries',
      type: 'fill',
      source: 'basemap',
      'source-layer': 'boundaries',
      paint: { 'fill-color': '#cccccc' },
    },
    {
      id: 'places',
      type: 'circle',
      source: 'points',
      paint: { 'circle-color': '#cc3300' },
    },
  ],
});

const createEvalIdFactory = () => {
  let next = 0;
  return () => {
    const sessionId = evaluationIds[next];
    next += 1;
    if (sessionId === undefined) throw new Error('evaluation session capacity exceeded');
    return sessionId;
  };
};

const seedAndAssertTenSessions = async (store) => {
  for (const expectedSessionId of evaluationIds) {
    const opened = await store.open(evaluationStyle);
    if (opened.sessionId !== expectedSessionId || opened.revision !== 0) {
      throw new Error('evaluation session seeding failed');
    }
  }
};

const run = async () => {
  const store = createStyleSessionStore({ idFactory: createEvalIdFactory() });
  let started;
  try {
    await seedAndAssertTenSessions(store);
    started = await runStdioMcp({
      serverOptions: { store },
      startupDiagnosticLine: null,
    });
    await started.closed;
  } finally {
    try {
      if (started !== undefined) await started.close();
    } finally {
      store.dispose();
    }
  }
};

try {
  await run();
} catch {
  try {
    await writeMcpStderrLine(
      process.stderr,
      'maplibre-style-mcp evaluation fixture failed',
    );
  } catch {
    // A stderr failure cannot be reported recursively.
  }
  process.exitCode = 1;
}
