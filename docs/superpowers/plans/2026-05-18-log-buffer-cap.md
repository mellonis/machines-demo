# Log buffer + render cap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `MachineView.svelte`'s inline `$state<LogEntry[]>` + 4 helper functions with an extracted `LogStore` class that holds an unbounded non-reactive buffer and exposes a `setTimeout(_, 16)`-throttled, render-capped reactive view. Eliminates the multi-second UI freeze on large run traces and removes the `#40` band-aid that skipped per-step entries on truncated runs.

**Architecture:** `LogStore` (in `src/lib/logStore.svelte.ts`) owns a private `#buffer: LogEntry[]` (plain array) and a public `entries: LogEntry[]` (`$state`). Mutations (`report`, `appendBatch`, `reportSeparator`) push to the buffer synchronously, increment a `#version = $state(0)` counter, and schedule a single `setTimeout(flush, LOG_FLUSH_INTERVAL_MS)` if none is pending. On flush, `entries` is reassigned to `[overflowHeader?, ...buffer.slice(-LOG_RENDER_CAP)]`. `clear()` flushes synchronously and cancels any pending timer. `dispose()` cancels the timer at component unmount. `latest` is a `$derived` getter that walks the buffer from the tail (reactive via `#version`), skipping separators — used by mobile status. Per-MachineView instance (mirrors the existing `runner = new MachineRunner(...)` pattern).

**Tech Stack:** Svelte 5 (runes — `$state`, `$derived`), TypeScript 5.x, Vitest 2.x with `vi.useFakeTimers()`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-18-log-buffer-cap-design.md`

**Tracks:** [#45](https://github.com/mellonis/machines-demo/issues/45). Cross-references future settings panel [#65](https://github.com/mellonis/machines-demo/issues/65).

---

## File map

| File | Change |
|---|---|
| `src/lib/caps.ts` | **Modify** — add `LOG_RENDER_CAP = 5000` and `LOG_FLUSH_INTERVAL_MS = 16`. |
| `src/lib/log.ts` | **Modify** — extend `LogEntry` with `overflow?: boolean` and `hiddenCount?: number`. |
| `src/lib/logStore.svelte.ts` | **Create** — `LogStore` class (buffer + throttled view + cap + overflow synthesis + reactive `latest` + lifecycle). |
| `src/lib/logStore.test.ts` | **Create** — Vitest unit tests, 9 scenarios with `vi.useFakeTimers()`. |
| `src/components/Log.svelte` | **Modify** — render `entry.overflow` as a centered dim header (third branch in the existing `{#if}` block). |
| `src/components/MachineView.svelte` | **Modify** — replace `logEntries` + 4 helpers + `latestEntry $derived` with a `LogStore` instance; pass `log.entries` to `Log.svelte`; call `log.dispose()` in `onDestroy`; drop the `if (!res.truncated)` guards around per-step `appendBatch` calls. |
| `docs/execution-model.md` | **Modify** — extend §14 `<topic>` row with `logStore.test.ts` topics. |

---

## Verification model

Each task ends with one or more of these checks:

1. `npm run check` — `svelte-check` + `tsc --noEmit`. Must exit 0.
2. `npm run lint` — ESLint flat config. Must exit 0.
3. `npm test` — Vitest one-shot. After T4 lands the first test, every subsequent test-adding task expects the passing count to grow by 1; refactor tasks expect no test failures.
4. `npm run dev` smoke (manual, only at T13) — Run a Turing example that halts at ~30k steps; confirm the log fills without freezing and the overflow header reads `(N earlier entries hidden)` once the run has produced more than 5000 entries.

---

## Task 1: Extend §14 Scenario ID grammar in `execution-model.md`

**Files:**
- Modify: `docs/execution-model.md:470`

- [ ] **Step 1: Update the `<topic>` row**

In the table starting at `## 14. Scenario ID grammar`, find the row beginning with `| \`<topic>\` (R / C / E) |` (currently line 470). Replace the value cell to add a `logStore.test.ts` entry. The whole row becomes:

```markdown
| `<topic>` (R / C / E) | `machineRunner.test.ts`: `protocol`, `timer`, `pending`, `error`. `workerHelpers.test.ts`: `movement-code`, `commands`, `snapshot`, `phase-guard`, `step-arm`. `logStore.test.ts`: `buffer-append`, `cap-overflow`, `cap-boundary`, `separator-skip-empty`, `latest-skips-separator`, `latest-synchronous`, `clear`, `dispose`, `flush-coalesce`, `flush-no-pending-timer`. `Toolbar.test.ts`: `run-label`, `disabled`, `visibility`, `interval`, `callbacks`. `e2e/cold-start.spec.ts`: `cold-start`, `continue-from-step`, `stop-while-paused`. |
```

- [ ] **Step 2: Verify**

Run: `npm run check`
Expected: exit 0 (markdown file is not type-checked but `npm run check` shouldn't fail).

Run: `grep -c "logStore.test.ts" docs/execution-model.md`
Expected: `1`

- [ ] **Step 3: Commit**

```bash
git add docs/execution-model.md
git commit -m "docs: register logStore.test.ts topics in scenario ID grammar"
```

---

## Task 2: Add new caps to `src/lib/caps.ts`

**Files:**
- Modify: `src/lib/caps.ts`

- [ ] **Step 1: Append the two new constants**

Add to the end of the file:

```typescript
/** Render-view cap: `Log.svelte` only ever renders this many entries.
 *  Anything older lives in the LogStore's non-reactive buffer and is
 *  summarized by a synthetic overflow header. Bounds the DOM cost of a
 *  large-trace flush; configurable in the future via #65. */
export const LOG_RENDER_CAP = 5000;

/** Flush interval for the LogStore's buffer-to-view recompute. `report` /
 *  `appendBatch` push into the buffer synchronously but defer the reactive
 *  `entries` reassignment so N rapid calls within one window coalesce into
 *  one Svelte update / one auto-scroll layout. 16ms ≈ one frame — long
 *  enough to coalesce a bulk dump, short enough that step-by-step still
 *  feels live. */
export const LOG_FLUSH_INTERVAL_MS = 16;
```

- [ ] **Step 2: Verify**

Run: `npm run check`
Expected: exit 0.

Run: `npm run lint`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/caps.ts
git commit -m "caps: add LOG_RENDER_CAP and LOG_FLUSH_INTERVAL_MS"
```

---

## Task 3: Extend `LogEntry` type with overflow fields

**Files:**
- Modify: `src/lib/log.ts`

- [ ] **Step 1: Add the two optional fields**

In the `LogEntry` type definition (starts at line 11), add two new optional fields below `separator?`. The full type becomes:

```typescript
export type LogEntry = {
  /** Header line — also the source for the mobile-status mirror. */
  text: string;
  /** Tints the header. Ignored when `kind` is set so error/warn/ok keep
   * their semantic color regardless of the per-tape palette. */
  color?: string;
  /** Optional structured per-tape rows, rendered below the header. */
  rows?: LogRow[];
  kind?: LogKind;
  /** Renders as a horizontal divider instead of a text row. Used to visually
   * group log activity per Build/Step/Run session. */
  separator?: boolean;
  /** Synthetic header injected at the top of the render view when the
   *  non-reactive buffer holds more entries than `LOG_RENDER_CAP`. Never
   *  stored in the buffer; recomputed on every render-view flush. */
  overflow?: boolean;
  /** Companion to `overflow`: how many buffer entries are not in the view. */
  hiddenCount?: number;
};
```

- [ ] **Step 2: Verify**

Run: `npm run check`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/log.ts
git commit -m "log: extend LogEntry with overflow + hiddenCount"
```

---

## Task 4: Create `LogStore` skeleton + first failing test (R-logstore-buffer-append)

**Files:**
- Create: `src/lib/logStore.svelte.ts`
- Create: `src/lib/logStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/logStore.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LogStore } from './logStore.svelte.ts';
import { LOG_FLUSH_INTERVAL_MS, LOG_RENDER_CAP } from './caps.ts';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/logStore.test.ts`
Expected: FAIL with module-not-found for `./logStore.svelte.ts`.

- [ ] **Step 3: Create the minimal `LogStore` to pass the test**

Create `src/lib/logStore.svelte.ts`:

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/logStore.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Verify**

Run: `npm run check`
Expected: exit 0.

Run: `npm run lint`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/logStore.svelte.ts src/lib/logStore.test.ts
git commit -m "logStore: scaffold class with report() + timer flush (R-logstore-buffer-append)"
```

---

## Task 5: Add cap-overflow test (R-logstore-cap-overflow)

**Files:**
- Modify: `src/lib/logStore.test.ts`

- [ ] **Step 1: Write the failing test**

Append a new `describe` block inside the outer `describe('LogStore', …)`:

```typescript
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
```

Also import `type LogEntry` at the top:

```typescript
import type { LogEntry } from './log.ts';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/logStore.test.ts`
Expected: FAIL with `log.appendBatch is not a function`.

- [ ] **Step 3: Add `appendBatch` to `LogStore`**

In `src/lib/logStore.svelte.ts`, add the method after `report`:

```typescript
appendBatch(items: LogEntry[]): void {
  if (items.length === 0) return;
  // Avoid `this.#buffer.push(...items)` — call-stack limit kicks in at
  // ~100k arg-count on most engines, and post-cap-removal a single Run
  // can carry up to MAX_STEPS (100k) commands.
  for (const item of items) this.#buffer.push(item);
  this.#version++;
  this.#scheduleFlush();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/logStore.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/logStore.svelte.ts src/lib/logStore.test.ts
git commit -m "logStore: appendBatch + overflow header synthesis (R-logstore-cap-overflow)"
```

---

## Task 6: Add cap-boundary test (R-logstore-cap-boundary)

**Files:**
- Modify: `src/lib/logStore.test.ts`

- [ ] **Step 1: Write the failing test**

Inside the existing `describe('cap', …)` block, add a second `it`:

```typescript
it('R-logstore-cap-boundary: exactly CAP → no header; CAP+1 → header hiddenCount=1', () => {
  const a = new LogStore();
  a.appendBatch(Array.from({ length: LOG_RENDER_CAP }, (_, i) => ({ text: `${i}` })));
  vi.advanceTimersByTime(LOG_FLUSH_INTERVAL_MS);

  expect(a.entries.length).toBe(LOG_RENDER_CAP);
  expect(a.entries[0]).toEqual({ text: '0' });  // no overflow header

  const b = new LogStore();
  b.appendBatch(Array.from({ length: LOG_RENDER_CAP + 1 }, (_, i) => ({ text: `${i}` })));
  vi.advanceTimersByTime(LOG_FLUSH_INTERVAL_MS);

  expect(b.entries.length).toBe(LOG_RENDER_CAP + 1);
  expect(b.entries[0]).toEqual({ text: '', overflow: true, hiddenCount: 1 });
});
```

- [ ] **Step 2: Run test to verify it passes already**

Run: `npm test -- src/lib/logStore.test.ts`
Expected: PASS (3 tests). The existing `#flush` already handles the boundary correctly (`overflow > 0` check). This test guards against future regressions to that condition.

- [ ] **Step 3: Commit**

```bash
git add src/lib/logStore.test.ts
git commit -m "logStore: pin cap-boundary behavior (R-logstore-cap-boundary)"
```

---

## Task 7: Add `reportSeparator` + skip-empty test (R-logstore-separator-skip-empty)

**Files:**
- Modify: `src/lib/logStore.svelte.ts`
- Modify: `src/lib/logStore.test.ts`

- [ ] **Step 1: Write the failing test**

Append a new `describe` block to `logStore.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/logStore.test.ts`
Expected: FAIL with `log.reportSeparator is not a function`.

- [ ] **Step 3: Add `reportSeparator` to `LogStore`**

In `src/lib/logStore.svelte.ts`, add after `appendBatch`:

```typescript
reportSeparator(): void {
  if (this.#buffer.length === 0) return;
  this.#buffer.push({ text: '', separator: true });
  this.#version++;
  this.#scheduleFlush();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/logStore.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/logStore.svelte.ts src/lib/logStore.test.ts
git commit -m "logStore: reportSeparator + skip-empty guard (R-logstore-separator-skip-empty)"
```

---

## Task 8: Add `latest` getter + two tests (R-logstore-latest-skips-separator, R-logstore-latest-synchronous)

**Files:**
- Modify: `src/lib/logStore.svelte.ts`
- Modify: `src/lib/logStore.test.ts`

- [ ] **Step 1: Write the failing tests**

Append a new `describe` block:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/logStore.test.ts`
Expected: FAIL with `log.latest` undefined.

- [ ] **Step 3: Add `latest` getter to `LogStore`**

In `src/lib/logStore.svelte.ts`, add inside the class — as a `$derived` getter pattern using the `#version` counter. Place it after the `entries` field and before `report`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/logStore.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/logStore.svelte.ts src/lib/logStore.test.ts
git commit -m "logStore: latest getter, reactive via #version (R-logstore-latest-*)"
```

---

## Task 9: Add `clear` + test (R-logstore-clear)

**Files:**
- Modify: `src/lib/logStore.svelte.ts`
- Modify: `src/lib/logStore.test.ts`

- [ ] **Step 1: Write the failing test**

Append a new `describe` block:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/logStore.test.ts`
Expected: FAIL with `log.clear is not a function`.

- [ ] **Step 3: Add `clear` method to `LogStore`**

In `src/lib/logStore.svelte.ts`, add after `reportSeparator`:

```typescript
clear(): void {
  this.#buffer.length = 0;
  if (this.#flushTimer !== null) {
    clearTimeout(this.#flushTimer);
    this.#flushTimer = null;
  }
  this.#version++;
  this.entries = [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/logStore.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/logStore.svelte.ts src/lib/logStore.test.ts
git commit -m "logStore: clear() (synchronous flush + timer cancel) (R-logstore-clear)"
```

---

## Task 10: Add `dispose` + flush-no-pending-timer test (R-logstore-flush-no-pending-timer)

**Files:**
- Modify: `src/lib/logStore.svelte.ts`
- Modify: `src/lib/logStore.test.ts`

- [ ] **Step 1: Write the failing test**

Append a new `describe` block:

```typescript
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/logStore.test.ts`
Expected: FAIL — the first test should already pass (existing `#scheduleFlush` clears the timer on fire), the second fails on `log.dispose is not a function`.

- [ ] **Step 3: Add `dispose` to `LogStore`**

In `src/lib/logStore.svelte.ts`, add after `clear`:

```typescript
/** Cancels any pending flush so the timer doesn't outlive the owning
 *  component. Call from `onDestroy` in the consumer (MachineView). */
dispose(): void {
  if (this.#flushTimer !== null) {
    clearTimeout(this.#flushTimer);
    this.#flushTimer = null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/logStore.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/logStore.svelte.ts src/lib/logStore.test.ts
git commit -m "logStore: dispose() + flush-pending coalescing pin (R-logstore-flush-no-pending-timer)"
```

---

## Task 11: Add flush-coalesce test (R-logstore-flush-coalesce)

**Files:**
- Modify: `src/lib/logStore.test.ts`

- [ ] **Step 1: Write the failing test**

Append to the `describe('flush-pending', …)` block:

```typescript
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
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm test -- src/lib/logStore.test.ts`
Expected: PASS (10 tests). The coalescing behavior is already built into `#scheduleFlush` (early-return when `#flushTimer !== null`). This test pins it.

- [ ] **Step 3: Commit**

```bash
git add src/lib/logStore.test.ts
git commit -m "logStore: pin flush coalescing (R-logstore-flush-coalesce)"
```

---

## Task 12: Render overflow header in `Log.svelte`

**Files:**
- Modify: `src/components/Log.svelte`

- [ ] **Step 1: Add the overflow branch to the `{#each}`**

Replace the existing `{#if entry.separator} … {:else} … {/if}` (lines 27–50) with a three-branch conditional:

```svelte
{#each entries as entry, i (i)}
  {#if entry.separator}
    <hr class="sep" />
  {:else if entry.overflow}
    <div class="overflow" data-testid="log-overflow-header">
      ({entry.hiddenCount} earlier {entry.hiddenCount === 1 ? 'entry' : 'entries'} hidden)
    </div>
  {:else}
    <div
      class="line"
      class:error={entry.kind === 'error'}
      class:warn={entry.kind === 'warn'}
      class:ok={entry.kind === 'ok'}
      data-testid="log-line"
      data-kind={entry.kind ?? ''}
    >
      <div
        class="head"
        style={entry.color && !entry.kind ? `color: ${entry.color};` : undefined}
      >{entry.text}</div>
      {#if entry.rows && entry.rows.length > 0}
        {#each entry.rows as row, j (j)}
          <div class="row" style={row.color ? `color: ${row.color};` : undefined}>
            {row.text}
          </div>
        {/each}
      {/if}
    </div>
  {/if}
{/each}
```

- [ ] **Step 2: Add styles for `.overflow`**

In the `<style>` block, add after `.sep`:

```css
.overflow {
  text-align: center;
  font-style: italic;
  color: var(--muted);
  opacity: 0.7;
  padding: 6px 0;
  font-size: 11px;
}
```

- [ ] **Step 3: Verify**

Run: `npm run check`
Expected: exit 0.

Run: `npm run lint`
Expected: exit 0.

Run: `npm test`
Expected: PASS (no test regressions; the overflow rendering has no component tests yet).

- [ ] **Step 4: Commit**

```bash
git add src/components/Log.svelte
git commit -m "Log: render overflow header for capped views"
```

---

## Task 13: Wire `LogStore` into `MachineView.svelte`

**Files:**
- Modify: `src/components/MachineView.svelte`

This task replaces the inline log state + 4 helper functions with a `LogStore` instance, drops the `#40` band-aid `if (!res.truncated)` guards, and wires `log.dispose()` into `onDestroy`. The refactor is purely structural — call sites are 1:1 renames.

- [ ] **Step 1: Add the import**

In the import block (around line 7), add the LogStore import next to the existing log-types import:

```typescript
import type { LogEntry, LogKind } from '../lib/log.ts';
import { LogStore } from '../lib/logStore.svelte.ts';
```

- [ ] **Step 2: Replace `logEntries` state with a `LogStore` instance**

Find the line:

```typescript
let logEntries = $state<LogEntry[]>([]);
```

(at `MachineView.svelte:68`)

Replace it with:

```typescript
const log = new LogStore();
```

- [ ] **Step 3: Delete the 4 inline helpers**

Delete the entire block at `MachineView.svelte:205–231`:

```typescript
/* ───── log helpers ───── */

function report(textOrEntry: string | LogEntry, kind?: LogKind): void {
  const entry: LogEntry =
    typeof textOrEntry === 'string'
      ? { text: textOrEntry, kind }
      : kind
        ? { ...textOrEntry, kind }
        : textOrEntry;
  logEntries = [...logEntries, entry];
}

function appendBatch(items: LogEntry[]): void {
  if (items.length === 0) return;
  logEntries = [...logEntries, ...items];
}

// Visually divides log activity per session (Build / Step / Run). Skipped
// when the log is empty so we don't open with a stranded divider.
function reportSeparator(): void {
  if (logEntries.length === 0) return;
  logEntries = [...logEntries, { text: '', separator: true }];
}

function clearLog(): void {
  logEntries = [];
}
```

Replace with a single comment marker (for orientation):

```typescript
/* ───── log helpers ───── */
/* See LogStore (lib/logStore.svelte.ts) — methods live there. */
```

- [ ] **Step 4: Rewire every call site**

There are ~25 call sites total. Replace in this exact order (longer names first — replacing `report(` before `reportSeparator()` would corrupt the longer name's prefix):

| # | Old (verbatim) | New | Match strategy |
|---|---|---|---|
| 1 | `reportSeparator()` | `log.reportSeparator()` | literal full-token match |
| 2 | `appendBatch(` | `log.appendBatch(` | literal prefix match |
| 3 | `report(` | `log.report(` | literal prefix match — runs AFTER #1 so `reportSeparator(` (which becomes `log.reportSeparator(` after #1) is no longer present as bare `report(` |
| 4 | `clearLog` | (handled separately in step 6) | — |

After substitution, verify no bare callsites remain:

Run: `grep -nE '(^|[^.])\b(report|appendBatch|reportSeparator)\(' src/components/MachineView.svelte`
Expected: no matches (every callsite is now `log.<method>(`, which the leading `[^.]` boundary excludes).

`npm run check` will catch any miss as a deleted-symbol error.

- [ ] **Step 5: Update `latestEntry` to use `log.latest`**

Find at `MachineView.svelte:144–150`:

```typescript
// Skip separators — mobile status mirrors a meaningful message, not a divider.
const latestEntry = $derived.by(() => {
  for (let i = logEntries.length - 1; i >= 0; i--) {
    if (!logEntries[i].separator) return logEntries[i];
  }
  return null;
});
```

Replace with:

```typescript
// Mobile status mirrors the latest non-separator entry. Provided by LogStore;
// it walks the buffer (not the throttled view) so mobile stays in sync with
// `report()` calls without a 16ms timer lag.
const latestEntry = $derived(log.latest);
```

- [ ] **Step 6: Update the `Log` and `clearLog` callsites in markup**

Find at `MachineView.svelte:771`:

```svelte
<Log entries={logEntries} onClear={clearLog} />
```

Replace with:

```svelte
<Log entries={log.entries} onClear={() => log.clear()} />
```

- [ ] **Step 7: Drop the `#40` band-aid guards**

Find at `MachineView.svelte:482-487` (in the `doStep`/break-resume path):

```typescript
if (!res.truncated && res.commands.length > 0) {
  appendBatch(
    res.commands.map((commands, i) =>
      commandsEntry(commands, { stepNumber: res.startStep + i + 1 }, CARET_COLORS),
    ),
  );
}
```

Replace with (drop the `!res.truncated &&` guard; keep the empty-batch short-circuit):

```typescript
if (res.commands.length > 0) {
  log.appendBatch(
    res.commands.map((commands, i) =>
      commandsEntry(commands, { stepNumber: res.startStep + i + 1 }, CARET_COLORS),
    ),
  );
}
```

Find the same pattern at `MachineView.svelte:575-583` (in `doRun`):

```typescript
// Skip the per-step trace dump on truncated runs — at MAX_STEPS the
// payload is 100k entries and Svelte's reactive list freezes the page.
// Band-aid for #45 (proper log throttle/buffer split tracked there).
if (!res.truncated && res.commands.length > 0) {
  appendBatch(
    res.commands.map((commands, i) =>
      commandsEntry(commands, { stepNumber: res.startStep + i + 1 }, CARET_COLORS),
    ),
  );
}
```

Replace with:

```typescript
if (res.commands.length > 0) {
  log.appendBatch(
    res.commands.map((commands, i) =>
      commandsEntry(commands, { stepNumber: res.startStep + i + 1 }, CARET_COLORS),
    ),
  );
}
```

(The 3-line band-aid comment goes away with it — LogStore is now the documented solution.)

- [ ] **Step 8: Wire `log.dispose()` into `onDestroy`**

Find at `MachineView.svelte:743–745`:

```typescript
onDestroy(() => {
  runner.terminate();
});
```

Replace with:

```typescript
onDestroy(() => {
  runner.terminate();
  log.dispose();
});
```

- [ ] **Step 9: Drop the now-unused `LogEntry` / `LogKind` type imports if no longer referenced**

After the refactor, check whether `LogEntry` / `LogKind` are still referenced in `MachineView.svelte`:

Run: `grep -nE '\b(LogEntry|LogKind)\b' src/components/MachineView.svelte`

If no matches (other than the import line), remove the import:

```typescript
import type { LogEntry, LogKind } from '../lib/log.ts';
```

If `LogEntry` is still referenced (e.g., a callback signature), keep the import and adjust to only the types still in use.

- [ ] **Step 10: Verify**

Run: `npm run check`
Expected: exit 0.

Run: `npm run lint`
Expected: exit 0.

Run: `npm test`
Expected: PASS (10 LogStore tests + all pre-existing tests still passing).

- [ ] **Step 11: Manual smoke (dev server)**

Run: `npm run dev`

In the browser, on the Turing tab:
1. Click **Build** — log shows `loading… / loaded — ready` (no overflow header).
2. Click **Run** on the default example — log fills with per-step entries and a `halted after N` final line. Auto-scroll lands at the bottom.
3. Switch to the Post tab — log resets (fresh `LogStore` instance per MachineView).
4. Load any example that runs > 5000 steps (e.g., adapt the binary-numbers example to a longer input, or paste a `for (let i = 0; i < 6000; i++) yield …`-style loop). Click **Run**. Confirm:
   - UI does not freeze for multi-seconds.
   - `(N earlier entries hidden)` header appears at the top once the entry count exceeds 5000.
   - Scrolling up reveals the header; the rest of the log behaves as before.
5. Click **Clear** (eraser icon) — log empties immediately, no overflow header lingers.

Stop the dev server when satisfied.

- [ ] **Step 12: Commit**

```bash
git add src/components/MachineView.svelte
git commit -m "MachineView: wire LogStore, drop #40 truncate band-aid (closes #45)"
```

---

## Task 14: Final verification

**Files:**
- (no edits — verification only)

- [ ] **Step 1: Full check + lint + tests**

Run in parallel-ish (sequentially fine):

```bash
npm run check && npm run lint && npm test
```

Expected: all exit 0. Vitest reports the new 10 `LogStore` tests passing plus every pre-existing test.

- [ ] **Step 2: Verify spec coverage**

Spot-check against `docs/superpowers/specs/2026-05-18-log-buffer-cap-design.md`:

| Spec decision | Implemented in |
|---|---|
| Two-layer log (buffer + view) | T4 |
| Time-batched flush via `setTimeout(_, 16)` | T4 |
| Eviction policy: pure last-N | T5 |
| `LOG_RENDER_CAP = 5000` in `caps.ts` | T2 |
| Buffer exposure: none in this PR | (verified by absence) |
| Extract `lib/logStore.svelte.ts` as a class | T4 |
| `latest` reads from buffer, reactive via `#version` | T8 |
| Overflow header as `LogEntry` variant | T3 (type) + T4 (synthesis) + T12 (render) |

- [ ] **Step 3: Confirm no leftover band-aid references in code**

Run: `grep -nE 'Band-aid|res\.truncated && res\.commands' src/components/MachineView.svelte`
Expected: no matches.

- [ ] **Step 4: Confirm no lingering inline log helpers in MachineView**

Run: `grep -nE '^\s+(function (report|appendBatch|reportSeparator|clearLog)\b)' src/components/MachineView.svelte`
Expected: no matches.

- [ ] **Step 5: No commit needed** — verification only. Push the branch when ready.
