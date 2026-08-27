import type { WebMcpInvocationEvent } from 'maplibre-style-tools/webmcp';

export interface ActivityEntry {
  readonly toolName: string;
  readonly action?: string;
  readonly phase: string;
  readonly message?: string;
  readonly code?: string;
  readonly durationMs?: number;
}

export function projectInvocationEvent(event: WebMcpInvocationEvent): ActivityEntry {
  return {
    toolName: event.toolName,
    phase: event.phase,
    ...(event.action === undefined ? {} : { action: event.action }),
    ...('message' in event ? { message: event.message } : {}),
    ...('code' in event ? { code: event.code } : {}),
    ...('durationMs' in event ? { durationMs: event.durationMs } : {}),
  };
}

const entryText = (entry: ActivityEntry): string => [
  entry.toolName,
  entry.action,
  entry.phase,
  entry.durationMs === undefined ? undefined : `${entry.durationMs} ms`,
  entry.code,
  entry.message,
].filter((value): value is string => value !== undefined).join(' · ');

export function createActivityLog(host: HTMLElement, options: { capacity: number }): {
  append(event: WebMcpInvocationEvent): void;
  clear(): void;
} {
  if (!Number.isInteger(options.capacity) || options.capacity < 1) {
    throw new RangeError('Activity log capacity must be a positive integer.');
  }

  const entries: ActivityEntry[] = [];
  const render = (): void => {
    host.replaceChildren(...entries.map((entry) => {
      const item = document.createElement('li');
      item.textContent = entryText(entry);
      return item;
    }));
  };

  return {
    append(event): void {
      entries.push(projectInvocationEvent(event));
      if (entries.length > options.capacity) entries.splice(0, entries.length - options.capacity);
      render();
    },
    clear(): void {
      entries.length = 0;
      render();
    },
  };
}
