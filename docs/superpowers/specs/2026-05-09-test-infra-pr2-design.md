# Test infrastructure — PR2 (machineRunner timer / pending / error tests) — design

Tracks: [#47](https://github.com/mellonis/machines-demo/issues/47) (test infrastructure). PR2 of an expected 4-PR series. Builds on PR1 (merged in #55).

## Problem

PR1 landed the test harness (Vitest + `FakeWorker` + `makeFakeFactory`) plus 9 protocol-shape tests covering each worker request's wire shape. The remaining three `machineRunner` test categories from #47's scope — timer behavior, pending-slot model, error wrapping — are still uncovered. Coverage on `src/lib/machineRunner.ts` sits around 54% statements / 71% functions; the lines that fail are the ones PR2 covers (timer paths in `sendSimple` / `startRunTimer` / `stopRunTimer`, `rejectAll` invariants, `onMessage`'s error branch, `onWorkerError`).

PR2 closes those gaps. No production refactor — the runner's surface stays exactly as PR1 left it.

## Decisions

- **Scope: `machineRunner` test categories only.** Worker-side helper extraction (a separate concern, requires designing what counts as a "pure helper" inside `machineWorker.ts`) is deferred to PR3. Component tests are PR4. Playwright E2E is PR5.
- **Test layout: append three sibling `describe` blocks** to `src/lib/machineRunner.test.ts`. Same file, same `describe('MachineRunner')` outer block, no new files.
- **Timer mocking: `vi.useFakeTimers()` per-test in the timer block.** Wrapped in `beforeEach` / `afterEach` of `describe('timer')` so a failure mid-test doesn't leak fake timers into subsequent describe blocks. Other blocks stay on real timers (real timers don't fire because none of those tests wait long enough for `WORKER_TIMEOUT_MS`).
- **Use `vi.advanceTimersByTimeAsync`** (the `Async` variant), not `vi.advanceTimersByTime`. The `Async` variant flushes pending Promise microtasks, which the runner's timeout-callback rejection chain depends on.
- **Preserve the runner's async/sync asymmetry.** `runner.build(...)` and `.step()` are `async` (synchronous throws become rejections); `runner.run(...)` is **not** `async` and synchronously throws on overlap. Tests use the appropriate `.rejects.toThrow(...)` vs `() => runner.run(...).toThrow(...)` matcher per call. Production-side fix is out of scope.
- **Plain `Error` for `onerror` rejections, `WorkerError` for `error` responses.** The runner distinguishes these intentionally — `onerror` is a Worker-environment event (e.g., script-level crash), the `error` response is in-protocol. Tests verify both shapes match the runner's existing distinction.
- **Scenario IDs all `R-`-prefixed.** No `S-` IDs — these are runner-internal mechanics with no UI counterpart. Format `R-<topic>-<facet>` per the §14 grammar in `docs/execution-model.md`.

## File map

| File | Change |
|---|---|
| `src/lib/machineRunner.test.ts` | **Modify** — append three `describe` blocks (`timer`, `pending`, `error`) inside the existing outer `describe('MachineRunner')`. ~16 tests, ~250 added lines. |

No other files modified.

## Test layout (sibling structure)

```ts
describe('MachineRunner', () => {
  describe('protocol shape', () => { /* PR1 — 9 tests, untouched */ });

  describe('timer', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });
    // 6 tests
  });

  describe('pending', () => {
    // real timers; 5 tests
  });

  describe('error', () => {
    // real timers; 5 tests
  });
});
```

Imports updated at the top of the file:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MAX_STEPS, WORKER_TIMEOUT_MS } from './caps';
import { MachineRunner, WorkerError } from './machineRunner';
import { makeFakeFactory } from './testUtils';
```

(Adds `vi`, `beforeEach`, `afterEach` from `vitest`; adds `WORKER_TIMEOUT_MS` from `caps`; adds `WorkerError` from `machineRunner`. The existing PR1 imports stay.)

## `describe('timer')` — 6 tests

Each test follows the shape: `setup → exercise → advance time → assert`.

1. **`R-timer-build-timeout`** — `runner.build(...)`; `await vi.advanceTimersByTimeAsync(WORKER_TIMEOUT_MS)`; assert build Promise rejects with `'timeout after 5000ms — worker terminated (likely infinite loop)'` and `current().terminated === true`.
2. **`R-timer-step-timeout`** — successful build, then `runner.step()`; advance time; assert step Promise rejects with the same message; worker terminated.
3. **`R-timer-run-timeout-no-paused`** — successful build, then `runner.run({ debug: true, onPaused })`; no `paused` arrives; advance time; assert run rejects with timeout message; worker terminated.
4. **`R-timer-suspend-on-paused`** — successful build, `runner.run(...)`; fake responds with `paused`; advance time **past** `WORKER_TIMEOUT_MS`; assert run Promise still pending (microtask probe); settle with a `ran` response; assert run resolved cleanly. Verifies `stopRunTimer` cleared the timeout.
5. **`R-timer-restart-on-resume`** — paused (as in test 4), then `runner.resume(false)`; no further response; advance time past `WORKER_TIMEOUT_MS`; assert run Promise rejects with timeout. Confirms `startRunTimer` re-armed the timeout for the resumed segment.
6. **`R-timer-cleared-on-ran`** — successful build, `runner.run(...)`; fake responds with `ran` immediately; advance time well past `WORKER_TIMEOUT_MS`; assert run already resolved, no spurious second rejection. Verifies the `clearTimeout` path on the success branch of `onMessage`.

The microtask-probe pattern (used in tests 4 and 6) follows PR1's resume test:

```ts
let runSettled = false;
void runPromise.then(() => { runSettled = true; }, () => { runSettled = true; });
await Promise.resolve();
expect(runSettled).toBe(false);  // or true, depending on the assertion
```

## `describe('pending')` — 5 tests

Real timers. Tests assert how the runner enforces its two-slot pending model.

**Async/sync asymmetry note (preserved in tests):**

- `runner.build(...)` and `.step()` are async — overlap throws become rejections; assert via `await expect(promise).rejects.toThrow(...)`.
- `runner.run(...)` is sync (returns a Promise but throws synchronously on overlap); assert via `expect(() => runner.run(...)).toThrow(...)`.

Tests:

1. **`R-pending-simple-overlap`** — `runner.build(...)` (no response yet), then `runner.step()`. Assert step rejects with `'previous request still pending'`. Settle the build cleanly with a `built` response so it doesn't leak into the next test.
2. **`R-pending-run-overlap`** — `runner.run(...)` (no response), then `runner.run(...)` again. Assert second call **synchronously throws** `'previous request still pending'`. Settle the first run cleanly.
3. **`R-pending-simple-during-run`** — `runner.run(...)` (no response), then `runner.step()`. Assert step rejects (same message). Settle the run.
4. **`R-pending-rebuild-rejects-pending`** — `runner.build(code1)` (no response), then `runner.build(code2)`. Assert: first build's Promise rejects with `'superseded by new worker'`; `all()[0].terminated === true`; `all()[1]` exists and is fresh. Settle the second build.
5. **`R-pending-terminate-rejects-all`** — successful build; start a `runner.run(...)`; `runner.terminate()`. Assert: run Promise rejects with `'runner terminated'`; `current().terminated === true`. Then start a fresh build (forced to spawn a new worker via the supersede path), call `runner.terminate()` mid-build, assert that build also rejects. (One test exercises both pending slots in sequence.)

## `describe('error')` — 5 tests

Real timers. Tests assert error wrapping (worker → `WorkerError`), pending-slot routing, and the `onerror` event path.

1. **`R-error-wraps-as-worker-error`** — pending build; `current().respond({ type: 'error', message: 'parse error', tapes: [{ symbols: ['a', 'b'], position: 0 }] })`. Assert: build Promise rejects with a `WorkerError` instance (`err instanceof WorkerError`); `err.message === 'parse error'`; `err.tapes` deep-equals the payload's `tapes` array.
2. **`R-error-tapes-default-null`** — pending build; `current().respond({ type: 'error', message: 'no edge for symbol' })` (no `tapes` field). Assert: rejects with `WorkerError`; `err.tapes === null` (literally null, not `undefined`). Confirms the `data.tapes ?? null` defaulting.
3. **`R-error-during-step`** — successful build, then pending step; `current().respond({ type: 'error', ... })`. Assert: step Promise rejects with `WorkerError`. Verifies the `simplePending` branch of `onMessage`'s error handler.
4. **`R-error-during-run`** — successful build, then pending `runner.run(...)`; `current().respond({ type: 'error', ... })`. Assert: run Promise rejects with `WorkerError`; `current().terminated === false` (errors don't auto-terminate; that's a Stop/Take Control/supersede concern). Verifies the `runPending` branch.
5. **`R-error-onerror-event`** — successful build, pending `runner.step()`; `current().errorEvent('worker crashed')`. Assert: step Promise rejects with a **plain `Error`** (not a `WorkerError`); message starts with `'worker error: worker crashed'`. Verifies the `onWorkerError` path that calls `rejectAll(new Error(...))`. The plain-Error vs WorkerError distinction is intentional — `onerror` is a Worker-environment event, not an in-protocol error response.

## Out of scope

- **Worker-side helper tests** — PR3. Requires designing the helper extraction surface from `machineWorker.ts`.
- **Component tests** (Toolbar, MachineView) — PR4.
- **Playwright E2E** — PR5.
- **CI integration** (running `npm test` as a pre-build gate) — separate small PR after PR2 lands.
- **Coverage threshold enforcement** — defer until after PR2 lands the rest of `machineRunner` coverage; threshold can then be set realistically (~85%+).
- **Production-side fix for the `runner.run(...)` async/sync asymmetry** — preserving today's behavior in tests; refactor is out of scope.

## Self-review

After writing tests:

1. **Each PR2 `it()` name matches the `\bR-[a-z-]+: <text>` pattern.** All 16 PR2 tests are `R-`-prefixed (no `S-` IDs in PR2). After PR2:
   - Total `it()` count in the file: 9 (PR1) + 16 (PR2) = 25.
   - Total unique `R-` IDs: 9 (PR1) + 16 (PR2) = 25.
   - Total unique `S-` IDs: 1 (the lone `S-step-paused-off` from PR1's compound citation).
   - `grep -oE '\bR-[a-z-]+' src/lib/machineRunner.test.ts | sort -u | wc -l` should return 25.
2. **No production code changed.** `git diff master..HEAD --stat src/lib/machineRunner.ts src/lib/testUtils.ts` should show 0 changes (only `machineRunner.test.ts` modified).
3. **All tests pass.** `npm test` exits 0; total test count = 9 (PR1) + 16 (PR2) = 25 tests.
4. **Coverage rises.** `npm run test:coverage` reports `machineRunner.ts` at ≥80% statements (PR1 baseline ~54%).
5. **Fake timers don't leak.** `describe('pending')` and `describe('error')` tests run on real timers; if the `afterEach` reset fails, those tests may hang or behave oddly — verify by running just those blocks in isolation (`npm test -- -t 'pending'`).

Fix any issues inline before declaring done.
