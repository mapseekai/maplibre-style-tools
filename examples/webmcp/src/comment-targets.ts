export interface FeatureReference {
  readonly layerId: string;
  readonly sourceId: string;
  readonly sourceLayer?: string;
  readonly featureId?: string | number;
  readonly lngLat: readonly [number, number];
  readonly properties: Readonly<Record<string, string | number | boolean | null>>;
}

export type Scalar = string | number | boolean | null;

export type PendingMapCommentInput =
  | { readonly comment: string; readonly scope: 'feature'; readonly feature: FeatureReference & { readonly featureId: string | number } }
  | { readonly comment: string; readonly scope: 'property-class'; readonly feature: FeatureReference; readonly selector: { readonly property: string; readonly value: Scalar } }
  | { readonly comment: string; readonly scope: 'layer'; readonly feature: FeatureReference };

export type PendingMapComment = PendingMapCommentInput & { readonly selectionId: string };

const MAX_PROPERTIES = 20;
const MAX_PROPERTY_NAME_LENGTH = 80;
const MAX_SELECTION_ID_LENGTH = 128;

const MAX_STRING_LENGTH = 240;

export const isBoundedIdentity = (value: unknown, maximumLength: number): value is string => typeof value === 'string'
  && value.length > 0
  && value.length <= maximumLength;

const isScalar = (value: unknown): value is Scalar => value === null
  || typeof value === 'string'
  || typeof value === 'boolean'
  || (typeof value === 'number' && Number.isFinite(value));

const boundedString = (value: string, length = MAX_STRING_LENGTH): string => value.slice(0, length);

const boundedComment = (value: unknown): string => {
  if (typeof value !== 'string') throw new TypeError('Comment must be a string.');
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new TypeError('Comment must be non-empty.');
  if (trimmed.length > 1_000) throw new RangeError('Comment must not exceed 1,000 characters.');
  return trimmed;
};

const requiredIdentifier = (value: unknown, name: string, maximumLength = MAX_PROPERTY_NAME_LENGTH): string => {
  if (isBoundedIdentity(value, maximumLength)) return value;
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} must be a non-empty identifier.`);
  if (value.length > maximumLength) throw new RangeError(`${name} must not exceed ${maximumLength} characters.`);
  throw new TypeError(`${name} must be a string identifier.`);
};

const stableFeatureId = (value: unknown): string | number | undefined => {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return requiredIdentifier(value, 'Feature ID', MAX_STRING_LENGTH);
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

const frozenFeature = (feature: FeatureReference): FeatureReference => {
  const properties: Record<string, Scalar> = {};
  for (const [name, value] of Object.entries(feature.properties ?? {})) {
    if (Object.keys(properties).length === MAX_PROPERTIES) break;
    if (!isScalar(value)) continue;
    if (name.length === 0 || name.length > MAX_PROPERTY_NAME_LENGTH) continue;
    properties[name] = typeof value === 'string' ? boundedString(value) : value;
  }

  const longitude = feature.lngLat?.[0];
  const latitude = feature.lngLat?.[1];
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    throw new TypeError('Feature location must contain finite longitude and latitude values.');
  }

  const featureId = stableFeatureId(feature.featureId);
  return Object.freeze({
    layerId: requiredIdentifier(feature.layerId, 'Layer ID'),
    sourceId: requiredIdentifier(feature.sourceId, 'Source ID'),
    ...(feature.sourceLayer === undefined ? {} : { sourceLayer: requiredIdentifier(feature.sourceLayer, 'Source layer ID') }),
    ...(featureId === undefined ? {} : { featureId }),
    lngLat: Object.freeze([longitude, latitude]) as readonly [number, number],
    properties: Object.freeze(properties),
  });
};

const frozenComment = (selectionId: string, input: PendingMapCommentInput): PendingMapComment => {
  const comment = boundedComment(input.comment);
  const feature = frozenFeature(input.feature);
  if (input.scope === 'feature') {
    if (feature.featureId === undefined) throw new TypeError('Feature scope requires a stable feature ID.');
    return Object.freeze({
      comment,
      selectionId,
      scope: 'feature' as const,
      feature: Object.freeze({ ...feature, featureId: feature.featureId }),
    });
  }
  if (input.scope === 'property-class') {
    const property = requiredIdentifier(input.selector?.property, 'Property selector');
    if (!isScalar(input.selector?.value)) throw new TypeError('Property selector value must be scalar.');
    return Object.freeze({
      comment,
      selectionId,
      scope: 'property-class' as const,
      feature,
      selector: Object.freeze({
        property,
        value: typeof input.selector.value === 'string' ? boundedString(input.selector.value) : input.selector.value,
      }),
    });
  }
  return Object.freeze({ comment, selectionId, scope: 'layer' as const, feature });
};

export class PendingMapCommentStore {
  readonly #capacity: number;
  readonly #idFactory: () => string;
  readonly #onRemove?: (comment: PendingMapComment) => void;
  readonly #comments = new Map<string, PendingMapComment>();
  readonly #issuedIds = new Set<string>();

  constructor(options: {
    capacity: number;
    idFactory(): string;
    onRemove?(comment: PendingMapComment): void;
  }) {
    if (!Number.isInteger(options.capacity) || options.capacity < 1 || options.capacity > MAX_PROPERTIES) {
      throw new RangeError(`Comment target capacity must be an integer between 1 and ${MAX_PROPERTIES}.`);
    }
    this.#capacity = options.capacity;
    this.#idFactory = options.idFactory;
    this.#onRemove = options.onRemove;
  }

  get size(): number {
    return this.#comments.size;
  }

  add(input: PendingMapCommentInput): PendingMapComment {
    if (this.#comments.size >= this.#capacity) {
      throw new RangeError('Pending map comment capacity has been reached.');
    }
    const selectionId = requiredIdentifier(this.#idFactory(), 'Selection ID', MAX_SELECTION_ID_LENGTH);
    if (this.#issuedIds.has(selectionId)) throw new Error(`Pending map comment ID already issued: ${selectionId}`);
    const comment = frozenComment(selectionId, input);
    this.#issuedIds.add(selectionId);
    this.#comments.set(selectionId, comment);
    return comment;
  }

  get(selectionId: string): PendingMapComment | undefined {
    return this.#comments.get(selectionId);
  }

  consumeMany(selectionIds: readonly string[]): readonly PendingMapComment[] {
    if (!Array.isArray(selectionIds) || selectionIds.length < 1 || selectionIds.length > MAX_PROPERTIES) {
      throw new TypeError(`Selection context IDs must contain between 1 and ${MAX_PROPERTIES} items.`);
    }
    const seen = new Set<string>();
    for (const selectionId of selectionIds) {
      if (typeof selectionId !== 'string' || selectionId.length === 0) {
        throw new TypeError('Selection context IDs must be non-empty strings.');
      }
      if (seen.has(selectionId)) throw new TypeError('Selection context IDs must be unique.');
      seen.add(selectionId);
    }
    const comments = selectionIds.map((selectionId) => {
      const comment = this.#comments.get(selectionId);
      if (comment === undefined) throw new TypeError('A referenced selection context is unknown.');
      return comment;
    });
    for (const selectionId of selectionIds) this.remove(selectionId);
    return Object.freeze(comments);
  }

  remove(selectionId: string): boolean {
    const comment = this.#comments.get(selectionId);
    if (comment === undefined) return false;
    this.#comments.delete(selectionId);
    this.#onRemove?.(comment);
    return true;
  }

  clear(): void {
    for (const selectionId of [...this.#comments.keys()]) this.remove(selectionId);
  }
}
