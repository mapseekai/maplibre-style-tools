import { parseArgs } from 'node:util';
import { CliArgumentError } from './types.js';
import type { CliCommand } from './types.js';

const options = {
  operations: { type: 'string' },
  output: { type: 'string' },
  query: { type: 'string' },
  type: { type: 'string' },
  source: { type: 'string' },
  'source-layer': { type: 'string' },
  layer: { type: 'string' },
  'source-id': { type: 'string' },
  'analyze-geojson': { type: 'string' },
  help: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  'in-place': { type: 'boolean' },
  backup: { type: 'boolean' },
  'source-layers': { type: 'boolean' },
} as const;

const validateOptions = new Set<string>();
const inspectOptions = new Set([
  'query',
  'type',
  'source',
  'source-layer',
  'layer',
  'source-id',
  'source-layers',
  'analyze-geojson',
]);
const applyOptions = new Set([
  'operations',
  'output',
  'dry-run',
  'in-place',
  'backup',
]);

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const rejectDisallowedOptions = (
  command: string,
  values: Readonly<Record<string, string | boolean | undefined>>,
  allowed: ReadonlySet<string>,
): void => {
  for (const name of Object.keys(values)) {
    if (name !== 'help' && !allowed.has(name)) {
      throw new CliArgumentError(`--${name} is not valid for ${command}.`);
    }
  }
};

const requireStylePositionals = (
  command: string,
  positionals: readonly string[],
): string => {
  if (positionals.length !== 2) {
    throw new CliArgumentError(`${command} requires exactly one STYLE input.`);
  }
  return positionals[1] as string;
};

export function parseCliArgs(argv: readonly string[]): CliCommand {
  try {
    const { values, positionals } = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options,
    });

    if (values.help === true) {
      if (argv.length === 1 && argv[0] === '--help') return { kind: 'help' };
      throw new CliArgumentError('--help must be used by itself.');
    }

    const command = positionals[0];
    if (command === 'validate') {
      rejectDisallowedOptions(command, values, validateOptions);
      return {
        kind: 'validate',
        styleInput: requireStylePositionals(command, positionals),
      };
    }

    if (command === 'inspect') {
      rejectDisallowedOptions(command, values, inspectOptions);
      const styleInput = requireStylePositionals(command, positionals);
      const query = values.query as string | undefined;
      const type = values.type as string | undefined;
      const source = values.source as string | undefined;
      const sourceLayer = values['source-layer'] as string | undefined;
      const layerId = values.layer as string | undefined;
      const sourceId = values['source-id'] as string | undefined;
      const sourceLayers = values['source-layers'] as boolean | undefined;
      const analyzeGeoJsonSourceId = values['analyze-geojson'] as string | undefined;
      const exactModes = [
        layerId !== undefined,
        sourceId !== undefined,
        sourceLayers === true,
        analyzeGeoJsonSourceId !== undefined,
      ].filter(Boolean).length;
      if (exactModes > 1) {
        throw new CliArgumentError('Inspect exact modes are mutually exclusive.');
      }
      const hasSearchFilters = query !== undefined
        || type !== undefined
        || source !== undefined
        || sourceLayer !== undefined;
      const scopedSourceLayers = sourceLayers === true
        && source !== undefined
        && query === undefined
        && type === undefined
        && sourceLayer === undefined;
      if (exactModes === 1 && hasSearchFilters && !scopedSourceLayers) {
        throw new CliArgumentError('Inspect exact modes cannot be combined with search filters.');
      }
      return {
        kind: 'inspect',
        styleInput,
        ...(query === undefined ? {} : { query }),
        ...(type === undefined ? {} : { type }),
        ...(source === undefined ? {} : { source }),
        ...(sourceLayer === undefined ? {} : { sourceLayer }),
        ...(layerId === undefined ? {} : { layerId }),
        ...(sourceId === undefined ? {} : { sourceId }),
        ...(sourceLayers === undefined ? {} : { sourceLayers }),
        ...(analyzeGeoJsonSourceId === undefined ? {} : { analyzeGeoJsonSourceId }),
      };
    }

    if (command === 'apply') {
      rejectDisallowedOptions(command, values, applyOptions);
      const styleInput = requireStylePositionals(command, positionals);
      const operationsInput = values.operations as string | undefined;
      if (operationsInput === undefined) {
        throw new CliArgumentError('apply requires --operations OPERATIONS.');
      }
      const output = values.output as string | undefined;
      const dryRun = values['dry-run'] === true;
      const inPlace = values['in-place'] === true;
      const backup = values.backup === true;
      if (styleInput === '-' && operationsInput === '-') {
        throw new CliArgumentError('STYLE and OPERATIONS cannot both read stdin.');
      }
      if (output !== undefined && inPlace) {
        throw new CliArgumentError('--output and --in-place are mutually exclusive.');
      }
      if (backup && !inPlace) {
        throw new CliArgumentError('--backup requires --in-place.');
      }
      if (dryRun && (output !== undefined || inPlace || backup)) {
        throw new CliArgumentError('--dry-run cannot be combined with file output options.');
      }
      if (inPlace && styleInput === '-') {
        throw new CliArgumentError('--in-place requires STYLE to be a file path.');
      }
      return {
        kind: 'apply',
        styleInput,
        operationsInput,
        dryRun,
        ...(output === undefined ? {} : { output }),
        inPlace,
        backup,
      };
    }

    throw new CliArgumentError('Expected validate, inspect, or apply command.');
  } catch (error) {
    if (error instanceof CliArgumentError) throw error;
    throw new CliArgumentError(messageOf(error));
  }
}
