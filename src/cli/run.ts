import { validateStyleDocument } from '../core/index.js';
import { parseCliArgs } from './args.js';
import { CliInputError, readJsonInput } from './input.js';
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

  await writeDiagnosticBestEffort(io, `Internal error: ${command.kind} is not implemented.`);
  return 3;
}
