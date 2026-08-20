import type { StyleToolErrorCode } from '../core/index.js';
import { createStyleToolError, STYLE_TOOL_ERROR_CODES } from '../core/index.js';
import { assertCapability } from './capabilities.js';
import { encodeBridgeFrame } from './codec.js';
import {
  BRIDGE_COMMAND_RESULT_TYPES,
  BridgeCapabilitySchema,
  BridgeEventFrameSchema,
  BridgeRegisterFrameSchema,
  BridgeResultFrameSchema,
  MapSnapshotSchema,
  MAX_BRIDGE_MESSAGE_BYTES,
  type BridgeCapability,
  type BridgeCommand,
  type BridgeEventFrame,
  type BridgeRegisterFrame,
  type BridgeResultFrame,
  type MapSnapshot,
} from './protocol.js';

const PUBLIC_ERROR_MESSAGES = Object.freeze({
  INVALID_INPUT: 'Invalid bridge input',
  STYLE_INVALID: 'Style validation failed',
  NOT_FOUND: 'Requested map resource was not found',
  CONFLICT: 'Bridge request conflict',
  DEPENDENCY_CONFLICT: 'Style dependency conflict',
  UNSUPPORTED_SOURCE: 'Unsupported source',
  REVISION_CONFLICT: 'Live map revision conflict',
  MAP_NOT_READY: 'Map is not ready',
  BRIDGE_DISCONNECTED: 'Browser bridge disconnected',
  CAPABILITY_DENIED: 'Bridge capability denied',
  IO_ERROR: 'Bridge I/O failed',
  TIMEOUT: 'Bridge operation timed out',
  INTERNAL: 'Bridge operation failed',
} as const satisfies Record<StyleToolErrorCode, string>);

export function publicBridgeErrorMessage(code: StyleToolErrorCode): string {
  return PUBLIC_ERROR_MESSAGES[code];
}

export type BrowserOutboundBridgeFrame =
  | BridgeRegisterFrame
  | BridgeResultFrame
  | BridgeEventFrame;

export interface PreparedOutboundBridgeFrame<
  T extends BrowserOutboundBridgeFrame = BrowserOutboundBridgeFrame,
> {
  frame: T;
  encoded: string;
}

type ParsedError = Extract<BridgeResultFrame, { ok: false }>['error'];
type ErrorDetails = NonNullable<ParsedError['details']>;

const hasCapability = (
  capabilities: readonly BridgeCapability[],
  capability: BridgeCapability,
): boolean => capabilities.includes(capability);

const positiveSafeLimit = (value: number): number => {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError('bridge frame size limit must be a positive safe integer');
  }
  return value;
};

const isRfc6901Pointer = (value: string): boolean =>
  value === '' || /^(?:\/(?:[^~]|~[01])*)+$/u.test(value);

const ownDataValue = (value: object, key: PropertyKey): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
};

const isRecord = (value: unknown): value is Record<PropertyKey, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const styleToolErrorCode = (value: unknown): StyleToolErrorCode | undefined =>
  typeof value === 'string' && (STYLE_TOOL_ERROR_CODES as readonly string[]).includes(value)
    ? value as StyleToolErrorCode
    : undefined;

const metadataSnapshot = (snapshot: MapSnapshot): MapSnapshot => ({
  revision: snapshot.revision,
  styleHash: snapshot.styleHash,
});

const withProjectedSnapshot = (
  snapshot: MapSnapshot,
  includeStyle: boolean,
): MapSnapshot => includeStyle && snapshot.style !== undefined
  ? { revision: snapshot.revision, styleHash: snapshot.styleHash, style: snapshot.style }
  : metadataSnapshot(snapshot);

const prepareCandidate = <T extends BrowserOutboundBridgeFrame>(
  candidate: unknown,
  schema: { parse(value: unknown): T },
  maxBytes: number,
): PreparedOutboundBridgeFrame<T> => {
  const frame = schema.parse(candidate);
  return { frame, encoded: encodeBridgeFrame(frame, maxBytes) };
};

const firstFittingCandidate = <T extends BrowserOutboundBridgeFrame>(
  candidates: readonly unknown[],
  schema: { parse(value: unknown): T },
  maxBytes: number,
): PreparedOutboundBridgeFrame<T> => {
  let lastSizeError: unknown;
  for (const candidate of candidates) {
    try {
      return prepareCandidate(candidate, schema, maxBytes);
    } catch (error) {
      if (!(error instanceof RangeError && /size limit/u.test(error.message))) {
        throw error;
      }
      lastSizeError = error;
    }
  }
  throw lastSizeError ?? new RangeError('bridge frame exceeds size limit');
};

const capabilitySetEquals = (
  left: readonly BridgeCapability[],
  right: readonly BridgeCapability[],
): boolean => left.length === right.length
  && new Set(left).size === left.length
  && new Set(right).size === right.length
  && left.every((capability) => right.includes(capability));

const projectRegistration = (
  frame: BridgeRegisterFrame,
  capabilities: readonly BridgeCapability[],
  maxBytes: number,
): PreparedOutboundBridgeFrame<BridgeRegisterFrame> => {
  const parsed = BridgeRegisterFrameSchema.parse(frame);
  if (!capabilitySetEquals(parsed.capabilities, capabilities)) {
    throw createStyleToolError(
      'CAPABILITY_DENIED',
      'Registration capabilities do not match the projection context.',
    );
  }
  const full = {
    ...parsed,
    snapshot: withProjectedSnapshot(
      parsed.snapshot,
      hasCapability(capabilities, 'style.read'),
    ),
  };
  const metadata = { ...parsed, snapshot: metadataSnapshot(parsed.snapshot) };
  return firstFittingCandidate(
    hasCapability(capabilities, 'style.read') ? [full, metadata] : [metadata],
    BridgeRegisterFrameSchema,
    maxBytes,
  );
};

const projectEvent = (
  frame: BridgeEventFrame,
  capabilities: readonly BridgeCapability[],
  maxBytes: number,
): PreparedOutboundBridgeFrame<BridgeEventFrame> => {
  const parsed = BridgeEventFrameSchema.parse(frame);
  if (parsed.event === 'mapStatus') {
    return prepareCandidate(parsed, BridgeEventFrameSchema, maxBytes);
  }
  const full = {
    ...parsed,
    snapshot: withProjectedSnapshot(
      parsed.snapshot,
      hasCapability(capabilities, 'style.read'),
    ),
  };
  const metadata = { ...parsed, snapshot: metadataSnapshot(parsed.snapshot) };
  return firstFittingCandidate(
    hasCapability(capabilities, 'style.read') ? [full, metadata] : [metadata],
    BridgeEventFrameSchema,
    maxBytes,
  );
};

interface ProjectedErrorDetails {
  full?: ErrorDetails;
  metadata?: ErrorDetails;
  minimal?: ErrorDetails;
  hasCurrentSnapshot: boolean;
}

const projectErrorDetails = (
  error: ParsedError,
  capabilities: readonly BridgeCapability[],
  command: BridgeCommand,
): ProjectedErrorDetails => {
  const details = error.details;
  if (details === undefined) {
    return { hasCurrentSnapshot: false };
  }
  const currentValue = ownDataValue(details, 'currentSnapshot');
  if (currentValue !== undefined
    && command.type !== 'applyTransaction'
    && command.type !== 'applyStyleDocument') {
    throw new Error('Authoritative snapshots require a correlated mutation command.');
  }

  const full: Record<string, unknown> = {};
  const metadata: Record<string, unknown> = {};
  const minimal: Record<string, unknown> = {};
  let hasCurrentSnapshot = false;
  if (currentValue !== undefined) {
    const current = MapSnapshotSchema.parse(currentValue);
    const currentMetadata = metadataSnapshot(current);
    hasCurrentSnapshot = true;
    full.currentSnapshot = withProjectedSnapshot(
      current,
      hasCapability(capabilities, 'style.read'),
    );
    metadata.currentSnapshot = currentMetadata;
    minimal.currentSnapshot = currentMetadata;
  }

  const rolledBack = ownDataValue(details, 'rolledBack');
  if (typeof rolledBack === 'boolean'
    && (command.type === 'applyTransaction' || command.type === 'applyStyleDocument')) {
    full.rolledBack = rolledBack;
    metadata.rolledBack = rolledBack;
  }
  const rollbackValue = ownDataValue(details, 'rollbackError');
  if (isRecord(rollbackValue)
    && (command.type === 'applyTransaction' || command.type === 'applyStyleDocument')) {
    const code = styleToolErrorCode(ownDataValue(rollbackValue, 'code'));
    if (code !== undefined) {
      const rollback = { code, message: publicBridgeErrorMessage(code) };
      full.rollbackError = rollback;
      metadata.rollbackError = rollback;
    }
  }

  if (error.code === 'CAPABILITY_DENIED') {
    const commandType = ownDataValue(details, 'commandType');
    const requiredCapability = ownDataValue(details, 'requiredCapability');
    if (commandType === command.type
      && BridgeCapabilitySchema.safeParse(requiredCapability).success) {
      full.commandType = commandType;
      full.requiredCapability = requiredCapability;
      metadata.commandType = commandType;
      metadata.requiredCapability = requiredCapability;
    }
  } else if (error.code === 'INVALID_INPUT'
    && ownDataValue(details, 'reason') === 'relative-style-url') {
    full.reason = 'relative-style-url';
    metadata.reason = 'relative-style-url';
  } else if (error.code === 'MAP_NOT_READY') {
    const syncState = ownDataValue(details, 'syncState');
    if (syncState === 'known' || syncState === 'unknown') {
      full.syncState = syncState;
      metadata.syncState = syncState;
    }
  }

  const asDetails = (value: Record<string, unknown>): ErrorDetails | undefined =>
    Object.keys(value).length === 0 ? undefined : value as ErrorDetails;
  return {
    full: asDetails(full),
    metadata: asDetails(metadata),
    minimal: asDetails(minimal),
    hasCurrentSnapshot,
  };
};

const errorFrame = (
  parsed: Extract<BridgeResultFrame, { ok: false }>,
  details: ErrorDetails | undefined,
  path: string | undefined,
): BridgeResultFrame => ({
  protocolVersion: parsed.protocolVersion,
  kind: 'result',
  correlationId: parsed.correlationId,
  ok: false,
  error: {
    code: parsed.error.code,
    message: publicBridgeErrorMessage(parsed.error.code),
    ...(path === undefined ? {} : { path }),
    ...(details === undefined ? {} : { details }),
  },
});

const projectErrorResult = (
  parsed: Extract<BridgeResultFrame, { ok: false }>,
  capabilities: readonly BridgeCapability[],
  command: BridgeCommand,
  maxBytes: number,
): PreparedOutboundBridgeFrame<BridgeResultFrame> => {
  const projected = projectErrorDetails(parsed.error, capabilities, command);
  const path = hasCapability(capabilities, 'style.read')
    && parsed.error.path !== undefined
    && isRfc6901Pointer(parsed.error.path)
    ? parsed.error.path
    : undefined;
  const candidates = [
    errorFrame(parsed, projected.full, path),
    errorFrame(parsed, projected.metadata, path),
    errorFrame(parsed, projected.minimal, undefined),
  ];
  if (!projected.hasCurrentSnapshot) {
    candidates.push(errorFrame(parsed, undefined, undefined));
  }
  return firstFittingCandidate(candidates, BridgeResultFrameSchema, maxBytes);
};

const fullTransactionCandidates = (
  parsed: Extract<BridgeResultFrame, { ok: true }>,
): BridgeResultFrame[] => {
  if (parsed.result.type !== 'transaction' || parsed.result.detail !== 'full') {
    return [parsed];
  }
  const result = parsed.result;
  const candidates: BridgeResultFrame[] = [parsed];
  let omitted = result.omitted;
  let withoutStyle = result;
  if (result.style !== undefined) {
    omitted = { ...omitted, style: true };
    const remaining = { ...result };
    delete remaining.style;
    withoutStyle = { ...remaining, omitted };
    candidates.push({ ...parsed, result: withoutStyle });
  }
  if (withoutStyle.diff !== undefined) {
    const remaining = { ...withoutStyle };
    delete remaining.diff;
    omitted = { ...omitted, diff: true };
    candidates.push({ ...parsed, result: { ...remaining, omitted } });
  }
  candidates.push({
    ...parsed,
    result: {
      type: 'transaction',
      detail: 'receipt',
      revision: result.revision,
      styleHash: result.styleHash,
      applied: result.applied,
      noOp: result.noOp,
    },
  });
  return candidates;
};

const receiptOnly = (
  parsed: Extract<BridgeResultFrame, { ok: true }>,
): BridgeResultFrame => {
  if (parsed.result.type !== 'transaction') {
    throw createStyleToolError('CAPABILITY_DENIED', 'Bridge capability denied.');
  }
  const result = parsed.result;
  return {
    ...parsed,
    result: {
      type: 'transaction',
      detail: 'receipt',
      revision: result.revision,
      styleHash: result.styleHash,
      applied: result.applied,
      noOp: result.noOp,
    },
  };
};

const fixedResultFailure = (
  parsed: Extract<BridgeResultFrame, { ok: true }>,
): BridgeResultFrame => ({
  protocolVersion: parsed.protocolVersion,
  kind: 'result',
  correlationId: parsed.correlationId,
  ok: false,
  error: {
    code: 'INVALID_INPUT',
    message: publicBridgeErrorMessage('INVALID_INPUT'),
  },
});

const projectSuccessResult = (
  parsed: Extract<BridgeResultFrame, { ok: true }>,
  capabilities: readonly BridgeCapability[],
  command: BridgeCommand,
  maxBytes: number,
): PreparedOutboundBridgeFrame<BridgeResultFrame> => {
  const expected = BRIDGE_COMMAND_RESULT_TYPES[command.type];
  if (parsed.result.type !== expected) {
    throw new Error(`Bridge protocol result does not match command ${command.type}.`);
  }
  if (parsed.result.type === 'transaction') {
    const candidates = hasCapability(capabilities, 'style.read')
      ? fullTransactionCandidates(parsed)
      : [receiptOnly(parsed)];
    return firstFittingCandidate(candidates, BridgeResultFrameSchema, maxBytes);
  }
  if (parsed.result.type === 'style') {
    try {
      return prepareCandidate(parsed, BridgeResultFrameSchema, maxBytes);
    } catch (error) {
      if (!(error instanceof RangeError && /size limit/u.test(error.message))) throw error;
      return prepareCandidate(fixedResultFailure(parsed), BridgeResultFrameSchema, maxBytes);
    }
  }
  return prepareCandidate(parsed, BridgeResultFrameSchema, maxBytes);
};

const projectResult = (
  frame: BridgeResultFrame,
  capabilities: readonly BridgeCapability[],
  command: BridgeCommand,
  maxBytes: number,
): PreparedOutboundBridgeFrame<BridgeResultFrame> => {
  const parsed = BridgeResultFrameSchema.parse(frame);
  return parsed.ok
    ? projectSuccessResult(parsed, capabilities, command, maxBytes)
    : projectErrorResult(parsed, capabilities, command, maxBytes);
};

export function prepareOutboundBridgeFrame(
  frame: BridgeRegisterFrame,
  capabilities: readonly BridgeCapability[],
  maxBytes?: number,
): PreparedOutboundBridgeFrame<BridgeRegisterFrame>;
export function prepareOutboundBridgeFrame(
  frame: BridgeResultFrame,
  capabilities: readonly BridgeCapability[],
  command: BridgeCommand,
  maxBytes?: number,
): PreparedOutboundBridgeFrame<BridgeResultFrame>;
export function prepareOutboundBridgeFrame(
  frame: BridgeEventFrame,
  capabilities: readonly BridgeCapability[],
  maxBytes?: number,
): PreparedOutboundBridgeFrame<BridgeEventFrame>;
export function prepareOutboundBridgeFrame(
  frame: BrowserOutboundBridgeFrame,
  capabilities: readonly BridgeCapability[],
  commandOrMaxBytes?: BridgeCommand | number,
  maxBytes = MAX_BRIDGE_MESSAGE_BYTES,
): PreparedOutboundBridgeFrame {
  if (frame.kind === 'register') {
    if (typeof commandOrMaxBytes === 'object') {
      throw new TypeError('registration projection does not accept a command');
    }
    return projectRegistration(
      frame,
      capabilities,
      positiveSafeLimit(commandOrMaxBytes ?? MAX_BRIDGE_MESSAGE_BYTES),
    );
  }
  if (frame.kind === 'event') {
    if (typeof commandOrMaxBytes === 'object') {
      throw new TypeError('event projection does not accept a command');
    }
    return projectEvent(
      frame,
      capabilities,
      positiveSafeLimit(commandOrMaxBytes ?? MAX_BRIDGE_MESSAGE_BYTES),
    );
  }
  if (typeof commandOrMaxBytes !== 'object' || commandOrMaxBytes === null) {
    throw new TypeError('result projection requires its correlated command');
  }
  return projectResult(frame, capabilities, commandOrMaxBytes, positiveSafeLimit(maxBytes));
}

const allowedDetailKeys = (error: ParsedError, command: BridgeCommand): readonly string[] => {
  const keys = command.type === 'applyTransaction' || command.type === 'applyStyleDocument'
    ? ['currentSnapshot', 'rolledBack', 'rollbackError']
    : [];
  switch (error.code) {
    case 'CAPABILITY_DENIED':
      return [...keys, 'commandType', 'requiredCapability'];
    case 'INVALID_INPUT':
      return [...keys, 'reason'];
    case 'MAP_NOT_READY':
      return [...keys, 'syncState'];
    default:
      return keys;
  }
};

const assertDetailsAllowed = (
  error: ParsedError,
  command: BridgeCommand,
  capabilities: readonly BridgeCapability[],
): void => {
  const details = error.details;
  if (details === undefined) return;
  const allowed = allowedDetailKeys(error, command);
  for (const key of Object.keys(details)) {
    if (!allowed.includes(key)) {
      throw new Error('Bridge error details violate protocol allowlist.');
    }
  }
  const current = ownDataValue(details, 'currentSnapshot');
  if (current !== undefined) {
    if (command.type !== 'applyTransaction' && command.type !== 'applyStyleDocument') {
      throw new Error('Authoritative snapshots require a mutation command.');
    }
    const snapshot = MapSnapshotSchema.parse(current);
    if (snapshot.style !== undefined && !hasCapability(capabilities, 'style.read')) {
      throw new Error('Style snapshot requires style.read capability.');
    }
  }
  const rollback = ownDataValue(details, 'rollbackError');
  if (rollback !== undefined) {
    if (!isRecord(rollback)) {
      throw new Error('Rollback error must be an object.');
    }
    const keys = Object.keys(rollback);
    if (keys.some((key) => key !== 'code' && key !== 'message')) {
      throw new Error('Rollback error violates protocol allowlist.');
    }
    const code = styleToolErrorCode(ownDataValue(rollback, 'code'));
    if (code === undefined
      || ownDataValue(rollback, 'message') !== publicBridgeErrorMessage(code)) {
      throw new Error('Rollback error is not publicly normalized.');
    }
  }
  const rolledBack = ownDataValue(details, 'rolledBack');
  if (rolledBack !== undefined && typeof rolledBack !== 'boolean') {
    throw new Error('Rollback status must be boolean.');
  }
  if (error.code === 'CAPABILITY_DENIED') {
    const commandType = ownDataValue(details, 'commandType');
    const requiredCapability = ownDataValue(details, 'requiredCapability');
    if ((commandType !== undefined || requiredCapability !== undefined)
      && (commandType !== command.type
        || !BridgeCapabilitySchema.safeParse(requiredCapability).success)) {
      throw new Error('Invalid bridge capability-denial detail.');
    }
  }
  if (error.code === 'INVALID_INPUT'
    && ownDataValue(details, 'reason') !== undefined
    && ownDataValue(details, 'reason') !== 'relative-style-url') {
    throw new Error('Invalid bridge reason detail.');
  }
  if (error.code === 'MAP_NOT_READY') {
    const syncState = ownDataValue(details, 'syncState');
    if (syncState !== undefined && syncState !== 'known' && syncState !== 'unknown') {
      throw new Error('Invalid bridge synchronization detail.');
    }
  }
};

export function assertInboundResultAllowed(
  capabilities: readonly BridgeCapability[],
  command: BridgeCommand,
  frame: BridgeResultFrame,
): void {
  assertCapability(capabilities, command);
  const parsed = BridgeResultFrameSchema.parse(frame);
  if (parsed.ok) {
    if (parsed.result.type !== BRIDGE_COMMAND_RESULT_TYPES[command.type]) {
      throw new Error('Bridge result discriminant does not match command.');
    }
    if (parsed.result.type === 'transaction'
      && parsed.result.detail === 'full'
      && !hasCapability(capabilities, 'style.read')) {
      throw new Error('Full transaction requires style.read capability.');
    }
    return;
  }
  if (parsed.error.message !== publicBridgeErrorMessage(parsed.error.code)) {
    throw new Error('Bridge error message is not publicly normalized.');
  }
  if (parsed.error.path !== undefined) {
    if (!hasCapability(capabilities, 'style.read')) {
      throw new Error('Bridge error path requires style.read capability.');
    }
    if (!isRfc6901Pointer(parsed.error.path)) {
      throw new Error('Bridge error path is not an RFC 6901 pointer.');
    }
  }
  assertDetailsAllowed(parsed.error, command, capabilities);
}

export function assertInboundEventAllowed(
  capabilities: readonly BridgeCapability[],
  frame: BridgeEventFrame,
): void {
  const parsed = BridgeEventFrameSchema.parse(frame);
  if (parsed.event !== 'mapStatus'
    && parsed.snapshot.style !== undefined
    && !hasCapability(capabilities, 'style.read')) {
    throw new Error('Style snapshot requires style.read capability.');
  }
}

// Compile-time coverage: a new public error code must be added to the fixed mapping.
void (PUBLIC_ERROR_MESSAGES satisfies Record<StyleToolErrorCode, string>);
