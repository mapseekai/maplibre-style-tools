import type {
  ConnectMapLibreBridgeOptions,
  MapLibreBridgeConnection,
} from 'maplibre-style-tools/bridge';

type FormControl = HTMLInputElement | HTMLButtonElement;
type Connector = (
  options: ConnectMapLibreBridgeOptions,
) => MapLibreBridgeConnection | void;

export interface ExampleConnectionForm {
  readonly element: HTMLFormElement;
  getByTestId(testId: string): FormControl;
}

const appendLabelledInput = (
  document: Pick<Document, 'createElement'>,
  form: HTMLFormElement,
  controls: Map<string, FormControl>,
  testId: string,
  labelText: string,
  type: 'text' | 'password',
  value = '',
): HTMLInputElement => {
  const label = document.createElement('label');
  label.textContent = labelText;
  const input = document.createElement('input');
  input.type = type;
  input.setAttribute('type', type);
  input.value = value;
  input.required = true;
  input.autocomplete = 'off';
  input.setAttribute('data-testid', testId);
  label.append(input);
  form.append(label);
  controls.set(testId, input);
  return input;
};

export function renderExampleConnectionForm(
  document: Pick<Document, 'createElement'>,
  connect: Connector,
): ExampleConnectionForm {
  const controls = new Map<string, FormControl>();
  const form = document.createElement('form');
  form.className = 'connection-form';
  const mapId = appendLabelledInput(
    document, form, controls, 'bridge-map-id', 'Map ID', 'text', 'demo-map',
  );
  const url = appendLabelledInput(
    document, form, controls, 'bridge-url', 'WebSocket URL', 'text',
  );
  const token = appendLabelledInput(
    document, form, controls, 'bridge-token', 'Bridge token', 'password',
  );
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Connect';
  button.setAttribute('data-testid', 'bridge-connect');
  controls.set('bridge-connect', button);
  form.append(button);

  button.addEventListener('click', () => {
    connect({
      mapId: mapId.value,
      url: url.value,
      token: token.value,
      capabilities: [
        'style.read', 'style.write', 'features.query', 'runtime.state',
        'assets.write', 'network.load',
      ],
      allowedResourceOrigins: [],
    });
    token.value = '';
  });

  return Object.freeze({
    element: form,
    getByTestId(testId: string): FormControl {
      const control = controls.get(testId);
      if (control === undefined) throw new Error(`Unknown example control: ${testId}`);
      return control;
    },
  });
}
