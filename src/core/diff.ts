import { toJsonPointer } from './json-pointer.js';
import type {
  JsonObject, JsonValue, OperationContext, StyleDiffEntry, StyleDiffTarget, StyleDocument,
  StyleLayer,
} from './types.js';

type PointerToken = string | number;
type PathNode = {
  parent: PathNode | undefined;
  token: PointerToken;
  depth: number;
};
type DiffPath = PathNode | undefined;
type CloneContainer = JsonValue[] | JsonObject;
type CloneWork = { source: CloneContainer; target: CloneContainer };
type DiffWork =
  | {
      kind: 'compare';
      before: JsonValue;
      after: JsonValue;
      path: DiffPath;
      layerId: string | undefined;
    }
  | {
      kind: 'add';
      after: JsonValue;
      path: PathNode;
      layerId: string | undefined;
    }
  | {
      kind: 'remove';
      before: JsonValue;
      path: PathNode;
      layerId: string | undefined;
    }
  | {
      kind: 'layers';
      before: readonly StyleLayer[];
      after: readonly StyleLayer[];
    };

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneContainer(value: JsonValue, work: CloneWork[]): JsonValue {
  if (Array.isArray(value)) {
    const clone: JsonValue[] = [];
    work.push({ source: value, target: clone });
    return clone;
  }
  if (isJsonObject(value)) {
    const clone: JsonObject = {};
    work.push({ source: value, target: clone });
    return clone;
  }
  return value;
}

function cloneJsonValue(value: JsonValue): JsonValue {
  const work: CloneWork[] = [];
  const root = cloneContainer(value, work);

  while (work.length > 0) {
    const frame = work.pop()!;
    if (Array.isArray(frame.source)) {
      const target = frame.target as JsonValue[];
      for (let index = 0; index < frame.source.length; index += 1) {
        Reflect.defineProperty(target, index, {
          configurable: true,
          enumerable: true,
          value: cloneContainer(frame.source[index]!, work),
          writable: true,
        });
      }
      continue;
    }

    const target = frame.target as JsonObject;
    for (const key of Object.keys(frame.source)) {
      Reflect.defineProperty(target, key, {
        configurable: true,
        enumerable: true,
        value: cloneContainer(frame.source[key]!, work),
        writable: true,
      });
    }
  }
  return root;
}

export function jsonValuesEqual(left: JsonValue, right: JsonValue): boolean {
  const work: Array<readonly [JsonValue, JsonValue]> = [[left, right]];
  while (work.length > 0) {
    const [leftValue, rightValue] = work.pop()!;
    if (leftValue === rightValue) continue;
    if (Array.isArray(leftValue)) {
      if (!Array.isArray(rightValue) || leftValue.length !== rightValue.length) return false;
      for (let index = 0; index < leftValue.length; index += 1) {
        work.push([leftValue[index]!, rightValue[index]!]);
      }
      continue;
    }
    if (isJsonObject(leftValue)) {
      if (!isJsonObject(rightValue)) return false;
      const leftKeys = Object.keys(leftValue).sort();
      const rightKeys = Object.keys(rightValue).sort();
      if (leftKeys.length !== rightKeys.length) return false;
      for (let index = 0; index < leftKeys.length; index += 1) {
        const key = leftKeys[index]!;
        if (key !== rightKeys[index]) return false;
        work.push([leftValue[key]!, rightValue[key]!]);
      }
      continue;
    }
    return false;
  }
  return true;
}

function appendPath(parent: DiffPath, token: PointerToken): PathNode {
  return { parent, token, depth: (parent?.depth ?? 0) + 1 };
}

function pathFromTokens(tokens: readonly PointerToken[]): DiffPath {
  let path: DiffPath;
  for (const token of tokens) path = appendPath(path, token);
  return path;
}

function tokensFromPath(path: DiffPath): PointerToken[] {
  if (path === undefined) return [];
  const tokens = new Array<PointerToken>(path.depth);
  let current: DiffPath = path;
  while (current !== undefined) {
    tokens[current.depth - 1] = current.token;
    current = current.parent;
  }
  return tokens;
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

  const orderedCandidates = [...context.changedLayerIds]
    .filter((id) => beforeById.has(id) && afterById.has(id));
  for (let candidateIndex = 0; candidateIndex < orderedCandidates.length; candidateIndex += 1) {
    const candidateId = orderedCandidates[candidateIndex]!;
    const futureCandidates = new Set(orderedCandidates.slice(candidateIndex + 1));
    const currentProjection = layerIds(workingLayers)
      .filter((id) => !futureCandidates.has(id));
    const targetProjection = targetExistingIds
      .filter((id) => !futureCandidates.has(id));
    if (sameStrings(currentProjection, targetProjection)) continue;

    const desiredIndex = targetProjection.indexOf(candidateId);
    const fromIndex = workingLayers.findIndex((layer) => layer.id === candidateId);
    const nextId = targetProjection[desiredIndex + 1];
    const previousId = targetProjection[desiredIndex - 1];
    let toIndex: number;
    if (nextId !== undefined) {
      const anchorIndex = workingLayers.findIndex((layer) => layer.id === nextId);
      toIndex = anchorIndex - (fromIndex < anchorIndex ? 1 : 0);
    } else if (previousId !== undefined) {
      const anchorIndex = workingLayers.findIndex((layer) => layer.id === previousId);
      toIndex = anchorIndex - (fromIndex < anchorIndex ? 1 : 0) + 1;
    } else {
      throw new Error('Internal invariant: candidate layer projection cannot be reconciled');
    }
    if (fromIndex === -1 || desiredIndex === -1 || fromIndex === toIndex) {
      throw new Error('Internal invariant: candidate layer projection cannot be reconciled');
    }
    moveLayer(entries, workingLayers, fromIndex, toIndex, context);
    const updatedProjection = layerIds(workingLayers)
      .filter((id) => !futureCandidates.has(id));
    if (!sameStrings(updatedProjection, targetProjection)) {
      throw new Error('Internal invariant: candidate layer projection cannot be reconciled');
    }
  }
  if (!sameStrings(layerIds(workingLayers), targetExistingIds)) {
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
  path: DiffPath,
  layerId: string | undefined,
  work: DiffWork[],
): void {
  const beforeKeys = Object.keys(before);
  const afterKeys = Object.keys(after);
  const afterKeySet = new Set(afterKeys);
  const beforeKeySet = new Set(beforeKeys);

  const removedKeys = beforeKeys.filter((key) => !afterKeySet.has(key)).sort();
  const sharedKeys = beforeKeys.filter((key) => afterKeySet.has(key)).sort();
  const addedKeys = afterKeys.filter((key) => !beforeKeySet.has(key)).sort();

  for (let index = addedKeys.length - 1; index >= 0; index -= 1) {
    const key = addedKeys[index]!;
    work.push({ kind: 'add', after: after[key]!, path: appendPath(path, key), layerId });
  }
  for (let index = sharedKeys.length - 1; index >= 0; index -= 1) {
    const key = sharedKeys[index]!;
    if (path === undefined && key === 'layers') {
      work.push({
        kind: 'layers',
        before: before[key] as StyleLayer[],
        after: after[key] as StyleLayer[],
      });
    } else {
      work.push({
        kind: 'compare',
        before: before[key]!,
        after: after[key]!,
        path: appendPath(path, key),
        layerId,
      });
    }
  }
  for (let index = removedKeys.length - 1; index >= 0; index -= 1) {
    const key = removedKeys[index]!;
    work.push({ kind: 'remove', before: before[key]!, path: appendPath(path, key), layerId });
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
  const work: DiffWork[] = [{
    kind: 'compare', before, after, path: pathFromTokens(tokens), layerId,
  }];

  while (work.length > 0) {
    const action = work.pop()!;
    if (action.kind === 'add') {
      addEntry(entries, tokensFromPath(action.path), action.after, action.layerId, context);
      continue;
    }
    if (action.kind === 'remove') {
      removeEntry(entries, tokensFromPath(action.path), action.before, action.layerId, context);
      continue;
    }
    if (action.kind === 'layers') {
      reconcileLayerOrder(action.before, action.after, context, entries);
      continue;
    }
    if (action.before === action.after) continue;
    if (isJsonObject(action.before) && isJsonObject(action.after)) {
      diffObjects(action.before, action.after, action.path, action.layerId, work);
      continue;
    }
    if (jsonValuesEqual(action.before, action.after)) continue;
    replaceEntry(
      entries,
      tokensFromPath(action.path),
      action.before,
      action.after,
      action.layerId,
      context,
    );
  }
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
