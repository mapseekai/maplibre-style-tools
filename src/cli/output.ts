import type { Writable } from 'node:stream';

const writeText = (stream: Writable, text: string): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    let settled = false;
    let cleanupImmediate: NodeJS.Immediate | undefined;

    const cleanup = (): void => {
      stream.off('error', onError);
      if (cleanupImmediate !== undefined) {
        clearImmediate(cleanupImmediate);
        cleanupImmediate = undefined;
      }
    };
    const scheduleCleanup = (): void => {
      if (cleanupImmediate === undefined) {
        cleanupImmediate = setImmediate(cleanup);
      }
    };
    const fail = (error: unknown): void => {
      if (!settled) {
        settled = true;
        reject(error);
      }
      scheduleCleanup();
    };
    const succeed = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const onError = (error: Error): void => fail(error);

    stream.on('error', onError);
    try {
      stream.write(text, (error?: Error | null) => {
        if (error != null) fail(error);
        else succeed();
      });
    } catch (error) {
      fail(error);
    }
  });

export const writeJson = (stream: Writable, value: unknown): Promise<void> => {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError('Value is not JSON serializable.');
  return writeText(stream, `${encoded}\n`);
};

export const writeDiagnostic = (stream: Writable, message: string): Promise<void> =>
  writeText(stream, `${message}\n`);
