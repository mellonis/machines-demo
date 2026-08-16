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

    it('R-logstore-cap-setting: the settings logRenderCap override bounds the flushed view', () => {
      // Node env has no localStorage — install a minimal stub carrying the
      // override so the settings module (read-through at flush time) sees it.
      // 100 is the spec's min — any smaller override would (correctly) fall
      // back to the default.
      const store = new Map<string, string>([['machines-demo:settings:logRenderCap', '100']]);
      globalThis.localStorage = {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
        clear: () => store.clear(),
        key: () => null,
        get length() {
          return store.size;
        },
      } as Storage;
      try {
        const log = new LogStore();
        log.appendBatch(Array.from({ length: 103 }, (_, i) => ({ text: `entry ${i}` })));
        vi.advanceTimersByTime(LOG_FLUSH_INTERVAL_MS);

        expect(log.entries.length).toBe(101);
        expect(log.entries[0]).toEqual({ text: '', overflow: true, hiddenCount: 3 });
        expect(log.entries[1]).toEqual({ text: 'entry 3' });
        expect(log.entries[100]).toEqual({ text: 'entry 102' });
      } finally {
        Reflect.deleteProperty(globalThis, 'localStorage');
      }
    });

    it('R-logstore-cap-boundary: exactly CAP → no header; CAP+1 → header hiddenCount=1', () => {
      const a = new LogStore();
      a.appendBatch(Array.from({ length: LOG_RENDER_CAP }, (_, i) => ({ text: `${i}` })));
      vi.advanceTimersByTime(LOG_FLUSH_INTERVAL_MS);

      expect(a.entries.length).toBe(LOG_RENDER_CAP);
      expect(a.entries[0]).toEqual({ text: '0' }); // no overflow header

      const b = new LogStore();
      b.appendBatch(Array.from({ length: LOG_RENDER_CAP + 1 }, (_, i) => ({ text: `${i}` })));
      vi.advanceTimersByTime(LOG_FLUSH_INTERVAL_MS);

      expect(b.entries.length).toBe(LOG_RENDER_CAP + 1);
      expect(b.entries[0]).toEqual({ text: '', overflow: true, hiddenCount: 1 });
    });
  });

  describe('separator', () => {
    it('R-logstore-separator-skip-empty: reportSeparator on empty buffer is a no-op', () => {
      const log = new LogStore();
      log.reportSeparator();
      vi.advanceTimersByTime(LOG_FLUSH_INTERVAL_MS);

      expect(log.entries).toEqual([]);

      log.report('first');
      log.reportSeparator();
      vi.advanceTimersByTime(LOG_FLUSH_INTERVAL_MS);

      expect(log.entries).toEqual([
        { text: 'first' },
        { text: '', separator: true },
      ]);
    });
  });

  describe('latest', () => {
    it('R-logstore-latest-skips-separator: latest walks buffer from tail, skipping separators', () => {
      const log = new LogStore();
      expect(log.latest).toBe(null);

      log.report('first');
      log.reportSeparator();
      expect(log.latest).toEqual({ text: 'first' });

      log.report('second');
      expect(log.latest).toEqual({ text: 'second' });
    });

    it('R-logstore-latest-synchronous: latest reflects the freshly-pushed entry before the timer fires', () => {
      const log = new LogStore();
      log.report('synchronous-read');

      // No vi.advanceTimersByTime — view has not flushed yet.
      expect(log.entries).toEqual([]);
      expect(log.latest).toEqual({ text: 'synchronous-read' });
    });
  });

  describe('clear', () => {
    it('R-logstore-clear: empties both buffer and view, cancels pending timer, no header lingers', () => {
      const log = new LogStore();
      log.appendBatch(Array.from({ length: LOG_RENDER_CAP + 10 }, (_, i) => ({ text: `${i}` })));
      vi.advanceTimersByTime(LOG_FLUSH_INTERVAL_MS);

      expect(log.entries.length).toBe(LOG_RENDER_CAP + 1);

      log.clear();

      // View empties immediately (synchronous flush), buffer too.
      expect(log.entries).toEqual([]);
      expect(log.latest).toBe(null);

      // No stale timer to fire.
      vi.advanceTimersByTime(LOG_FLUSH_INTERVAL_MS);
      expect(log.entries).toEqual([]);

      // Fresh reports start clean — no overflow header carryover.
      log.report('post-clear');
      vi.advanceTimersByTime(LOG_FLUSH_INTERVAL_MS);
      expect(log.entries).toEqual([{ text: 'post-clear' }]);
    });
  });

  describe('flush-pending', () => {
    it('R-logstore-flush-no-pending-timer: after flush, next report schedules a fresh timer', () => {
      const log = new LogStore();

      log.report('first');
      vi.advanceTimersByTime(LOG_FLUSH_INTERVAL_MS);
      expect(log.entries).toEqual([{ text: 'first' }]);

      // Timer has fired and cleared itself. A second report should schedule
      // a new one, not silently skip because of a stale "pending" flag.
      log.report('second');
      expect(log.entries).toEqual([{ text: 'first' }]);  // not flushed yet

      vi.advanceTimersByTime(LOG_FLUSH_INTERVAL_MS);
      expect(log.entries).toEqual([{ text: 'first' }, { text: 'second' }]);
    });

    it('R-logstore-dispose: cancels pending timer; subsequent reports do not flush', () => {
      const log = new LogStore();
      log.report('before-dispose');

      // Pending flush.
      log.dispose();

      // Even after the interval, no flush fires.
      vi.advanceTimersByTime(LOG_FLUSH_INTERVAL_MS * 10);
      expect(log.entries).toEqual([]);
    });

    it('R-logstore-flush-coalesce: N reports within one window → one entries reassignment', () => {
      const log = new LogStore();

      // Track entries reassignments by snapshotting the reference. Since the
      // class reassigns `this.entries = [...]` on flush, the reference changes
      // exactly once per flush.
      const firstRef = log.entries;

      // 100 reports, all within the same fake-timer window (no advance yet).
      for (let i = 0; i < 100; i++) {
        log.report(`entry ${i}`);
      }

      // Still the original empty array — no flush has run.
      expect(log.entries).toBe(firstRef);

      vi.advanceTimersByTime(LOG_FLUSH_INTERVAL_MS);

      // After the single timer fires, entries has been reassigned exactly once.
      expect(log.entries).not.toBe(firstRef);
      expect(log.entries.length).toBe(100);
      expect(log.entries[0]).toEqual({ text: 'entry 0' });
      expect(log.entries[99]).toEqual({ text: 'entry 99' });

      // No further pending flushes — advancing time should not produce a new
      // reference.
      const afterFlushRef = log.entries;
      vi.advanceTimersByTime(LOG_FLUSH_INTERVAL_MS);
      expect(log.entries).toBe(afterFlushRef);
    });
  });
});
