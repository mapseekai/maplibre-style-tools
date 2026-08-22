import assert from 'node:assert/strict';
import test from 'node:test';

import { createAnthropicTools, createOpenAiFunctionTools } from 'maplibre-style-tools/capabilities';

import {
  requestAnthropicCompletion,
  requestOpenAiCompletion,
  type OpenAiChatMessage,
} from './providers.js';

const messages: OpenAiChatMessage[] = [{ role: 'user', content: 'inspect the map' }];

test('OpenAI-compatible requests always retain auto tool choice', async () => {
  const originalFetch = globalThis.fetch;
  let body: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_input, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: 'done' }, finish_reason: 'stop' }],
    }));
  }) as typeof fetch;
  try {
    await requestOpenAiCompletion({
      baseUrl: 'https://example.test/v1',
      apiKey: 'test-key',
      model: 'test-model',
      messages,
      tools: createOpenAiFunctionTools(),
      maxCompletionTokens: 1024,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(body?.tool_choice, 'auto');
});

test('Anthropic requests opt into direct browser access for CORS', async () => {
  const originalFetch = globalThis.fetch;
  let headers: Record<string, string> | undefined;
  globalThis.fetch = (async (_input, init) => {
    headers = Object.fromEntries(new Headers(init?.headers).entries());
    return new Response(JSON.stringify({
      content: [{ type: 'text', text: 'done' }],
      stop_reason: 'end_turn',
    }));
  }) as typeof fetch;
  try {
    await requestAnthropicCompletion({
      baseUrl: 'https://example.test/v1',
      apiKey: 'test-key',
      model: 'test-model',
      system: 'system prompt',
      messages: [{ role: 'user', content: 'inspect the map' }],
      tools: createAnthropicTools(),
      maxTokens: 1024,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  // Without this header api.anthropic.com rejects the browser CORS preflight.
  assert.equal(headers?.['anthropic-dangerous-direct-browser-access'], 'true');
});

type HasForcedToolName = 'forcedToolName' extends keyof Parameters<
  typeof requestOpenAiCompletion
>[0] ? false : true;
const hasNoForcedToolName: HasForcedToolName = true;
assert.equal(hasNoForcedToolName, true);
