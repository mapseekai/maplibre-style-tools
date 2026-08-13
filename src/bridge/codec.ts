import type { z } from 'zod';

import {
  BRIDGE_COMMAND_RESULT_TYPES,
  BRIDGE_PROTOCOL_VERSION,
  BridgeFrameSchema,
  MAX_BRIDGE_MESSAGE_BYTES,
  type BridgeAuthFrame,
  type BridgeCommandFrame,
  type BridgeRegisterFrame,
  type BridgeResultFrame,
} from './protocol.js';

const textEncoder = new TextEncoder();

export function encodeBridgeFrame(
  frame: unknown,
  maxBytes = MAX_BRIDGE_MESSAGE_BYTES,
): string {
  const encoded = JSON.stringify(BridgeFrameSchema.parse(frame));
  if (textEncoder.encode(encoded).byteLength > maxBytes) {
    throw new RangeError('bridge frame exceeds size limit');
  }
  return encoded;
}

export function decodeBridgeFrame<T>(
  data: string | ArrayBuffer | ArrayBufferView,
  schema: z.ZodType<T>,
  maxBytes = MAX_BRIDGE_MESSAGE_BYTES,
): T {
  const bytes = typeof data === 'string'
    ? textEncoder.encode(data)
    : data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (bytes.byteLength > maxBytes) {
    throw new RangeError('bridge frame exceeds size limit');
  }
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return schema.parse(JSON.parse(decoded) as unknown);
}

type CorrelatedBridgeRequest = BridgeAuthFrame | BridgeRegisterFrame | BridgeCommandFrame;

const expectedResultType = (request: CorrelatedBridgeRequest): string => {
  switch (request.kind) {
    case 'auth':
      return 'authenticated';
    case 'register':
      return 'registered';
    case 'command':
      return BRIDGE_COMMAND_RESULT_TYPES[request.command.type];
  }
};

export function assertCorrelated(
  request: CorrelatedBridgeRequest,
  result: BridgeResultFrame,
): void {
  if (request.protocolVersion !== BRIDGE_PROTOCOL_VERSION
    || result.protocolVersion !== BRIDGE_PROTOCOL_VERSION) {
    throw new Error('bridge protocol version mismatch');
  }
  if (request.correlationId !== result.correlationId) {
    throw new Error('bridge correlation mismatch');
  }
  const expected = expectedResultType(request);
  if (result.ok && result.result.type !== expected) {
    throw new Error(`expected ${expected} result`);
  }
}
