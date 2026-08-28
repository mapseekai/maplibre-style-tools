import type { StyleDocument } from 'maplibre-style-tools/core';

import { isCommentHighlightLayer } from './comment-highlight.js';

export type ParsedStyleUrl =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly error: string };

export type ParsedStyleJson =
  | { readonly ok: true; readonly style: StyleDocument }
  | { readonly ok: false; readonly error: string };

export const parseStyleUrl = (value: string): ParsedStyleUrl => {
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: false, error: '请输入样式 URL。' };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, error: '样式 URL 无效。' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, error: '样式 URL 必须使用 http 或 https 协议。' };
  }
  return { ok: true, url: url.href };
};

export const parseStyleJson = (value: string): ParsedStyleJson => {
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: false, error: '请粘贴样式 JSON 文档。' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: '样式 JSON 不是合法的 JSON。' };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: '样式 JSON 必须是 JSON 对象。' };
  }
  const candidate = parsed as { readonly version?: unknown; readonly layers?: unknown };
  if (candidate.version !== 8) return { ok: false, error: '样式 JSON 必须声明 "version": 8。' };
  if (!Array.isArray(candidate.layers)) return { ok: false, error: '样式 JSON 必须包含 "layers" 数组。' };
  // Shape checked above; StyleDocument carries the same structural contract.
  const style = parsed as StyleDocument;
  return { ok: true, style };
};

/**
 * Strips page-internal overlay layers so the export reflects the authored
 * style plus requested mutations, never the comment highlight scaffolding.
 */
export const styleForExport = (style: StyleDocument): StyleDocument => ({
  ...style,
  layers: style.layers.filter((layer) => !isCommentHighlightLayer(layer.id)),
});
