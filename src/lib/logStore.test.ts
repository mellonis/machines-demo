import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LogStore } from './logStore.svelte.ts';
import { LOG_FLUSH_INTERVAL_MS, LOG_RENDER_CAP } from './caps.ts';
import type { LogEntry } from './log.ts';

describe('LogStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('buffer-append', () => {
    it('R-logstore-buffer-append: report pushes to buffer; view reflects it after timer fires', () => {
      const log = new LogStore();
      log.report('hello');

      // Buffer is updated synchronously; view waits for the timer.
      expect(log.entries).toEqual([]);

      vi.advanceTimersByTime(LOG_FLUSH_INTERVAL_MS);

      expect(log.entries).toEqual([{ text: 'hello' }]);
    });
  });

  describe('cap', () => {
    it('R-logstore-cap-overflow: appendBatch CAP+100 → view = header + last CAP, hiddenCount=100', () => {
      const log = new LogStore();
      const items: LogEntry[] = Array.from({ length: LOG_RENDER_CAP + 100 }, (_, i) => ({
        text: `entry ${i}`,
      }));
      log.appendBatch(items);

      vi.advanceTimersByTime(LOG_FLUSH_INTERVAL_MS);

      // Buffer holds all CAP + 100 entries.
      // View holds 1 header + last CAP items.
      expect(log.entries.length).toBe(LOG_RENDER_CAP + 1);
      expect(log.entries[0]).toEqual({ text: '', overflow: true, hiddenCount: 100 });
      expect(log.entries[1]).toEqual({ text: 'entry 100' });
      expect(log.entries[LOG_RENDER_CAP]).toEqual({ text: `entry ${LOG_RENDER_CAP + 99}` });
    });
  });
});
