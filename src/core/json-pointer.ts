export function escapeJsonPointerToken(token: string): string {
  return token.replaceAll('~', '~0').replaceAll('/', '~1');
}

export function toJsonPointer(tokens: readonly (string | number)[]): string {
  if (tokens.length === 0) return '';
  return `/${tokens.map((token) => escapeJsonPointerToken(String(token))).join('/')}`;
}
