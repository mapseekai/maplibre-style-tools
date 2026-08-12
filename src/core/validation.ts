import {
  validateStyleMin,
  type StyleSpecification,
  type ValidationError,
} from '@maplibre/maplibre-gl-style-spec';
import { createStyleToolError } from './errors.js';
import { styleDocumentSchema } from './schemas.js';
import type {
  CoreExecutionLimits,
  JsonObject,
  JsonValue,
  StyleDocument,
  StyleToolError,
  StyleWarning,
} from './types.js';
import { DEFAULT_MAX_STYLE_BYTES, jsonUtf8ByteLength } from './utf8.js';

const DEFAULT_MAX_ISSUES = 100;
const STYLE_VALIDATION_FAILED_MESSAGE = 'MapLibre style validation failed.';

export type StyleValidationOptions = Partial<
  Pick<CoreExecutionLimits, 'maxStyleBytes'>
> & {
  maxIssues?: number;
};

export type StyleValidationResult =
  | { ok: true; style: StyleDocument; errors: []; warnings: StyleWarning[] }
  | { ok: false; style?: never; errors: StyleToolError[]; warnings: StyleWarning[] };

type StyleValidator = (style: StyleSpecification) => ValidationError[];
type ValidatedOptions = {
  maxIssues: number;
  maxStyleBytes: number;
};
type OptionsValidationResult =
  | { ok: true; options: ValidatedOptions }
  | { ok: false; error: StyleToolError };

function toJsonPointer(path: readonly PropertyKey[]): string {
  if (path.length === 0) {
    return '';
  }
  return `/${path.map((segment) => String(segment)
    .replaceAll('~', '~0')
    .replaceAll('/', '~1')).join('/')}`;
}

function readPositiveSafeIntegerOption(
  options: object,
  name: 'maxIssues' | 'maxStyleBytes',
): number | undefined | null {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(options, name);
    if (descriptor === undefined) {
      return undefined;
    }
    if (!('value' in descriptor) || !Number.isSafeInteger(descriptor.value)
      || descriptor.value <= 0) {
      return null;
    }
    return descriptor.value;
  } catch {
    return null;
  }
}

function validateOptions(options: StyleValidationOptions | undefined): OptionsValidationResult {
  if (options === undefined) {
    return {
      ok: true,
      options: {
        maxIssues: DEFAULT_MAX_ISSUES,
        maxStyleBytes: DEFAULT_MAX_STYLE_BYTES,
      },
    };
  }
  if (typeof options !== 'object' || options === null) {
    return {
      ok: false,
      error: createStyleToolError(
        'INVALID_INPUT', 'Style validation options must be an object.', '',
      ),
    };
  }

  const maxIssues = readPositiveSafeIntegerOption(options, 'maxIssues');
  if (maxIssues === null) {
    return {
      ok: false,
      error: createStyleToolError(
        'INVALID_INPUT', 'maxIssues must be a positive safe integer.', '/maxIssues',
      ),
    };
  }
  const maxStyleBytes = readPositiveSafeIntegerOption(options, 'maxStyleBytes');
  if (maxStyleBytes === null) {
    return {
      ok: false,
      error: createStyleToolError(
        'INVALID_INPUT', 'maxStyleBytes must be a positive safe integer.', '/maxStyleBytes',
      ),
    };
  }
  return {
    ok: true,
    options: {
      maxIssues: maxIssues ?? DEFAULT_MAX_ISSUES,
      maxStyleBytes: maxStyleBytes ?? DEFAULT_MAX_STYLE_BYTES,
    },
  };
}

function safeStringProperty(value: unknown, name: string): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    return descriptor !== undefined && 'value' in descriptor
      && typeof descriptor.value === 'string'
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function safeFiniteNumberProperty(value: unknown, name: string): number | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    return descriptor !== undefined && 'value' in descriptor
      && typeof descriptor.value === 'number' && Number.isFinite(descriptor.value)
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function normalizeStyleSpecIssue(issue: ValidationError): StyleToolError {
  const message = safeStringProperty(issue, 'message') ?? STYLE_VALIDATION_FAILED_MESSAGE;
  const identifier = safeStringProperty(issue, 'identifier');
  const line = safeFiniteNumberProperty(issue, 'line');
  const details: JsonObject = {};
  if (identifier !== undefined) {
    details.identifier = identifier;
  }
  if (line !== undefined) {
    details.line = line;
  }
  return createStyleToolError(
    'STYLE_INVALID', message, undefined,
    Object.keys(details).length > 0 ? details : undefined,
  );
}

function safeThrownMessage(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  return safeStringProperty(value, 'message') ?? STYLE_VALIDATION_FAILED_MESSAGE;
}

function runMapLibreValidator(
  style: StyleDocument,
  validator: StyleValidator,
): ValidationError[] {
  return validator(style as unknown as StyleSpecification);
}

function validateStyleDocumentWithValidator(
  style: unknown,
  options: StyleValidationOptions | undefined,
  validator: StyleValidator,
): StyleValidationResult {
  const validatedOptions = validateOptions(options);
  if (!validatedOptions.ok) {
    return { ok: false, errors: [validatedOptions.error], warnings: [] };
  }

  let parsed: ReturnType<typeof styleDocumentSchema.safeParse>;
  try {
    parsed = styleDocumentSchema.safeParse(style);
  } catch {
    return {
      ok: false,
      errors: [createStyleToolError('INVALID_INPUT', 'Style must be a strict JSON document.', '')],
      warnings: [],
    };
  }
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.slice(0, validatedOptions.options.maxIssues).map((issue) => (
        createStyleToolError('INVALID_INPUT', issue.message, toJsonPointer(issue.path))
      )),
      warnings: [],
    };
  }

  const sanitizedStyle = parsed.data as StyleDocument;
  let actualBytes: number;
  try {
    actualBytes = jsonUtf8ByteLength(sanitizedStyle as JsonValue);
  } catch {
    return {
      ok: false,
      errors: [createStyleToolError(
        'INTERNAL', 'Sanitized style could not be serialized for size validation.', '',
      )],
      warnings: [],
    };
  }
  if (actualBytes > validatedOptions.options.maxStyleBytes) {
    return {
      ok: false,
      errors: [createStyleToolError(
        'INVALID_INPUT', 'Style exceeds the configured UTF-8 JSON size limit.', '', {
          reason: 'maxStyleBytes',
          maxBytes: validatedOptions.options.maxStyleBytes,
          actualBytes,
        },
      )],
      warnings: [],
    };
  }

  let issues: ValidationError[];
  try {
    issues = runMapLibreValidator(sanitizedStyle, validator);
  } catch (error) {
    return {
      ok: false,
      errors: [createStyleToolError('STYLE_INVALID', safeThrownMessage(error))],
      warnings: [],
    };
  }
  if (issues.length > 0) {
    return {
      ok: false,
      errors: issues.slice(0, validatedOptions.options.maxIssues).map(normalizeStyleSpecIssue),
      warnings: [],
    };
  }
  return { ok: true, style: sanitizedStyle, errors: [], warnings: [] };
}

export function validateStyleDocument(
  style: unknown,
  options: StyleValidationOptions = {},
): StyleValidationResult {
  return validateStyleDocumentWithValidator(style, options, validateStyleMin);
}

export function validateStyleDocumentWith(
  style: unknown,
  options: StyleValidationOptions,
  validator: StyleValidator,
): StyleValidationResult {
  return validateStyleDocumentWithValidator(style, options, validator);
}
