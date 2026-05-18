# Log buffer + render cap for large run traces — design

Tracks: [#45](https://github.com/mellonis/machines-demo/issues/45). Replaces the one-line band-aid landed in [#40](https://github.com/mellonis/machines-demo/issues/40) (`if (!res.truncated)` around the `appendBatch` of per-step entries).

## Problem

`MachineView.svelte`'s log is a single `$state<LogEntry[]>` rendered by `Log.svelte` via `{#each entries as entry}`. A continuous `Run` halt response carries a `commands` array whose length equals `stepsApplied`. Truncated runs at `MAX_STEPS = 100_000` produce 100k commands; the existing band-aid skips the per-step dump in that case, but legitimate long-but-finite runs (10k–50k steps) still pass through `appendBatch` unbounded. Svelte materializes 100k+ DOM nodes in one tick — the main thread freezes for many seconds.

The fix needs to bound the DOM cost without losing the entries semantically: the user should still be told, honestly, that earlier entries existed.

## Decisions

- **Two-layer log: non-reactive buffer + reactive render view.** A plain `LogEntry[]` buffer holds every entry for the lifetime of the MachineView instance (cleared by `clear()`, dropped on tab switch). A `$state<LogEntry[]>` render view always equals `[overflowHeader?, ...buffer.slice(-LOG_RENDER_CAP)]`. Chosen over "cap-only, no buffer" because the user wants future scaffolding for settings panel / download UX without re-architecting; chosen over "scroll-to-load-older" because it adds infinite-scroll complexity for a per-step trace nobody skims.
- **Time-batched flush via `setTimeout(_, 16)`.** `report` / `appendBatch` push to the buffer immediately but do **not** reassign `entries`. Instead, they schedule a single `setTimeout(flush, LOG_FLUSH_INTERVAL_MS)` if none is pending; the timer absorbs all subsequent calls within the window. On flush: recompute the view from the buffer once, reassign `entries` once, which triggers Svelte's reactive flush + a single auto-scroll layout once. So N rapid `report` calls across separate async ticks → 1 DOM update / 1 scroll / 1 layout, instead of N. The cap still bounds the per-flush DOM cost; the timer batches the call rate. `LOG_FLUSH_INTERVAL_MS = 16` (≈ one frame) lives next to `LOG_RENDER_CAP` in `lib/caps.ts` — short enough that step-by-step still feels live, long enough to coalesce a bulk dump into a single paint. **Synchronous-flush escape hatch**: `clear()` flushes immediately (not via timer) so the log visually empties on click, and `clear()` also cancels any pending timer.
- **Eviction policy: pure last-N.** No separator preservation. Rationale: with cap=5000 and the band-aid covering 100k truncated runs, realistic overflow is "long-but-finite" (10k–50k); at those sizes Build/Step/Run separators sit at the *start* of a session's entries with the per-step trace immediately after — keeping early separators would render `Build 1 / Run 1 / [N hidden] / step 49998 / step 49999 / halted`, which is trivia, not actionable. Simple to implement and honest.
- **`LOG_RENDER_CAP = 5000` lives in `lib/caps.ts`.** Same home as `MAX_STEPS` / `WORKER_TIMEOUT_MS` / `VIEWPORT_WIDTH`. Future settings panel ([#65](https://github.com/mellonis/machines-demo/issues/65)) gets one place to read and one place to write.
- **Buffer exposure: none in this PR.** Future scaffolding only. No download button, no "view all" UI. The overflow header is the only signal that older entries exist. Keeps PR small; the future settings panel is the natural trigger for adding exposure.
- **Extract `lib/logStore.svelte.ts` as a class.** `MachineView.svelte` is already 955 lines; the buffer/cap/header logic is genuinely cohesive (three concepts sharing one invariant) and benefits from being unit-testable in isolation. A class instance per MachineView mirrors the existing per-instance pattern (`runner = new MachineRunner(...)`); module-scoped state would leak between Turing and Post tabs.
- **`latest` reads from the buffer (not the render view) and is reactive on every push.** Mobile status mirrors the most recent meaningful entry — and because the view is on a 16ms timer, reading from the view would mean mobile status lags up to a frame behind every report. Reading from the buffer keeps mobile status synchronous with `report()`. To make it reactive without exposing the whole buffer as `$state`, the class tracks a `#version = $state(0)` counter incremented on every mutation; the `latest` getter is `$derived` against that counter, then walks `#buffer` from the tail and skips `separator` entries. (No overflow check needed — overflow entries only ever appear in the render view, never in the buffer.)
- **Overflow header is a `LogEntry` variant, synthesized on each render-view recompute.** Adds `overflow?: boolean` and `hiddenCount?: number` to `LogEntry` in `lib/log.ts`. Not stored in the buffer — recomputed from `buffer.length - LOG_RENDER_CAP` each time the view is rebuilt. Renders as a centered, dim header in `Log.svelte` — same visual register as `<hr class="sep">`, not a log line.

## File map

| File | Change | Roughly |
|---|---|---|
| `src/lib/caps.ts` | **Modify** — add `LOG_RENDER_CAP = 5000` and `LOG_FLUSH_INTERVAL_MS = 16`. | +3 lines |
| `src/lib/log.ts` | **Modify** — extend `LogEntry` with `overflow?: boolean` and `hiddenCount?: number`. | +3 lines |
| `src/lib/logStore.svelte.ts` | **Create** — `LogStore` class: non-reactive `#buffer`, reactive `entries` ($state) flushed via `setTimeout(LOG_FLUSH_INTERVAL_MS)`, `#version = $state(0)` mutation counter, `latest` $derived getter walking the buffer; methods `report` / `appendBatch` / `reportSeparator` / `clear` (clear flushes synchronously); a `dispose()` for timer cleanup on MachineView unmount. | ~110 lines |
| `src/lib/logStore.test.ts` | **Create** — node-env Vitest suite, 9 test scenarios (see Test plan), uses `vi.useFakeTimers()`. | ~150 lines |
| `src/components/MachineView.svelte` | **Modify** — replace `logEntries` $state + 4 inline helpers with `const log = new LogStore()`; rewire callsites (`report` → `log.report`, `appendBatch` → `log.appendBatch`, `reportSeparator` → `log.reportSeparator`, `clearLog` → `log.clear`); drop the `latestEntry` $derived (use `log.latest` directly); pass `log.entries` to `Log.svelte`; call `log.dispose()` in an `$effect` cleanup so the pending flush timer doesn't outlive the component. Remove the band-aid `if (!res.truncated)` guards around the per-step `appendBatch` calls (cap makes them safe). | ~45 lines touched, ~30 lines deleted |
| `src/components/Log.svelte` | **Modify** — add a third branch in the `{#each}` for `entry.overflow`: centered, dim, italic line reading `(N earlier entries hidden)`, with `data-testid="log-overflow-header"`. | ~10 lines |
| `docs/execution-model.md` | **Modify** — extend §14 Scenario ID grammar's `<topic>` row to include `logStore.test.ts: buffer-append, cap, separator, latest, clear, flush` so the new test IDs sit inside the documented vocabulary. | +1 line |

## Test plan

New file `src/lib/logStore.test.ts`, node environment (no DOM), pure unit tests against the class. Scenario IDs use the existing `R-` prefix (runner / worker / helper internal scenarios per `docs/execution-model.md` §14) — `logStore.ts` is a lib helper, the same bucket `workerHelpers.test.ts` already lives in. No grammar prefix change is needed. Timer tests use Vitest's `vi.useFakeTimers()` + `vi.advanceTimersByTime(...)`.

| ID | What it verifies |
|---|---|
| `R-logstore-buffer-append` | After `report` and one timer flush, buffer and view both reflect the entry; no overflow header. |
| `R-logstore-cap-overflow` | `appendBatch` with `CAP + 100` items → buffer length `CAP + 100`, view length `CAP + 1` (synthetic header + last CAP), `view[0].overflow === true` with `hiddenCount === 100`. |
| `R-logstore-cap-boundary` | `appendBatch` with exactly `CAP` items → no overflow header (view length `CAP`); with `CAP + 1` → header with `hiddenCount === 1`. |
| `R-logstore-separator-skip-empty` | `reportSeparator` on empty buffer is a no-op (matches existing `reportSeparator` behavior). |
| `R-logstore-latest-skips-separator` | `latest` returns the last non-separator entry from the **buffer**, ignoring separators. |
| `R-logstore-latest-synchronous` | `latest` reads the freshly-pushed entry **before** any timer flush — proves it reads from the buffer, not the throttled view. |
| `R-logstore-clear` | `clear()` empties both buffer and view, cancels any pending timer, and the view reflects "empty" immediately (no waiting for the timer). |
| `R-logstore-flush-coalesce` | N `report` calls within one `LOG_FLUSH_INTERVAL_MS` window → buffer grows by N synchronously, but `entries` is reassigned **once** after the timer fires (count assignments via a getter-shim or `$inspect`). |
| `R-logstore-flush-no-pending-timer` | After a flush completes, the next `report` schedules a fresh timer (no stale-timer-not-pending bug); a second `report` while that fresh timer is pending coalesces. |

No new component tests for `Log.svelte` — the overflow-header branch is a visual addition with no interactive behavior. `MachineView.svelte` doesn't get new tests either: the helper-to-method rewrites are 1:1 renames with the same wire shape into the LogStore.

A Playwright smoke test of "Run a 50k-step example without freezing the UI" would be nice-to-have but is **out of scope** for this PR. The unit tests over `LogStore` already prove the cap math; perf-as-a-test belongs in a separate observability pass.

## Out of scope

- Download-as-text button or any other buffer exposure UI. Future PR, likely paired with the settings panel.
- Settings panel for `MAX_STEPS` / `WORKER_TIMEOUT_MS` / `LOG_RENDER_CAP` — tracked in [#65](https://github.com/mellonis/machines-demo/issues/65). This design just makes the cap easy to relocate when that lands.
- Virtualized list rendering of `Log.svelte`. With cap=5000 the DOM cost is already acceptable; virtualization adds scroll-position complexity for negligible gain.
- Search / filter UI inside the log.
- Sticky-bottom auto-scroll (skip scroll-to-bottom when user has scrolled up to read). Adjacent UX concern, separate PR.
- E2E perf assertion (50k-step run completes without freeze). Tracked separately if the cap math needs validation under a real browser.
