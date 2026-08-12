import { canonicalizeJson } from '../../core/canonical-json.js';
import type { StyleDocument } from '../../core/types.js';

export async function sha256CanonicalJson(value: unknown): Promise<string> {
  const canonical = canonicalizeJson(value);
  const bytes = new TextEncoder().encode(canonical);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function hashStyle(style: StyleDocument): Promise<string> {
  return sha256CanonicalJson(style);
}
