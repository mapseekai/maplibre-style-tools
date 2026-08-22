import { z } from 'zod';

import { capabilityRegistry, type CapabilityName } from './registry.js';

export type OpenAiFunctionParameters = Readonly<Record<string, unknown>>;
export interface OpenAiFunctionTool {
  readonly type: 'function';
  readonly function: {
    readonly name: CapabilityName;
    readonly description: string;
    readonly parameters: OpenAiFunctionParameters;
  };
}
export interface AnthropicTool {
  readonly name: CapabilityName;
  readonly description: string;
  readonly input_schema: OpenAiFunctionParameters;
}

interface CapabilityToolDefinition {
  readonly name: CapabilityName;
  readonly description: string;
  readonly parameters: OpenAiFunctionParameters;
}

const isSchemaObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeRootUnion = (schema: Record<string, unknown>): Record<string, unknown> => {
  const union = Array.isArray(schema.oneOf)
    ? schema.oneOf
    : Array.isArray(schema.anyOf)
      ? schema.anyOf
      : undefined;
  if (union === undefined) return schema;

  const propertyNames = new Set<string>();
  for (const branch of union) {
    if (!isSchemaObject(branch) || branch.type !== 'object' || !isSchemaObject(branch.properties)) {
      throw new TypeError('A root function schema union must contain object branches.');
    }
    Object.keys(branch.properties).forEach((name) => propertyNames.add(name));
  }

  const rest = { ...schema };
  Reflect.deleteProperty(rest, 'oneOf');
  Reflect.deleteProperty(rest, 'anyOf');
  return {
    ...rest,
    type: 'object',
    properties: Object.fromEntries([...propertyNames].map((name) => [name, {}])),
    additionalProperties: false,
    allOf: [{ anyOf: union }],
  };
};

const toFunctionParameters = (schema: z.ZodType): OpenAiFunctionParameters => {
  const converted = z.toJSONSchema(schema, {
    target: 'draft-07',
    reused: 'inline',
    unrepresentable: 'any',
  });
  if (typeof converted !== 'object' || converted === null || Array.isArray(converted)) {
    throw new TypeError('A function tool input schema must convert to a JSON Schema object.');
  }
  const parameters = { ...(converted as Record<string, unknown>) };
  Reflect.deleteProperty(parameters, '$schema');
  return Object.freeze(normalizeRootUnion(parameters));
};

const createCapabilityToolDefinitions = (): readonly CapabilityToolDefinition[] => Object.freeze(
  (Object.keys(capabilityRegistry) as CapabilityName[]).map((name) => {
    const capability = capabilityRegistry[name];
    return Object.freeze({
      name,
      description: capability.description,
      parameters: toFunctionParameters(capability.modelInputSchema),
    });
  }),
);

export const createOpenAiFunctionTools = (): readonly OpenAiFunctionTool[] => Object.freeze(
  createCapabilityToolDefinitions().map((definition) => Object.freeze({
    type: 'function' as const,
    function: Object.freeze(definition),
  })),
);

export const createAnthropicTools = (): readonly AnthropicTool[] => Object.freeze(
  createCapabilityToolDefinitions().map((definition) => Object.freeze({
    name: definition.name,
    description: definition.description,
    input_schema: definition.parameters,
  })),
);
