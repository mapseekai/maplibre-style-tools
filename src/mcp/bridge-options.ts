import type { BridgeServerHandle } from '../bridge/server.js';
import { BridgeTokenSchema } from '../bridge/protocol.js';

export interface ParsedBridgeOptions {
  host: string;
  port: number;
  token?: string;
  allowedOrigins: string[];
}

const invalid = (message: string): never => { throw new TypeError(message); };

const parsePort = (value: string): number => {
  if (!/^(?:0|[1-9][0-9]{0,4})$/u.test(value)) invalid('bridge port is invalid');
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port > 65_535) invalid('bridge port is invalid');
  return port;
};

const parseHost = (value: string): string => {
  const lowered = value.toLowerCase();
  const ipv4 = /^(127)\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u.exec(value);
  const loopbackV4 = ipv4 !== null
    && ipv4.slice(2).every((part) => Number(part) <= 255);
  if (!loopbackV4 && lowered !== 'localhost' && !lowered.endsWith('.localhost')) {
    invalid('bridge host must be loopback');
  }
  return value;
};

const parseOrigin = (value: string): string => {
  if (value.includes('*')) invalid('bridge origin is invalid');
  let parsed: URL;
  try { parsed = new URL(value); } catch { return invalid('bridge origin is invalid'); }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    || parsed.username !== '' || parsed.password !== ''
    || parsed.pathname !== '/' || parsed.search !== '' || parsed.hash !== ''
    || parsed.origin !== value) invalid('bridge origin is invalid');
  return value;
};

export function parseBridgeOptions(argv: readonly string[]): ParsedBridgeOptions {
  let host = '127.0.0.1';
  let port = 0;
  let token: string | undefined;
  let sawHost = false;
  let sawPort = false;
  let sawToken = false;
  const allowedOrigins: string[] = [];
  const origins = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (value === undefined) invalid(`missing value for ${name ?? 'bridge option'}`);
    index += 1;
    if (name === '--bridge-host' && !sawHost) {
      host = parseHost(value);
      sawHost = true;
    } else if (name === '--bridge-port' && !sawPort) {
      port = parsePort(value);
      sawPort = true;
    } else if (name === '--bridge-token' && !sawToken) {
      token = BridgeTokenSchema.parse(value);
      sawToken = true;
    } else if (name === '--bridge-origin') {
      const origin = parseOrigin(value);
      if (!origins.has(origin)) {
        origins.add(origin);
        allowedOrigins.push(origin);
      }
    } else {
      invalid(`unknown or repeated bridge option ${name ?? ''}`);
    }
  }
  return { host, port, token, allowedOrigins };
}

export function formatBridgeConnectionInfo(
  server: Pick<BridgeServerHandle, 'url' | 'generatedToken'>,
  allowedOrigins: readonly string[],
  mcpEndpoint:
    | { readonly mcpTransport: 'stdio' }
    | { readonly mcpTransport: 'http'; readonly mcpUrl: string },
): string {
  return JSON.stringify({
    event: 'bridge_listening',
    wsUrl: server.url,
    ...mcpEndpoint,
    ...(server.generatedToken === undefined ? {} : { token: server.generatedToken }),
    allowedOrigins: [...allowedOrigins],
  });
}
