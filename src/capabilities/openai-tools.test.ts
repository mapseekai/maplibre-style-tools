import assert from 'node:assert/strict';
import test from 'node:test';
import { z } from 'zod';

import { styleOperationSchema } from '../core/index.js';
import {
  capabilityRegistry,
  createAnthropicTools,
  createOpenAiFunctionTools,
} from './index.js';

type JsonSchema = Record<string, unknown>;

const literalStringsForProperty = (schema: unknown, property: string): string[] => {
  const values = new Set<string>();
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    const record = value as JsonSchema;
    const nested = record.properties;
    if (typeof nested === 'object' && nested !== null && !Array.isArray(nested)) {
      const propertySchema = (nested as JsonSchema)[property];
      if (typeof propertySchema === 'object' && propertySchema !== null && !Array.isArray(propertySchema)) {
        const candidate = propertySchema as JsonSchema;
        if (typeof candidate.const === 'string') values.add(candidate.const);
        if (Array.isArray(candidate.enum)) {
          candidate.enum.filter((item): item is string => typeof item === 'string').forEach((item) => values.add(item));
        }
      }
    }
    Object.values(record).forEach(walk);
  };
  walk(schema);
  return [...values].sort();
};

const jsonSchema = (schema: z.ZodType): unknown => z.toJSONSchema(schema, {
  target: 'draft-07',
  reused: 'inline',
  unrepresentable: 'any',
});

test('OpenAI function tools mirror public capability names and canonical action/operation enums', () => {
  const tools = createOpenAiFunctionTools();
  assert.deepEqual(
    tools.map((tool) => tool.function.name),
    Object.keys(capabilityRegistry),
  );

  const byName = Object.fromEntries(tools.map((tool) => [tool.function.name, tool]));
  const inspect = byName.inspectStyle;
  const transaction = byName.applyStyleTransaction;
  assert.ok(inspect !== undefined);
  assert.ok(transaction !== undefined);

  assert.deepEqual(
    literalStringsForProperty(inspect.function.parameters, 'action'),
    literalStringsForProperty(jsonSchema(capabilityRegistry.inspectStyle.modelInputSchema), 'action'),
  );
  const canonicalOperations = literalStringsForProperty(jsonSchema(styleOperationSchema), 'op');
  assert.ok(canonicalOperations.length > 0);
  assert.deepEqual(
    literalStringsForProperty(transaction.function.parameters, 'op'),
    canonicalOperations,
  );
});

test('OpenAI function parameters are root objects rather than root unions', () => {
  for (const tool of createOpenAiFunctionTools()) {
    const parameters = tool.function.parameters;
    assert.equal(parameters.type, 'object', `${tool.function.name} must have an object root`);
    assert.equal(Object.hasOwn(parameters, 'oneOf'), false, `${tool.function.name} must not have a root oneOf`);
    assert.equal(Object.hasOwn(parameters, 'anyOf'), false, `${tool.function.name} must not have a root anyOf`);
  }
});

test('OpenAI transaction parameters exclude the unsupported empty-tuple branch', () => {
  assert.equal(
    capabilityRegistry.applyStyleTransaction.modelInputSchema.safeParse({
      transaction: { operations: [] },
    }).success,
    false,
  );

  const transaction = createOpenAiFunctionTools().find(
    (tool) => tool.function.name === 'applyStyleTransaction',
  );
  assert.ok(transaction !== undefined);
  assert.equal(JSON.stringify(transaction.function.parameters).includes('"items":[]'), false);
});

test('Anthropic tools use the same capability names and normalized input schemas', () => {
  const openAiByName = Object.fromEntries(createOpenAiFunctionTools().map((tool) => [
    tool.function.name,
    tool.function,
  ]));
  const anthropicTools = createAnthropicTools();
  assert.deepEqual(
    anthropicTools.map((tool) => tool.name),
    Object.keys(capabilityRegistry),
  );
  for (const tool of anthropicTools) {
    const openAi = openAiByName[tool.name];
    assert.ok(openAi !== undefined);
    assert.deepEqual(tool.input_schema, openAi.parameters);
  }
});
