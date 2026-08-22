import assert from 'node:assert/strict';
import test from 'node:test';

import { createMapLibreStyleTools } from '../ai/tools.js';
import {
  capabilityModelJsonSchema,
  toModelJsonSchema,
} from './model-schema.js';
import {
  capabilityRegistry,
  createAnthropicTools,
  createOpenAiFunctionTools,
} from './index.js';
import { z } from 'zod';

const capabilityNames = [
  'inspectStyle',
  'applyStyleTransaction',
  'applyStyleDocument',
  'runMapCommand',
  'queryMapFeatures',
] as const;

const stripSchemaVersion = (schema: Record<string, unknown>): Record<string, unknown> => {
  const rest = { ...schema };
  Reflect.deleteProperty(rest, '$schema');
  return rest;
};

/**
 * Canonical serialization for schema comparison: key-sorted, with tuple
 * `items`/`prefixItems` merged. Converter re-interpretation (zod's
 * fromJSONSchema, the MCP SDK's to-json-schema) must not change semantics;
 * byte-level key order is not a contract.
 */
const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const rawProperties = record.properties as Record<string, unknown> | undefined;
    const rawRequired = Array.isArray(record.required) ? record.required as unknown[] : undefined;
    const filteredRequired = rawRequired !== undefined && rawProperties !== null && typeof rawProperties === 'object'
      ? rawRequired.filter((name) => {
        const property = rawProperties?.[String(name)];
        return !(property !== null && typeof property === 'object' && 'default' in (property as Record<string, unknown>));
      })
      : rawRequired;
    const entries = Object.entries(record)
      .map(([key, item]) => [
        key === 'prefixItems' ? 'items' : key === 'anyOf' ? 'oneOf' : key,
        canonicalize(item),
      ] as const)
      .filter(([key]) => key !== 'default' && key !== 'additionalProperties')
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    const object = Object.fromEntries(entries) as Record<string, unknown>;
    if (object.enum !== undefined) Reflect.deleteProperty(object, 'type');
    if (filteredRequired !== undefined) {
      if (filteredRequired.length > 0) object.required = filteredRequired.map(canonicalize);
      else Reflect.deleteProperty(object, 'required');
    }
    return object;
  }
  return value;
};

const assertCanonicallyEqual = (
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
  label: string,
): void => {
  assert.deepEqual(canonicalize(stripSchemaVersion(actual)), canonicalize(expected), label);
};

test('OpenAI and Anthropic advertise exactly the shared model JSON schema', () => {
  const openai = createOpenAiFunctionTools();
  const anthropic = createAnthropicTools();
  for (const name of capabilityNames) {
    const expected = capabilityModelJsonSchema(name);
    assert.deepEqual(
      openai.find((tool) => tool.function.name === name)?.function.parameters,
      expected,
      `${name} OpenAI parameters`,
    );
    assert.deepEqual(
      anthropic.find((tool) => tool.name === name)?.input_schema,
      expected,
      `${name} Anthropic input_schema`,
    );
  }
});

test('AI SDK tools advertise the same model JSON schema', () => {
  const tools = createMapLibreStyleTools({ getMap: () => null });
  for (const name of capabilityNames) {
    const inputSchema = tools[name].inputSchema as z.ZodType;
    const converted = z.toJSONSchema(inputSchema, {
      target: 'draft-07',
      reused: 'inline',
      unrepresentable: 'any',
    });
    assertCanonicallyEqual(
      converted as Record<string, unknown>,
      capabilityModelJsonSchema(name),
      `${name} AI SDK inputSchema`,
    );
  }
});

test('every model JSON schema stays convertible for providers', () => {
  for (const name of capabilityNames) {
    // Providers serialize the advertised schema to JSON Schema; the registry's
    // strict schemas embed zod custom types, so the shared projection must
    // round-trip through zod without throwing.
    const raw = capabilityModelJsonSchema(name);
    assert.doesNotThrow(() => z.toJSONSchema(z.fromJSONSchema(raw)));
    assertCanonicallyEqual(
      z.toJSONSchema(z.fromJSONSchema(raw)) as Record<string, unknown>,
      raw,
      `${name} round trip`,
    );
  }
  void toModelJsonSchema;
  void capabilityRegistry;
});
