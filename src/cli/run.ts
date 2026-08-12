import { applyStyleTransaction, validateStyleDocument } from '../core/index.js';
import { parseCliArgs } from './args.js';
import { CliOutputError, writeNewOutputFile } from './file-output.js';
import { CliInputError, readJsonInput } from './input.js';
import { inspectStyle } from './inspect.js';
import { writeDiagnostic, writeJson } from './output.js';
import { CliArgumentError } from './types.js';
import type { CliExitCode, CliIo } from './types.js';

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

export async function runCli(
  argv: readonly string[],
  io: CliIo,
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
      const result = validateStyleDocument(input.value);
      return writeResult(io, {
        ok: result.ok,
        errors: result.errors,
        warnings: result.warnings,
      }, result.ok ? 0 : 1);
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
      const validated = validateStyleDocument(input.value);
      if (!validated.ok) {
        return writeResult(io, {
          ok: false,
          errors: validated.errors,
          warnings: validated.warnings,
        }, 1);
      }
      const result = inspectStyle(validated.style, {
        ...(command.query === undefined ? {} : { query: command.query }),
        ...(command.type === undefined ? {} : { type: command.type }),
        ...(command.source === undefined ? {} : { source: command.source }),
        ...(command.sourceLayer === undefined ? {} : { sourceLayer: command.sourceLayer }),
        ...(command.layerId === undefined ? {} : { layerId: command.layerId }),
        ...(command.sourceId === undefined ? {} : { sourceId: command.sourceId }),
        ...(command.sourceLayers === undefined ? {} : { sourceLayers: command.sourceLayers }),
        ...(command.analyzeGeoJsonSourceId === undefined ? {} : {
          analyzeGeoJsonSourceId: command.analyzeGeoJsonSourceId,
        }),
      });
      return result.ok
        ? writeResult(io, result.value, 0)
        : writeResult(io, { ok: false, error: result.error }, 1);
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
      const validated = validateStyleDocument(styleRead.value);
      if (!validated.ok) {
        return writeResult(io, {
          ok: false,
          errors: validated.errors,
          warnings: validated.warnings,
        }, 1);
      }
      const result = applyStyleTransaction(validated.style, {
        operations: operationsRead.value,
        validate: true,
      });
      if (result.ok && command.output !== undefined) {
        try {
          await writeNewOutputFile(command.output, result.style, io.cwd);
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
          await writeDiagnosticBestEffort(
            io,
            POST_COMMIT_STDOUT_FAILURE_DIAGNOSTIC,
          );
          return 3;
        }
      }
      return writeResult(io, result, result.ok ? 0 : 1);
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
