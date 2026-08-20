import {
  executeApplyStyleTransaction,
  executeInspectStyle,
} from '../capabilities/index.js';
import { createStyleToolError } from '../core/index.js';
import { parseCliArgs } from './args.js';
import { createFileStyleAuthority } from './file-authority.js';
import {
  CliOutputError, replaceStyleFileAtomically, writeNewOutputFile,
} from './file-output.js';
import { CliInputError, readJsonInput } from './input.js';
import { writeDiagnostic, writeJson } from './output.js';
import { CliArgumentError } from './types.js';
import type { StyleToolError } from '../core/index.js';
import type { FileStyleAuthority } from './file-authority.js';
import type { CliCommand, CliExitCode, CliIo } from './types.js';

export const CLI_HELP = {
  ok: true,
  command: 'help',
  usage: [
    'maplibre-style validate STYLE',
    'maplibre-style inspect STYLE [OPTIONS]',
    'maplibre-style apply STYLE --operations OPERATIONS [OPTIONS]',
  ],
} as const;

export const POST_COMMIT_STDOUT_FAILURE_DIAGNOSTIC =
  'File committed, but stdout result delivery failed; do not retry as though no file was written.';
export const POST_COMMIT_DURABILITY_STDOUT_FAILURE_DIAGNOSTIC =
  'File committed and directory durability is uncertain; stdout acknowledgement failed; do not retry as though no file was written.';

export interface CliRunDependencies {
  replaceStyleFileAtomically: typeof replaceStyleFileAtomically;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const writeDiagnosticBestEffort = async (
  io: CliIo,
  message: string,
): Promise<void> => {
  try {
    await writeDiagnostic(io.stderr, message);
  } catch {
    // Diagnostics cannot replace or escape the selected CLI exit code.
  }
};

const writeResult = async (
  io: CliIo,
  value: unknown,
  successCode: CliExitCode,
): Promise<CliExitCode> => {
  try {
    await writeJson(io.stdout, value);
    return successCode;
  } catch (error) {
    await writeDiagnosticBestEffort(io, `Output write failed: ${messageOf(error)}`);
    return 3;
  }
};

const inspectInput = (
  command: Extract<CliCommand, { kind: 'inspect' }>,
  authority: FileStyleAuthority,
): unknown => {
  if (command.layerId !== undefined) return { action: 'getLayer', layerId: command.layerId };
  if (command.sourceId !== undefined) return { action: 'getSource', sourceId: command.sourceId };
  if (command.sourceLayers === true) {
    return {
      action: 'listSourceLayers',
      ...(command.source === undefined ? {} : { sourceId: command.source }),
    };
  }
  if (command.analyzeGeoJsonSourceId !== undefined) {
    const current = authority.readStyle();
    if (!current.ok) return { failure: current.error };
    const source = current.style.sources[command.analyzeGeoJsonSourceId];
    if (source === undefined) {
      return {
        failure: createStyleToolError(
          'NOT_FOUND', 'Requested source was not found.',
        ),
      };
    }
    if (source.type !== 'geojson') {
      return {
        failure: createStyleToolError(
          'UNSUPPORTED_SOURCE', `Source "${command.analyzeGeoJsonSourceId}" is not a GeoJSON source.`,
        ),
      };
    }
    return { action: 'analyzeGeoJson', data: source.data };
  }
  if (
    command.query !== undefined
    || command.type !== undefined
    || command.source !== undefined
    || command.sourceLayer !== undefined
  ) {
    return {
      action: 'listLayers',
      ...(command.query === undefined ? {} : { query: command.query }),
      ...(command.type === undefined ? {} : { type: command.type }),
      ...(command.source === undefined ? {} : { source: command.source }),
      ...(command.sourceLayer === undefined ? {} : { sourceLayer: command.sourceLayer }),
    };
  }
  return { action: 'getRoot' };
};

const failure = (error: StyleToolError) => ({
  success: false as const,
  message: error.message,
  error,
});
const inspectFailure = (input: unknown): StyleToolError | undefined => {
  if (
    typeof input !== 'object'
    || input === null
    || !('failure' in input)
    || typeof input.failure !== 'object'
    || input.failure === null
  ) return undefined;
  return input.failure as StyleToolError;
};


export async function runCliWithDependencies(
  argv: readonly string[],
  io: CliIo,
  dependencies: CliRunDependencies,
): Promise<CliExitCode> {
  let command;
  try {
    command = parseCliArgs(argv);
  } catch (error) {
    if (error instanceof CliArgumentError) {
      await writeDiagnosticBestEffort(io, error.message);
      return 2;
    }
    await writeDiagnosticBestEffort(io, `Internal error: ${messageOf(error)}`);
    return 3;
  }

  if (command.kind === 'help') return writeResult(io, CLI_HELP, 0);

  if (command.kind === 'validate') {
    try {
      const input = await readJsonInput(command.styleInput, io);
      const result = executeInspectStyle(() => null, {
        action: 'validateDocument',
        style: input.value,
      });
      return writeResult(io, result, result.success ? 0 : 1);
    } catch (error) {
      if (error instanceof CliInputError) {
        await writeDiagnosticBestEffort(io, error.message);
        return 2;
      }
      await writeDiagnosticBestEffort(io, `Internal error: ${messageOf(error)}`);
      return 3;
    }
  }

  if (command.kind === 'inspect') {
    try {
      const input = await readJsonInput(command.styleInput, io);
      const authority = createFileStyleAuthority(input.value);
      const rawInput = inspectInput(command, authority);
      const error = inspectFailure(rawInput);
      const result = error === undefined
        ? executeInspectStyle(() => authority, rawInput)
        : failure(error);
      return writeResult(io, result, result.success ? 0 : 1);
    } catch (error) {
      if (error instanceof CliInputError) {
        await writeDiagnosticBestEffort(io, error.message);
        return 2;
      }
      await writeDiagnosticBestEffort(io, `Internal error: ${messageOf(error)}`);
      return 3;
    }
  }

  if (command.kind === 'apply') {
    try {
      const styleRead = await readJsonInput(command.styleInput, io);
      const operationsRead = await readJsonInput(command.operationsInput, io);
      const authority = createFileStyleAuthority(styleRead.value);
      const result = await executeApplyStyleTransaction(() => authority, {
        transaction: { operations: operationsRead.value },
        dryRun: command.dryRun,
      });
      if (!result.success) return writeResult(io, result, 1);
      if (command.dryRun || !result.data.applied) return writeResult(io, result, 0);

      const current = authority.readStyle();
      if (!current.ok) return writeResult(io, failure(current.error), 1);
      if (command.output !== undefined) {
        try {
          await writeNewOutputFile(command.output, current.style, io.cwd);
        } catch (error) {
          if (error instanceof CliOutputError) {
            await writeDiagnosticBestEffort(io, error.message);
            return 3;
          }
          throw error;
        }
        try {
          await writeJson(io.stdout, result);
          return 0;
        } catch {
          await writeDiagnosticBestEffort(io, POST_COMMIT_STDOUT_FAILURE_DIAGNOSTIC);
          return 3;
        }
      }
      if (command.inPlace) {
        if (styleRead.source.kind !== 'file') {
          await writeDiagnosticBestEffort(
            io,
            'In-place replacement requires a file-backed Style input.',
          );
          return 3;
        }
        try {
          await dependencies.replaceStyleFileAtomically(
            styleRead.source.absolutePath,
            current.style,
            {
              backup: command.backup,
              expectedIdentity: styleRead.source.identity,
              originalBytes: styleRead.source.originalBytes,
            },
          );
        } catch (error) {
          if (!(error instanceof CliOutputError)) throw error;
          if (!error.state.committed) {
            await writeDiagnosticBestEffort(io, error.message);
            return 3;
          }
          const acknowledgement = failure(createStyleToolError(
            'IO_ERROR', error.message,
          ));
          try {
            await writeJson(io.stdout, acknowledgement);
          } catch {
            await writeDiagnosticBestEffort(
              io,
              POST_COMMIT_DURABILITY_STDOUT_FAILURE_DIAGNOSTIC,
            );
            return 3;
          }
          await writeDiagnosticBestEffort(io, error.message);
          return 3;
        }
        try {
          await writeJson(io.stdout, result);
          return 0;
        } catch {
          await writeDiagnosticBestEffort(io, POST_COMMIT_STDOUT_FAILURE_DIAGNOSTIC);
          return 3;
        }
      }
      return writeResult(io, result, 0);
    } catch (error) {
      if (error instanceof CliInputError) {
        await writeDiagnosticBestEffort(io, error.message);
        return 2;
      }
      await writeDiagnosticBestEffort(io, `Internal error: ${messageOf(error)}`);
      return 3;
    }
  }

  await writeDiagnosticBestEffort(io, 'Internal error: command is not implemented.');
  return 3;
}

export async function runCli(
  argv: readonly string[],
  io: CliIo,
): Promise<CliExitCode> {
  return runCliWithDependencies(argv, io, { replaceStyleFileAtomically });
}
