import type { Map, StyleSpecification } from 'maplibre-gl';

type SetStyleInput = Parameters<Map['setStyle']>[0];
type SetStyleOptions = Parameters<Map['setStyle']>[1];

const style = {
  version: 8,
  sources: {},
  layers: [],
} satisfies StyleSpecification;

const styleInput: SetStyleInput = style;
const styleOptions: SetStyleOptions = { diff: true };
void styleInput;
void styleOptions;
