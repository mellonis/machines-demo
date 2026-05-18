import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LogStore } from './logStore.svelte.ts';
import { LOG_FLUSH_INTERVAL_MS } from './caps.ts';

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
});
