import type { Readable, Writable } from 'node:stream';

export type CliExitCode = 0 | 1 | 2 | 3;

export interface CliIo {
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
  cwd: string;
}

export type CliCommand =
  | { kind: 'help' }
  | { kind: 'validate'; styleInput: string }
  | {
      kind: 'inspect';
      styleInput: string;
      query?: string;
      type?: string;
      source?: string;
      sourceLayer?: string;
      layerId?: string;
      sourceId?: string;
      sourceLayers?: boolean;
      analyzeGeoJsonSourceId?: string;
    }
  | {
      kind: 'apply';
      styleInput: string;
      operationsInput: string;
      dryRun: boolean;
      output?: string;
      inPlace: boolean;
      backup: boolean;
    };

export class CliArgumentError extends Error {
  override readonly name = 'CliArgumentError';
}
