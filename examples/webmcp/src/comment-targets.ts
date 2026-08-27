export interface FeatureReference {
  readonly layerId: string;
  readonly sourceId: string;
  readonly sourceLayer?: string;
  readonly featureId?: string | number;
  readonly lngLat: readonly [number, number];
  readonly properties: Readonly<Record<string, string | number | boolean | null>>;
}

type Scalar = string | number | boolean | null;

export type MapCommentTargetInput =
  | { readonly scope: 'feature'; readonly feature: FeatureReference & { readonly featureId: string | number } }
  | { readonly scope: 'property-class'; readonly feature: FeatureReference; readonly selector: { readonly property: string; readonly value: Scalar } }
  | { readonly scope: 'layer'; readonly feature: FeatureReference };

export type MapCommentTarget =
  | { readonly selectionId: string; readonly scope: 'feature'; readonly feature: FeatureReference & { readonly featureId: string | number } }
  | { readonly selectionId: string; readonly scope: 'property-class'; readonly feature: FeatureReference; readonly selector: { readonly property: string; readonly value: Scalar } }
  | { readonly selectionId: string; readonly scope: 'layer'; readonly feature: FeatureReference };

const MAX_PROPERTIES = 20;
const MAX_PROPERTY_NAME_LENGTH = 80;
const MAX_STRING_LENGTH = 240;

const isScalar = (value: unknown): value is Scalar => value === null
  || typeof value === 'string'
  || typeof value === 'boolean'
  || (typeof value === 'number' && Number.isFinite(value));

const boundedString = (value: string, length = MAX_STRING_LENGTH): string => value.slice(0, length);

const requiredIdentifier = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${name} must be a non-empty identifier.`);
  return boundedString(value.trim(), MAX_PROPERTY_NAME_LENGTH);
};

const stableFeatureId = (value: unknown): string | number | undefined => {
  if (typeof value === 'string') return value.trim() === '' ? undefined : boundedString(value);
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

const frozenFeature = (feature: FeatureReference): FeatureReference => {
  const properties: Record<string, Scalar> = {};
  for (const [name, value] of Object.entries(feature.properties ?? {})) {
    if (Object.keys(properties).length === MAX_PROPERTIES) break;
    if (!isScalar(value)) continue;
    const propertyName = boundedString(name, MAX_PROPERTY_NAME_LENGTH);
    if (propertyName === '') continue;
    properties[propertyName] = typeof value === 'string' ? boundedString(value) : value;
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

const frozenTarget = (selectionId: string, input: MapCommentTargetInput): MapCommentTarget => {
  const feature = frozenFeature(input.feature);
  if (input.scope === 'feature') {
    if (feature.featureId === undefined) throw new TypeError('Feature scope requires a stable feature ID.');
    return Object.freeze({
      selectionId,
      scope: 'feature' as const,
      feature: Object.freeze({ ...feature, featureId: feature.featureId }),
    });
  }
  if (input.scope === 'property-class') {
    const property = requiredIdentifier(input.selector?.property, 'Property selector');
    if (!isScalar(input.selector?.value)) throw new TypeError('Property selector value must be scalar.');
    return Object.freeze({
      selectionId,
      scope: 'property-class' as const,
      feature,
      selector: Object.freeze({
        property,
        value: typeof input.selector.value === 'string' ? boundedString(input.selector.value) : input.selector.value,
      }),
    });
  }
  return Object.freeze({ selectionId, scope: 'layer' as const, feature });
};

export class CommentTargetStore {
  readonly #capacity: number;
  readonly #idFactory: () => string;
  readonly #onRemove?: (target: MapCommentTarget) => void;
  readonly #targets = new Map<string, MapCommentTarget>();

  constructor(options: {
    capacity: number;
    idFactory(): string;
    onRemove?(target: MapCommentTarget): void;
  }) {
    if (!Number.isInteger(options.capacity) || options.capacity < 1 || options.capacity > MAX_PROPERTIES) {
      throw new RangeError(`Comment target capacity must be an integer between 1 and ${MAX_PROPERTIES}.`);
    }
    this.#capacity = options.capacity;
    this.#idFactory = options.idFactory;
    this.#onRemove = options.onRemove;
  }

  get size(): number {
    return this.#targets.size;
  }

  add(input: MapCommentTargetInput): MapCommentTarget {
    const selectionId = requiredIdentifier(this.#idFactory(), 'Selection ID');
    if (this.#targets.has(selectionId)) throw new Error(`Comment target ID already exists: ${selectionId}`);
    const target = frozenTarget(selectionId, input);
    this.#targets.set(selectionId, target);
    while (this.#targets.size > this.#capacity) {
      const oldest = this.#targets.values().next().value as MapCommentTarget | undefined;
      if (oldest === undefined) break;
      this.remove(oldest.selectionId);
    }
    return target;
  }

  get(selectionId: string): MapCommentTarget | undefined {
    return this.#targets.get(selectionId);
  }

  remove(selectionId: string): boolean {
    const target = this.#targets.get(selectionId);
    if (target === undefined) return false;
    this.#targets.delete(selectionId);
    this.#onRemove?.(target);
    return true;
  }

  clear(): void {
    for (const selectionId of [...this.#targets.keys()]) this.remove(selectionId);
  }
}
