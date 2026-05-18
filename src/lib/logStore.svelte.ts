import type { LogEntry, LogKind } from './log.ts';
import { LOG_FLUSH_INTERVAL_MS, LOG_RENDER_CAP } from './caps.ts';

export class LogStore {
  #buffer: LogEntry[] = [];
  #flushTimer: ReturnType<typeof setTimeout> | null = null;
  #version = $state(0);

  entries = $state<LogEntry[]>([]);

  report(textOrEntry: string | LogEntry, kind?: LogKind): void {
    const entry: LogEntry =
      typeof textOrEntry === 'string'
        ? { text: textOrEntry, ...(kind ? { kind } : {}) }
        : kind
          ? { ...textOrEntry, kind }
          : textOrEntry;
    this.#buffer.push(entry);
    this.#version++;
    this.#scheduleFlush();
  }

  appendBatch(items: LogEntry[]): void {
    if (items.length === 0) return;
    // Avoid `this.#buffer.push(...items)` — call-stack limit kicks in at
    // ~100k arg-count on most engines, and post-cap-removal a single Run
    // can carry up to MAX_STEPS (100k) commands.
    for (const item of items) this.#buffer.push(item);
    this.#version++;
    this.#scheduleFlush();
  }

  #scheduleFlush(): void {
    if (this.#flushTimer !== null) return;
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = null;
      this.#flush();
    }, LOG_FLUSH_INTERVAL_MS);
  }

  #flush(): void {
    const overflow = this.#buffer.length - LOG_RENDER_CAP;
    if (overflow > 0) {
      const header: LogEntry = { text: '', overflow: true, hiddenCount: overflow };
      this.entries = [header, ...this.#buffer.slice(-LOG_RENDER_CAP)];
    } else {
      this.entries = [...this.#buffer];
    }
  }
}
