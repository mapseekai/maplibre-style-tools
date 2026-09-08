import type { MapStyleApplyResult } from '../adapters/maplibre/types.js';
import { createStyleToolError, isStyleToolError, type StyleDocument, type StyleTransaction } from '../core/index.js';
import type { StyleAuthority } from '../capabilities/authority.js';
import { DOCUMENT_MESSAGE, receipt, TRANSACTION_MESSAGE } from '../capabilities/mutate.js';
import {
  applyStyleSessionTransactionResult,
  replaceStyleSessionResult,
  type StyleSessionStore,
} from './session-store.js';
import type { ApplySessionTransactionResult, McpTextToolResult } from './types.js';
import type { CapabilityResult, StyleMutationReceipt } from '../capabilities/contracts.js';

/** Style authority pinned to a session snapshot for one MCP tool call. */
const abortedSessionMutation = (): Extract<MapStyleApplyResult, { ok: false }> => ({
  ok: false, styleAuthority: 'unavailable', applied: false,
  changedLayers: [], changedSources: [], diff: [], warnings: [],
  error: createStyleToolError(
    'TIMEOUT', 'Style session operation was aborted.', '', { reason: 'aborted' },
  ),
});

export class SessionStyleAuthority implements StyleAuthority {
  mutationResponse: McpTextToolResult | undefined;

  constructor(
    private readonly store: StyleSessionStore,
    private readonly sessionId: string,
    private readonly expectedRevision: number,
    private readonly snapshot: StyleDocument,
    private readonly finalizeMutation?: (
      result: CapabilityResult<StyleMutationReceipt>, revision: number,
    ) => McpTextToolResult,
  ) {}

  private finalize(result: ApplySessionTransactionResult, diff: boolean, message: string) {
    const applied = {
      ok: true as const,
      style: result.style,
      applied: true,
      changedLayers: [...result.changedLayers],
      changedSources: [...result.changedSources],
      diff: diff ? [...result.diff] : [],
      warnings: [...result.warnings],
      styleAuthority: 'current' as const,
    };
    return {
      applied,
      response: structuredClone(
        this.finalizeMutation?.(receipt(message, applied, diff), result.revision) ?? null,
      ),
    };
  }

  readStyle() {
    return { ok: true as const, style: this.snapshot, warnings: [] };
  }

  context() { return {}; }

  async applyTransaction(
    transaction: StyleTransaction,
    options: { diff: boolean; signal?: AbortSignal },
  ): Promise<MapStyleApplyResult> {
    if (options.signal?.aborted === true) return abortedSessionMutation();
    try {
      const result = await applyStyleSessionTransactionResult(this.store, this.sessionId, {
        expectedRevision: this.expectedRevision,
        transaction,
      }, (candidate) => this.finalize(candidate, options.diff, TRANSACTION_MESSAGE));
      this.mutationResponse = result.response ?? undefined;
      return result.applied;
    } catch (error) {
      return {
        ok: false, styleAuthority: 'unavailable', applied: false,
        changedLayers: [], changedSources: [], diff: [], warnings: [],
        error: isStyleToolError(error)
          ? error
          : createStyleToolError('INTERNAL', 'Style session mutation failed.'),
      };
    }
  }

  async applyDocument(
    source: StyleDocument | string,
    options: { diff: boolean; signal?: AbortSignal },
  ): Promise<MapStyleApplyResult> {
    if (options.signal?.aborted === true) return abortedSessionMutation();
    if (typeof source === 'string') {
      return {
        ok: false, styleAuthority: 'unavailable', applied: false,
        changedLayers: [], changedSources: [], diff: [], warnings: [],
        error: createStyleToolError(
          'INVALID_INPUT', 'A session target only accepts an inline style document.', '/source',
        ),
      };
    }
    try {
      const result = await replaceStyleSessionResult(
        this.store, this.sessionId, this.expectedRevision, source,
        (candidate) => this.finalize(candidate, options.diff, DOCUMENT_MESSAGE),
      );
      this.mutationResponse = result.response ?? undefined;
      return result.applied;
    } catch (error) {
      return {
        ok: false, styleAuthority: 'unavailable', applied: false,
        changedLayers: [], changedSources: [], diff: [], warnings: [],
        error: isStyleToolError(error)
          ? error
          : createStyleToolError('INTERNAL', 'Style session replacement failed.'),
      };
    }
  }
}
