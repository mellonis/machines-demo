import type { LogEntry, LogKind } from './log.ts';
import { LOG_FLUSH_INTERVAL_MS, LOG_RENDER_CAP } from './caps.ts';

export class LogStore {
  #buffer: LogEntry[] = [];
  #flushTimeoutId: ReturnType<typeof setTimeout> | null = null;
  #version = $state(0);

  entries = $state<LogEntry[]>([]);

  get latest(): LogEntry | null {
    // Read #version to make this getter reactive to mutations even though
    // #buffer itself isn't $state. Callers wrapped in $derived re-run when
    // #version changes.
    void this.#version;
    for (let i = this.#buffer.length - 1; i >= 0; i--) {
      if (!this.#buffer[i].separator) return this.#buffer[i];
    }
    return null;
  }

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

  reportSeparator(): void {
    if (this.#buffer.length === 0) return;
    this.#buffer.push({ text: '', separator: true });
    this.#version++;
    this.#scheduleFlush();
  }

  clear(): void {
    this.#buffer.length = 0;
    if (this.#flushTimeoutId !== null) {
      clearTimeout(this.#flushTimeoutId);
      this.#flushTimeoutId = null;
    }
    this.#version++;
    this.entries = [];
  }

  /** Cancels any pending flush so the timer doesn't outlive the owning
   *  component. Call from `onDestroy` in the consumer (MachineView). */
  dispose(): void {
    if (this.#flushTimeoutId !== null) {
      clearTimeout(this.#flushTimeoutId);
      this.#flushTimeoutId = null;
    }
  }

  #scheduleFlush(): void {
    if (this.#flushTimeoutId !== null) return;
    this.#flushTimeoutId = setTimeout(() => {
      this.#flushTimeoutId = null;
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
