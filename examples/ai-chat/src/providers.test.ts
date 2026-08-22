import assert from 'node:assert/strict';
import test from 'node:test';

import { createProviderSettings } from './providers.js';

test('maps an OpenAI-compatible selection to its provider configuration', () => {
  const settings = createProviderSettings({
    provider: 'openai',
    baseUrl: 'https://gateway.example/v1/',
    apiKey: 'test-key',
    model: 'chat-model',
  });

  assert.deepEqual(settings, {
    provider: 'openai',
    baseURL: 'https://gateway.example/v1/',
    apiKey: 'test-key',
    model: 'chat-model',
  });
});

test('maps an Anthropic selection to its provider configuration and browser header', () => {
  const settings = createProviderSettings({
    provider: 'anthropic',
    baseUrl: 'https://proxy.example/v1',
    apiKey: 'test-key',
    model: 'claude-model',
  });

  assert.deepEqual(settings, {
    provider: 'anthropic',
    baseURL: 'https://proxy.example/v1',
    apiKey: 'test-key',
    model: 'claude-model',
    headers: { 'anthropic-dangerous-direct-browser-access': 'true' },
  });
});
