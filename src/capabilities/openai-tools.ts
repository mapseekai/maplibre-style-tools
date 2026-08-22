import { capabilityRegistry, type CapabilityName } from './registry.js';
import { toModelJsonSchema, type CapabilityModelJsonSchema } from './model-schema.js';

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
  readonly parameters: CapabilityModelJsonSchema;
}

const createCapabilityToolDefinitions = (): readonly CapabilityToolDefinition[] => Object.freeze(
  (Object.keys(capabilityRegistry) as CapabilityName[]).map((name) => {
    const capability = capabilityRegistry[name];
    return Object.freeze({
      name,
      description: capability.description,
      parameters: toModelJsonSchema(capability.modelInputSchema),
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
