import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Writable } from 'node:stream';
import { writeDiagnostic, writeJson } from './output.js';

class BufferWriter extends Writable {
  readonly chunks: string[] = [];

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(chunk.toString());
    callback();
  }

  get text(): string {
    return this.chunks.join('');
  }
}

class CallbackErrorWriter extends Writable {
  constructor(private readonly failure: Error) {
    super();
  }

  override _write(
    _chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    callback(this.failure);
  }
}

class EventThenCallbackWriter extends Writable {
  constructor(private readonly failure: Error) {
    super();
  }

  override _write(
    _chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.emit('error', this.failure);
    callback();
  }
}

const immediate = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

const expectOneRejection = async (
  stream: Writable,
  write: () => Promise<void>,
  expectedCode?: string,
): Promise<void> => {
  const baseline = stream.listenerCount('error');
  let settlements = 0;
  await write().then(
    () => {
      settlements += 1;
      assert.fail('expected rejection');
    },
    (error: unknown) => {
      settlements += 1;
      if (expectedCode !== undefined) {
        assert.equal((error as NodeJS.ErrnoException).code, expectedCode);
      }
    },
  );
  await immediate();
  assert.equal(settlements, 1);
  assert.equal(stream.listenerCount('error'), baseline);
};

describe('CLI output writers', () => {
  it('writes one compact JSON document with a trailing newline and cleans up', async () => {
    const stream = new BufferWriter();
    const baseline = stream.listenerCount('error');
    await writeJson(stream, { ok: true });
    assert.equal(stream.text, '{"ok":true}\n');
    assert.equal(stream.listenerCount('error'), baseline);
  });

  it('settles a callback error once and owns the emitted error window', async () => {
    const epipe = Object.assign(new Error('broken pipe'), { code: 'EPIPE' });
    const stream = new CallbackErrorWriter(epipe);
    await expectOneRejection(stream, () => writeJson(stream, { ok: true }), 'EPIPE');
  });

  it('handles an emitted diagnostic error before its callback', async () => {
    const stream = new EventThenCallbackWriter(new Error('stderr unavailable'));
    await expectOneRejection(stream, () => writeDiagnostic(stream, 'failure'));
  });

  it('rejects a stream that was closed before the write without leaking listeners', async () => {
    const stream = new BufferWriter();
    const closed = new Promise<void>((resolve) => stream.once('close', resolve));
    stream.destroy();
    await closed;
    await expectOneRejection(stream, () => writeDiagnostic(stream, 'failure'));
  });
});
