import { toJsonPointer } from './json-pointer.js';
import type {
  JsonObject, JsonValue, OperationContext, StyleDiffEntry, StyleDiffTarget, StyleDocument,
  StyleLayer,
} from './types.js';

type PointerToken = string | number;

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneJsonValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map((item) => cloneJsonValue(item));
  if (isJsonObject(value)) {
    const clone: JsonObject = {};
    for (const key of Object.keys(value)) clone[key] = cloneJsonValue(value[key]!);
    return clone;
  }
  return value;
}

export function jsonValuesEqual(left: JsonValue, right: JsonValue): boolean {
  if (Array.isArray(left)) {
    if (!Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => jsonValuesEqual(value, right[index]!));
  }
  if (isJsonObject(left)) {
    if (!isJsonObject(right)) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key, index) => (
      key === rightKeys[index] && jsonValuesEqual(left[key]!, right[key]!)
    ));
  }
  return left === right;
}

function requireCandidate(target: StyleDiffTarget, context: OperationContext): StyleDiffTarget {
  if (target.kind === 'layer' && !context.changedLayerIds.has(target.id)) {
    throw new Error(`Internal invariant: candidate layer "${target.id}" is required for its diff`);
  }
  if (target.kind === 'source' && !context.changedSourceIds.has(target.id)) {
    throw new Error(`Internal invariant: candidate source "${target.id}" is required for its diff`);
  }
  return target;
}

function targetForPath(
  tokens: readonly PointerToken[],
  layerId: string | undefined,
  context: OperationContext,
): StyleDiffTarget {
  if (layerId !== undefined) {
    return requireCandidate({ kind: 'layer', id: layerId }, context);
  }
  if (tokens[0] === 'sources' && typeof tokens[1] === 'string') {
    return requireCandidate({ kind: 'source', id: tokens[1] }, context);
  }
  return { kind: 'style' };
}

function addEntry(
  entries: StyleDiffEntry[],
  tokens: readonly PointerToken[],
  after: JsonValue,
  layerId: string | undefined,
  context: OperationContext,
): void {
  entries.push({
    op: 'add',
    path: toJsonPointer(tokens),
    after,
    target: targetForPath(tokens, layerId, context),
  });
}

function removeEntry(
  entries: StyleDiffEntry[],
  tokens: readonly PointerToken[],
  before: JsonValue,
  layerId: string | undefined,
  context: OperationContext,
): void {
  entries.push({
    op: 'remove',
    path: toJsonPointer(tokens),
    before,
    target: targetForPath(tokens, layerId, context),
  });
}

function replaceEntry(
  entries: StyleDiffEntry[],
  tokens: readonly PointerToken[],
  before: JsonValue,
  after: JsonValue,
  layerId: string | undefined,
  context: OperationContext,
): void {
  entries.push({
    op: 'replace',
    path: toJsonPointer(tokens),
    before,
    after,
    target: targetForPath(tokens, layerId, context),
  });
}

function layerIds(layers: readonly StyleLayer[]): string[] {
  return layers.map((layer) => layer.id);
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function moveLayer(
  entries: StyleDiffEntry[],
  workingLayers: StyleLayer[],
  fromIndex: number,
  toIndex: number,
  context: OperationContext,
): void {
  const layer = workingLayers[fromIndex]!;
  const target = requireCandidate({ kind: 'layer', id: layer.id }, context);
  entries.push({
    op: 'move',
    from: toJsonPointer(['layers', fromIndex]),
    path: toJsonPointer(['layers', toIndex]),
    target,
  });
  workingLayers.splice(fromIndex, 1);
  workingLayers.splice(toIndex, 0, layer);
}

function reconcileLayerOrder(
  before: readonly StyleLayer[],
  after: readonly StyleLayer[],
  context: OperationContext,
  entries: StyleDiffEntry[],
): void {
  const afterById = new Map(after.map((layer) => [layer.id, layer]));
  const beforeById = new Map(before.map((layer) => [layer.id, layer]));
  const workingLayers = [...before];

  const removedIndexes = workingLayers
    .map((layer, index) => afterById.has(layer.id) ? -1 : index)
    .filter((index) => index >= 0)
    .sort((left, right) => right - left);
  for (const index of removedIndexes) {
    const layer = workingLayers[index]!;
    removeEntry(entries, ['layers', index], layer, layer.id, context);
    workingLayers.splice(index, 1);
  }

  const targetExistingIds = after
    .filter((layer) => beforeById.has(layer.id))
    .map((layer) => layer.id);
  const workingNonCandidates = layerIds(workingLayers)
    .filter((id) => !context.changedLayerIds.has(id));
  const targetNonCandidates = targetExistingIds
    .filter((id) => !context.changedLayerIds.has(id));
  if (!sameStrings(workingNonCandidates, targetNonCandidates)) {
    throw new Error('Internal invariant: candidate layer order cannot explain non-candidate reordering');
  }

  let moveCount = 0;
  while (!sameStrings(layerIds(workingLayers), targetExistingIds)) {
    if (moveCount++ > workingLayers.length * workingLayers.length) {
      throw new Error('Internal invariant: candidate layer order reconciliation did not converge');
    }
    const currentIds = layerIds(workingLayers);
    const mismatchIndex = currentIds.findIndex((id, index) => id !== targetExistingIds[index]);
    const desiredId = targetExistingIds[mismatchIndex]!;
    const currentId = currentIds[mismatchIndex]!;
    if (context.changedLayerIds.has(desiredId)) {
      moveLayer(entries, workingLayers, currentIds.indexOf(desiredId), mismatchIndex, context);
      continue;
    }
    if (context.changedLayerIds.has(currentId)) {
      moveLayer(
        entries,
        workingLayers,
        mismatchIndex,
        targetExistingIds.indexOf(currentId),
        context,
      );
      continue;
    }
    throw new Error('Internal invariant: candidate layer order cannot explain layer reordering');
  }

  for (let index = 0; index < after.length; index += 1) {
    const layer = after[index]!;
    if (beforeById.has(layer.id)) continue;
    addEntry(entries, ['layers', index], layer, layer.id, context);
    workingLayers.splice(index, 0, layer);
  }

  for (let index = 0; index < after.length; index += 1) {
    const afterLayer = after[index]!;
    const beforeLayer = beforeById.get(afterLayer.id);
    if (beforeLayer === undefined) continue;
    diffJsonValues(
      beforeLayer,
      afterLayer,
      ['layers', index],
      afterLayer.id,
      context,
      entries,
    );
  }
}

function diffObjects(
  before: JsonObject,
  after: JsonObject,
  tokens: readonly PointerToken[],
  layerId: string | undefined,
  context: OperationContext,
  entries: StyleDiffEntry[],
): void {
  const beforeKeys = Object.keys(before);
  const afterKeys = Object.keys(after);
  const afterKeySet = new Set(afterKeys);
  const beforeKeySet = new Set(beforeKeys);

  const removedKeys = beforeKeys.filter((key) => !afterKeySet.has(key)).sort();
  const sharedKeys = beforeKeys.filter((key) => afterKeySet.has(key)).sort();
  const addedKeys = afterKeys.filter((key) => !beforeKeySet.has(key)).sort();

  for (const key of removedKeys) {
    removeEntry(entries, [...tokens, key], before[key]!, layerId, context);
  }
  for (const key of sharedKeys) {
    if (tokens.length === 0 && key === 'layers') {
      reconcileLayerOrder(
        before[key] as StyleLayer[],
        after[key] as StyleLayer[],
        context,
        entries,
      );
      continue;
    }
    diffJsonValues(before[key]!, after[key]!, [...tokens, key], layerId, context, entries);
  }
  for (const key of addedKeys) {
    addEntry(entries, [...tokens, key], after[key]!, layerId, context);
  }
}

function diffJsonValues(
  before: JsonValue,
  after: JsonValue,
  tokens: readonly PointerToken[],
  layerId: string | undefined,
  context: OperationContext,
  entries: StyleDiffEntry[],
): void {
  if (jsonValuesEqual(before, after)) return;
  if (isJsonObject(before) && isJsonObject(after)) {
    diffObjects(before, after, tokens, layerId, context, entries);
    return;
  }
  replaceEntry(entries, tokens, before, after, layerId, context);
}

export function diffStyleDocuments(
  before: StyleDocument,
  after: StyleDocument,
  context: OperationContext,
): StyleDiffEntry[] {
  const entries: StyleDiffEntry[] = [];
  diffJsonValues(before, after, [], undefined, context, entries);
  return entries;
}

function decodePointer(pointer: string): string[] {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) throw new Error(`Invalid JSON Pointer: ${pointer}`);
  return pointer.slice(1).split('/').map((token) => (
    token.replaceAll('~1', '/').replaceAll('~0', '~')
  ));
}

function arrayIndex(token: string, length: number, allowEnd: boolean): number {
  if (!/^(0|[1-9]\d*)$/.test(token)) throw new Error(`Invalid JSON array index: ${token}`);
  const index = Number(token);
  const maximum = allowEnd ? length : length - 1;
  if (!Number.isSafeInteger(index) || index > maximum) {
    throw new Error(`JSON array index out of bounds: ${token}`);
  }
  return index;
}

function pointerParent(root: JsonValue, tokens: readonly string[]): [JsonValue, string] {
  if (tokens.length === 0) throw new Error('The document root has no parent');
  let current = root;
  for (const token of tokens.slice(0, -1)) {
    if (Array.isArray(current)) {
      current = current[arrayIndex(token, current.length, false)]!;
    } else if (isJsonObject(current)) {
      const next = current[token];
      if (next === undefined) throw new Error(`JSON Pointer does not exist: ${token}`);
      current = next;
    } else {
      throw new Error(`JSON Pointer traverses a primitive: ${token}`);
    }
  }
  return [current, tokens.at(-1)!];
}

function removeAt(root: JsonValue, tokens: readonly string[]): JsonValue {
  const [parent, token] = pointerParent(root, tokens);
  if (Array.isArray(parent)) {
    return parent.splice(arrayIndex(token, parent.length, false), 1)[0]!;
  }
  if (isJsonObject(parent)) {
    const value = parent[token];
    if (value === undefined) throw new Error(`JSON Pointer does not exist: ${token}`);
    delete parent[token];
    return value;
  }
  throw new Error(`JSON Pointer parent is a primitive: ${token}`);
}

function addAt(root: JsonValue, tokens: readonly string[], value: JsonValue): void {
  const [parent, token] = pointerParent(root, tokens);
  if (Array.isArray(parent)) {
    parent.splice(arrayIndex(token, parent.length, true), 0, value);
    return;
  }
  if (isJsonObject(parent)) {
    parent[token] = value;
    return;
  }
  throw new Error(`JSON Pointer parent is a primitive: ${token}`);
}

function replaceAt(root: JsonValue, tokens: readonly string[], value: JsonValue): void {
  const [parent, token] = pointerParent(root, tokens);
  if (Array.isArray(parent)) {
    parent[arrayIndex(token, parent.length, false)] = value;
    return;
  }
  if (isJsonObject(parent)) {
    if (!(token in parent)) throw new Error(`JSON Pointer does not exist: ${token}`);
    parent[token] = value;
    return;
  }
  throw new Error(`JSON Pointer parent is a primitive: ${token}`);
}

export function replayStyleDiff(
  style: StyleDocument,
  entries: readonly StyleDiffEntry[],
): StyleDocument {
  let root = cloneJsonValue(style);
  for (const entry of entries) {
    const pathTokens = decodePointer(entry.path);
    if (entry.op === 'remove') {
      if (pathTokens.length === 0) throw new Error('Cannot remove the style document root');
      removeAt(root, pathTokens);
    } else if (entry.op === 'add') {
      if (entry.after === undefined) throw new Error('Add diff entry is missing its after value');
      const value = cloneJsonValue(entry.after);
      if (pathTokens.length === 0) root = value;
      else addAt(root, pathTokens, value);
    } else if (entry.op === 'replace') {
      if (entry.after === undefined) throw new Error('Replace diff entry is missing its after value');
      const value = cloneJsonValue(entry.after);
      if (pathTokens.length === 0) root = value;
      else replaceAt(root, pathTokens, value);
    } else {
      if (entry.from === undefined) throw new Error('Move diff entry is missing its from pointer');
      const fromTokens = decodePointer(entry.from);
      if (fromTokens.length === 0) throw new Error('Cannot move the style document root');
      const value = removeAt(root, fromTokens);
      if (pathTokens.length === 0) root = value;
      else addAt(root, pathTokens, value);
    }
  }
  return root as StyleDocument;
}
