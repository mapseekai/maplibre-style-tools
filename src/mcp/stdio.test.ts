import assert from 'node:assert/strict';
import test from 'node:test';
import { PassThrough, Writable } from 'node:stream';

import {
  createBoundedNdjsonInput,
  createGuardedStdioOutput,
  runStdioMcp,
  writeMcpStderrLine,
} from './stdio.js';
import {
  MIN_MCP_MESSAGE_BYTES,
  resolveMcpMessagePolicy,
} from './main.js';

const nextTurn = () => new Promise<void>((resolve) => { setImmediate(resolve); });

test('bounded stdio framing accepts split and batched messages and rejects invalid input once', async () => {
  const policy = resolveMcpMessagePolicy({ maxMessageBytes: MIN_MCP_MESSAGE_BYTES });
  const source = new PassThrough();
  const terminals: unknown[] = [];
  const bounded = createBoundedNdjsonInput(source, policy, (error) => {
    terminals.push(error);
  });
  const accepted: Buffer[] = [];
  bounded.stream.on('data', (chunk: Buffer) => { accepted.push(chunk); });
  const one = Buffer.from('{"jsonrpc":"2.0","id":1,"method":"ping"}\n');
  const two = Buffer.from('{"jsonrpc":"2.0","id":2,"method":"ping"}\n');
  source.write(one.subarray(0, 7));
  source.write(Buffer.concat([one.subarray(7), two]));
  await nextTurn();
  assert.equal(Buffer.concat(accepted).toString(), Buffer.concat([one, two]).toString());
  assert.deepEqual(terminals, []);

  source.write(Buffer.alloc(policy.maxMessageBytes + 1, 0x20));
  await nextTurn();
  assert.equal(terminals.length, 1);
  bounded.dispose();
  assert.equal(source.listenerCount('error'), 0);
});

test('bounded stdio framing rejects invalid UTF-8, unsafe IDs, and unterminated EOF before output', async () => {
  for (const payload of [
    Buffer.from([0xff, 0x0a]),
    Buffer.from(`{"jsonrpc":"2.0","id":"${'x'.repeat(300)}","method":"ping"}\n`),
    Buffer.from('{"jsonrpc":"2.0"'),
  ]) {
    const source = new PassThrough();
    let terminals = 0;
    const bounded = createBoundedNdjsonInput(
      source,
      resolveMcpMessagePolicy(),
      () => { terminals += 1; },
    );
    const accepted: Buffer[] = [];
    bounded.stream.on('data', (chunk: Buffer) => { accepted.push(chunk); });
    source.end(payload);
    await nextTurn();
    assert.equal(terminals, 1);
    assert.equal(accepted.length, 0);
    bounded.dispose();
  }
});

test('guarded stdio output forwards exact bytes and turns asynchronous failure terminal', async () => {
  let writeCallback: ((error?: Error | null) => void) | undefined;
  const chunks: Buffer[] = [];
  const output = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      writeCallback = callback;
    },
  });
  let terminals = 0;
  const guarded = createGuardedStdioOutput(output, () => { terminals += 1; });
  guarded.stream.write(Buffer.from('protocol'));
  writeCallback?.(Object.assign(new Error('broken'), { code: 'EPIPE' }));
  await nextTurn();
  assert.equal(Buffer.concat(chunks).toString(), 'protocol');
  assert.equal(terminals, 1);
  guarded.dispose();
  assert.equal(output.listenerCount('error'), 0);
});

test('stderr line helper writes exactly one line and rejects line breaks or EPIPE', async () => {
  const chunks: string[] = [];
  const successful = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  await writeMcpStderrLine(successful, 'maplibre-style-mcp: ready');
  assert.deepEqual(chunks, ['maplibre-style-mcp: ready\n']);
  await assert.rejects(() => writeMcpStderrLine(successful, 'two\nlines'));

  const broken = new Writable({
    write(_chunk, _encoding, callback) {
      callback(Object.assign(new Error('broken'), { code: 'EPIPE' }));
    },
  });
  const before = broken.listenerCount('error');
  await assert.rejects(() => writeMcpStderrLine(broken, 'one line'), { code: 'EPIPE' });
  assert.equal(broken.listenerCount('error'), before);
});

test('stdio runner shares factory policy, emits no stdout banner, and closes owned wrappers', async () => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  stdout.on('data', (chunk: Buffer) => { stdoutChunks.push(chunk); });
  stderr.on('data', (chunk: Buffer) => { stderrChunks.push(chunk); });
  const started = await runStdioMcp({
    serverOptions: { maxMessageBytes: 256 * 1024 },
  }, { stdin, stdout, stderr });
  assert.equal(started.messagePolicy.maxMessageBytes, 256 * 1024);
  assert.equal(Buffer.concat(stdoutChunks).length, 0);
  assert.equal(Buffer.concat(stderrChunks).toString(), 'maplibre-style-mcp: stdio transport ready\n');
  await Promise.all([started.close(), started.close(), started.closed]);
  assert.equal(stdin.listenerCount('data'), 0);
});
