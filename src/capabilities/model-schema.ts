import { z } from 'zod';

import { capabilityRegistry, type CapabilityName } from './registry.js';

export type CapabilityModelJsonSchema = Readonly<Record<string, unknown>>;

const isSchemaObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeRootUnion = (schema: Record<string, unknown>): Record<string, unknown> => {
  const union = Array.isArray(schema.oneOf)
    ? schema.oneOf
    : Array.isArray(schema.anyOf)
      ? schema.anyOf
      : undefined;
  if (union === undefined) return schema;

  const branches = union.filter(isSchemaObject);
  if (branches.length !== union.length
    || branches.some((branch) => branch.type !== 'object' || !isSchemaObject(branch.properties))) {
    throw new TypeError('A root function schema union must contain object branches.');
  }

  const propertyNames = new Set<string>();
  const requiredSets: string[][] = [];
  for (const branch of branches) {
    const branchProperties = branch.properties as Record<string, unknown>;
    Object.keys(branchProperties).forEach((name) => propertyNames.add(name));
    requiredSets.push(Array.isArray(branch.required) ? branch.required as string[] : []);
  }

  // Merge every branch's properties into one object schema so the advertised
  // shape keeps an object root (OpenAI-compatible endpoints reject oneOf
  // roots). Discriminator consts lift to an enum; fields that differ across
  // branches become a per-property oneOf; required is the branch intersection.
  const mergeAppearances = (appearances: Array<Record<string, unknown>>): Record<string, unknown> => {
    const unique: Array<Record<string, unknown>> = [];
    for (const appearance of appearances) {
      const key = JSON.stringify(appearance);
      if (!unique.some((candidate) => JSON.stringify(candidate) === key)) unique.push(appearance);
    }
    if (unique.length === 1) return unique[0];
    return { anyOf: unique };
  };
  const properties: Record<string, unknown> = {};
  for (const name of propertyNames) {
    const appearances = branches
      .map((branch) => (branch.properties as Record<string, unknown>)[name] as Record<string, unknown> | undefined)
      .filter((property): property is Record<string, unknown> => property !== undefined);
    const constants = appearances
      .map((property) => property.const)
      .filter((value) => value !== undefined);
    properties[name] = constants.length === appearances.length && constants.length > 0
      ? { enum: [...new Set(constants)] }
      : mergeAppearances(appearances);
  }
  const required = requiredSets.reduce(
    (common, set) => common.filter((name) => set.includes(name)),
    requiredSets[0] ?? [],
  );

  const rest = { ...schema };
  Reflect.deleteProperty(rest, 'oneOf');
  Reflect.deleteProperty(rest, 'anyOf');
  return {
    ...rest,
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  };
};

/**
 * Single source of truth for the model-facing JSON Schema of a capability.
 *
 * The strict validation schemas in the registry embed zod custom/transform
 * types (jsonValueSchema etc.) that no zod-to-JSON-Schema converter can
 * represent; `unrepresentable: 'any'` maps those leaves to `{}` so the
 * advertised shape stays valid JSON Schema while execution still validates
 * with the strict schema. OpenAI, Anthropic, AI SDK, and MCP surfaces all
 * derive their advertised input from this projection.
 */
export const toModelJsonSchema = (schema: z.ZodType): CapabilityModelJsonSchema => {
  const converted = z.toJSONSchema(schema, {
    target: 'draft-07',
    reused: 'inline',
    unrepresentable: 'any',
  });
  if (typeof converted !== 'object' || converted === null || Array.isArray(converted)) {
    throw new TypeError('A capability model schema must convert to a JSON Schema object.');
  }
  const parameters = { ...(converted as Record<string, unknown>) };
  Reflect.deleteProperty(parameters, '$schema');
  return Object.freeze(normalizeRootUnion(parameters));
};

export const capabilityModelJsonSchema = (name: CapabilityName): CapabilityModelJsonSchema =>
  toModelJsonSchema(capabilityRegistry[name].modelInputSchema);

const withNumberConstraints = (schema: Record<string, unknown>, base: z.ZodNumber): z.ZodNumber => {
  let result = base;
  if (typeof schema.minimum === 'number') result = result.min(schema.minimum);
  if (typeof schema.maximum === 'number') result = result.max(schema.maximum);
  if (typeof schema.exclusiveMinimum === 'number') result = result.gt(schema.exclusiveMinimum);
  if (typeof schema.exclusiveMaximum === 'number') result = result.lt(schema.exclusiveMaximum);
  return result;
};

const withStringConstraints = (schema: Record<string, unknown>, base: z.ZodString): z.ZodString => {
  let result = base;
  if (schema.format === 'uri') result = result.url();
  if (typeof schema.minLength === 'number') result = result.min(schema.minLength);
  if (typeof schema.maxLength === 'number') result = result.max(schema.maxLength);
  return result;
};

const withArrayConstraints = (schema: Record<string, unknown>, base: z.ZodArray<z.ZodType>): z.ZodArray<z.ZodType> => {
  let result = base;
  if (typeof schema.minItems === 'number') result = result.min(schema.minItems);
  if (typeof schema.maxItems === 'number') result = result.max(schema.maxItems);
  return result;
};

/**
 * Structural JSON Schema → zod builder for advertised input schemas.
 *
 * `z.fromJSONSchema` synthesizes objects whose `required` enforcement the MCP
 * SDK converter cannot read back, silently dropping required markers on nested
 * objects. Building plain zod primitives (z.object with required properties,
 * z.union, z.tuple) keeps every required marker in the advertised schema.
 */
export const jsonSchemaToZod = (schema: Record<string, unknown>): z.ZodType => {
  if (Array.isArray(schema.oneOf)) {
    return z.union(schema.oneOf.map((branch) => jsonSchemaToZod(branch as Record<string, unknown>)));
  }
  if (Array.isArray(schema.anyOf)) {
    return z.union(schema.anyOf.map((branch) => jsonSchemaToZod(branch as Record<string, unknown>)));
  }
  if (Array.isArray(schema.enum) && schema.enum.every((value) => typeof value === 'string')) {
    return z.enum(schema.enum as [string, ...string[]]);
  }
  if (schema.const !== undefined) return z.literal(schema.const as string | number | boolean);
  switch (schema.type) {
    case 'object': {
      const properties = (schema.properties as Record<string, unknown> | undefined) ?? {};
      const required = Array.isArray(schema.required) ? schema.required as string[] : [];
      if (Object.keys(properties).length === 0) {
        // Record-shaped field (z.record): propertyNames in the projection.
        return schema.additionalProperties !== undefined && typeof schema.additionalProperties === 'object'
          ? z.record(z.string(), jsonSchemaToZod(schema.additionalProperties as Record<string, unknown>))
          : z.record(z.string(), z.unknown());
      }
      const shape = Object.fromEntries(
        Object.entries(properties).map(([key, value]) => {
          const propertySchema = value as Record<string, unknown>;
          // A property with a default cannot be required: the real schema
          // accepts its absence (e.g. transaction.validate defaults to true),
          // and the projection marks such fields required.
          const optional = !required.includes(key) || propertySchema.default !== undefined;
          return [
            key,
            optional
              ? jsonSchemaToZod(propertySchema).optional()
              : jsonSchemaToZod(propertySchema),
          ];
        }),
      );
      // Deliberately permissive: the advertised schema only describes shape
      // for the model. Unknown keys must survive parsing (zod objects strip
      // them by default) — the capability's strict schema is the real
      // validation boundary.
      return z.object(shape).passthrough();
    }
    case 'array': {
      const items = schema.items;
      if (Array.isArray(items)) {
        return z.tuple(items.map((item) => jsonSchemaToZod(item as Record<string, unknown>)) as [z.ZodType, ...z.ZodType[]]);
      }
      if (Array.isArray(schema.prefixItems)) {
        return z.tuple(schema.prefixItems.map((item) => jsonSchemaToZod(item as Record<string, unknown>)) as [z.ZodType, ...z.ZodType[]]);
      }
      if (items === undefined || items === true) {
        return withArrayConstraints(schema, z.array(z.unknown()));
      }
      return withArrayConstraints(schema, z.array(jsonSchemaToZod(items as Record<string, unknown>)));
    }
    case 'string':
      return withStringConstraints(schema, z.string());
    case 'number':
      return withNumberConstraints(schema, z.number());
    case 'integer':
      return withNumberConstraints(schema, z.number().int());
    case 'boolean':
      return z.boolean();
    case 'null':
      return z.null();
    default:
      return z.unknown();
  }
};

/** Zod wrapper around the advertised model JSON Schema for SDKs that only accept zod input schemas. */
export const capabilityModelJsonSchemaZod = (name: CapabilityName): z.ZodType =>
  jsonSchemaToZod(capabilityModelJsonSchema(name));
