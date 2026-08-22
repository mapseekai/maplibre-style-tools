import type { MapStyleApplyResult } from '../adapters/maplibre/types.js';
import { createStyleToolError, isStyleToolError, type StyleDocument, type StyleTransaction } from '../core/index.js';
import type { StyleAuthority } from '../capabilities/authority.js';
import type { StyleSessionStore } from './session-store.js';

/** Style authority pinned to a session snapshot for one MCP tool call. */
const abortedSessionMutation = (): Extract<MapStyleApplyResult, { ok: false }> => ({
  ok: false, styleAuthority: 'unavailable', applied: false,
  changedLayers: [], changedSources: [], diff: [], warnings: [],
  error: createStyleToolError(
    'TIMEOUT', 'Style session operation was aborted.', '', { reason: 'aborted' },
  ),
});

export class SessionStyleAuthority implements StyleAuthority {
  constructor(
    private readonly store: StyleSessionStore,
    private readonly sessionId: string,
    private readonly expectedRevision: number,
    private readonly snapshot: StyleDocument,
  ) {}

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
      const result = await this.store.apply(this.sessionId, {
        expectedRevision: this.expectedRevision,
        transaction,
      });
      return {
        ok: true,
        style: result.style,
        applied: true,
        changedLayers: [...result.changedLayers],
        changedSources: [...result.changedSources],
        diff: options.diff ? [...result.diff] : [],
        warnings: [...result.warnings],
        styleAuthority: 'current',
      };
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
      const result = await this.store.replace(this.sessionId, this.expectedRevision, source);
      return {
        ok: true,
        style: result.style,
        applied: true,
        changedLayers: [...result.changedLayers],
        changedSources: [...result.changedSources],
        diff: options.diff ? [...result.diff] : [],
        warnings: [...result.warnings],
        styleAuthority: 'current',
      };
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
