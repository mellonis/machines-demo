# Test infrastructure PR2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the remaining `machineRunner` test categories — timer behavior, pending-slot model, and error wrapping — as 16 new tests across three sibling `describe` blocks in `src/lib/machineRunner.test.ts`. PR2 of [#47](https://github.com/mellonis/machines-demo/issues/47).

**Architecture:** No production code changes. Append three new `describe` blocks (`timer`, `pending`, `error`) inside the existing outer `describe('MachineRunner')`. Timer block uses `vi.useFakeTimers()` per-test (via `beforeEach` / `afterEach`); pending and error blocks use real timers. Same `FakeWorker` + `makeFakeFactory()` harness from PR1.

**Tech Stack:** Vitest 4.x (`vi.useFakeTimers`, `vi.advanceTimersByTimeAsync`), TypeScript 5.x.

**Spec:** `docs/superpowers/specs/2026-05-09-test-infra-pr2-design.md`

---

## File map

| File | Change |
|---|---|
| `src/lib/machineRunner.test.ts` | **Modify** — extend imports (add `vi`, `beforeEach`, `afterEach`, `WORKER_TIMEOUT_MS`, `WorkerError`); append three sibling `describe` blocks. |

No other files modified. No new dependencies.

---

## Verification model

After each task:

1. `npm test` — Vitest one-shot. Total test count grows by the number added in the task (T1: +6 → 15 total; T2: +5 → 20; T3: +5 → 25).
2. `npm run check` — exits 0.
3. `npm run lint` — exits 0.

Final task (T4) re-runs all four checks plus `npm run build` and `npm run test:coverage`.

---

## Task 1: Append `describe('timer')` block

**Files:**
- Modify: `src/lib/machineRunner.test.ts`

- [ ] **Step 1: Update imports**

Replace the current import block at the top of `src/lib/machineRunner.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { MAX_STEPS } from './caps';
import { MachineRunner } from './machineRunner';
import { makeFakeFactory } from './testUtils';
```

with:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MAX_STEPS, WORKER_TIMEOUT_MS } from './caps';
import { MachineRunner, WorkerError } from './machineRunner';
import { makeFakeFactory } from './testUtils';
```

(Adds `vi`, `beforeEach`, `afterEach` from vitest; `WORKER_TIMEOUT_MS` from caps; `WorkerError` from machineRunner.)

- [ ] **Step 2: Append `describe('timer')` block**

After the closing `});` of the existing `describe('protocol shape', ...)` block (still inside the outer `describe('MachineRunner', ...)`), append:

```ts
  describe('timer', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('R-timer-build-timeout: build with no response rejects with timeout error and terminates worker', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      await vi.advanceTimersByTimeAsync(WORKER_TIMEOUT_MS);

      await expect(buildPromise).rejects.toThrow(
        `timeout after ${WORKER_TIMEOUT_MS}ms — worker terminated (likely infinite loop)`,
      );
      expect(current().terminated).toBe(true);
    });

    it('R-timer-step-timeout: step with no response rejects with timeout error and terminates worker', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false });
      await buildPromise;

      const stepPromise = runner.step();
      await vi.advanceTimersByTimeAsync(WORKER_TIMEOUT_MS);

      await expect(stepPromise).rejects.toThrow(/timeout after/);
      expect(current().terminated).toBe(true);
    });

    it('R-timer-run-timeout-no-paused: run with no paused/ran rejects with timeout error and terminates worker', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false });
      await buildPromise;

      const runPromise = runner.run({ debug: true, onPaused: () => {} });
      await vi.advanceTimersByTimeAsync(WORKER_TIMEOUT_MS);

      await expect(runPromise).rejects.toThrow(/timeout after/);
      expect(current().terminated).toBe(true);
    });

    it('R-timer-suspend-on-paused: paused clears the timer; advancing past WORKER_TIMEOUT_MS does not reject', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false });
      await buildPromise;

      const runPromise = runner.run({ debug: true, onPaused: () => {} });
      current().respond({
        type: 'paused',
        tapes: [],
        commands: [],
        stepsApplied: 1,
        state: 'q1',
        currentSymbols: ['a'],
        debugBreak: { before: true as const },
      });

      // Advance time well past the timeout — paused should have cleared it.
      await vi.advanceTimersByTimeAsync(WORKER_TIMEOUT_MS * 2);

      // Run should still be pending.
      let runSettled = false;
      void runPromise.then(
        () => { runSettled = true; },
        () => { runSettled = true; },
      );
      await Promise.resolve();
      expect(runSettled).toBe(false);

      // Settle cleanly so the test doesn't leak a pending Promise.
      current().respond({
        type: 'ran',
        tapes: [],
        truncated: false,
        commands: [],
        startStep: 0,
        stepsApplied: 1,
      });
      await runPromise;
    });

    it('R-timer-restart-on-resume: resume re-arms the timer; advancing past WORKER_TIMEOUT_MS rejects', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false });
      await buildPromise;

      const runPromise = runner.run({ debug: true, onPaused: () => {} });
      current().respond({
        type: 'paused',
        tapes: [],
        commands: [],
        stepsApplied: 1,
        state: 'q1',
        currentSymbols: ['a'],
        debugBreak: { before: true as const },
      });

      runner.resume(false);
      await vi.advanceTimersByTimeAsync(WORKER_TIMEOUT_MS);

      await expect(runPromise).rejects.toThrow(/timeout after/);
    });

    it('R-timer-cleared-on-ran: ran response clears the timer; subsequent time advance has no effect', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false });
      await buildPromise;

      const runPromise = runner.run();
      current().respond({
        type: 'ran',
        tapes: [],
        truncated: false,
        commands: [],
        startStep: 0,
        stepsApplied: 0,
      });
      await runPromise;

      // Advance time past WORKER_TIMEOUT_MS — should be a no-op since the timer was cleared on ran.
      await vi.advanceTimersByTimeAsync(WORKER_TIMEOUT_MS * 2);

      // If the timer had still been alive, it would have called terminate().
      expect(current().terminated).toBe(false);
    });
  });
```

- [ ] **Step 3: Run tests**

Run: `npm test`

Expected: 15 tests pass (PR1's 9 + PR2's 6 timer tests).

- [ ] **Step 4: Run check + lint**

Run: `npm run check && npm run lint`

Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/machineRunner.test.ts
git commit -m "test(machineRunner): timer category — 6 tests for per-segment WORKER_TIMEOUT_MS"
```

---

## Task 2: Append `describe('pending')` block

**Files:**
- Modify: `src/lib/machineRunner.test.ts`

- [ ] **Step 1: Append `describe('pending')` block**

After the closing `});` of the `describe('timer', ...)` block from T1, append:

```ts
  describe('pending', () => {
    it('R-pending-simple-overlap: build then step before built rejects step', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      await expect(runner.step()).rejects.toThrow('previous request still pending');

      // Settle the build.
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false });
      await buildPromise;
    });

    it('R-pending-run-overlap: run then run synchronously throws', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false });
      await buildPromise;

      const runPromise = runner.run();

      // run() is NOT async — overlap throws synchronously.
      expect(() => runner.run()).toThrow('previous request still pending');

      // Settle the first run.
      current().respond({
        type: 'ran',
        tapes: [],
        truncated: false,
        commands: [],
        startStep: 0,
        stepsApplied: 0,
      });
      await runPromise;
    });

    it('R-pending-simple-during-run: step during pending run rejects step', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false });
      await buildPromise;

      const runPromise = runner.run();
      await expect(runner.step()).rejects.toThrow('previous request still pending');

      // Settle.
      current().respond({
        type: 'ran',
        tapes: [],
        truncated: false,
        commands: [],
        startStep: 0,
        stepsApplied: 0,
      });
      await runPromise;
    });

    it('R-pending-rebuild-rejects-pending: second build rejects the first with "superseded by new worker"', async () => {
      const { factory, all } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const firstBuild = runner.build('// first');
      expect(all()).toHaveLength(1);

      const secondBuild = runner.build('// second');
      expect(all()).toHaveLength(2);

      await expect(firstBuild).rejects.toThrow('superseded by new worker');
      expect(all()[0].terminated).toBe(true);

      // Second build proceeds normally.
      all()[1].respond({ type: 'built', tapes: [], alphabets: [], halted: false });
      await secondBuild;
    });

    it('R-pending-terminate-rejects-all: terminate rejects pending run; then rejects pending build on a fresh build', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      // Pending run case.
      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false });
      await buildPromise;

      const runPromise = runner.run();
      runner.terminate();

      await expect(runPromise).rejects.toThrow('runner terminated');
      expect(current().terminated).toBe(true);

      // Pending build case (fresh build via spawnWorker, then terminate before built response).
      const buildAgain = runner.build('// user code');
      runner.terminate();

      await expect(buildAgain).rejects.toThrow('runner terminated');
    });
  });
```

- [ ] **Step 2: Run tests**

Run: `npm test`

Expected: 20 tests pass (15 from before + 5 pending tests).

- [ ] **Step 3: Run check + lint**

Run: `npm run check && npm run lint`

Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/machineRunner.test.ts
git commit -m "test(machineRunner): pending category — 5 tests for two-slot model + supersede"
```

---

## Task 3: Append `describe('error')` block

**Files:**
- Modify: `src/lib/machineRunner.test.ts`

- [ ] **Step 1: Append `describe('error')` block**

After the closing `});` of the `describe('pending', ...)` block from T2, append:

```ts
  describe('error', () => {
    it('R-error-wraps-as-worker-error: error response with tapes wraps as WorkerError', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      const tapes = [{ symbols: ['a', 'b'], position: 0 }];
      current().respond({ type: 'error', message: 'parse error', tapes });

      let caught: unknown;
      try {
        await buildPromise;
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(WorkerError);
      expect((caught as WorkerError).message).toBe('parse error');
      expect((caught as WorkerError).tapes).toEqual(tapes);
    });

    it('R-error-tapes-default-null: error response without tapes field → tapes is null (not undefined)', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      current().respond({ type: 'error', message: 'no edge for symbol' });

      let caught: unknown;
      try {
        await buildPromise;
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(WorkerError);
      expect((caught as WorkerError).tapes).toBeNull();
    });

    it('R-error-during-step: error response during pending step rejects step with WorkerError', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false });
      await buildPromise;

      const stepPromise = runner.step();
      current().respond({ type: 'error', message: 'mid-step error' });

      await expect(stepPromise).rejects.toBeInstanceOf(WorkerError);
    });

    it('R-error-during-run: error response during pending run rejects run with WorkerError; worker not terminated', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false });
      await buildPromise;

      const runPromise = runner.run();
      current().respond({ type: 'error', message: 'mid-run error' });

      await expect(runPromise).rejects.toBeInstanceOf(WorkerError);
      expect(current().terminated).toBe(false);
    });

    it('R-error-onerror-event: worker.onerror fires; pending request rejects with plain Error and "worker error:" prefix', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false });
      await buildPromise;

      const stepPromise = runner.step();
      current().errorEvent('worker crashed');

      let caught: unknown;
      try {
        await stepPromise;
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBeInstanceOf(WorkerError);
      expect((caught as Error).message).toMatch(/^worker error: worker crashed/);
    });
  });
```

- [ ] **Step 2: Run tests**

Run: `npm test`

Expected: 25 tests pass (20 from before + 5 error tests).

- [ ] **Step 3: Run check + lint**

Run: `npm run check && npm run lint`

Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/machineRunner.test.ts
git commit -m "test(machineRunner): error category — 5 tests for WorkerError wrapping + onerror"
```

---

## Task 4: Final verification

**Files:** none modified

- [ ] **Step 1: Type-check**

Run: `npm run check`

Expected: 0 errors, 0 warnings.

- [ ] **Step 2: Lint**

Run: `npm run lint`

Expected: exit 0.

- [ ] **Step 3: Build**

Run: `npm run build`

Expected: build succeeds; `dist/` produced.

- [ ] **Step 4: Run all tests**

Run: `npm test`

Expected:

```
 Test Files  1 passed (1)
      Tests  25 passed (25)
```

- [ ] **Step 5: Coverage check**

Run: `npm run test:coverage`

Expected: `src/lib/machineRunner.ts` shows ≥80% statement coverage (PR1 baseline was ~54%; PR2's 16 tests should push it well above 80%). No threshold enforced; this is informational. Capture the per-file coverage % in your report.

- [ ] **Step 6: Scenario-ID grep audit**

Run:

```bash
grep -oE '\b[SR]-[a-z-]+' src/lib/machineRunner.test.ts | sort -u
```

Expected: 26 unique IDs total (25 `R-` + 1 `S-`):

```
R-error-during-run
R-error-during-step
R-error-onerror-event
R-error-tapes-default-null
R-error-wraps-as-worker-error
R-pending-rebuild-rejects-pending
R-pending-run-overlap
R-pending-simple-during-run
R-pending-simple-overlap
R-pending-terminate-rejects-all
R-protocol-build
R-protocol-paused-then-ran
R-protocol-resume
R-protocol-run
R-protocol-run-defaults
R-protocol-set-debug
R-protocol-set-debug-no-worker
R-protocol-step
R-protocol-step-arming
R-timer-build-timeout
R-timer-cleared-on-ran
R-timer-restart-on-resume
R-timer-run-timeout-no-paused
R-timer-step-timeout
R-timer-suspend-on-paused
S-step-paused-off
```

If the count or list differs, investigate — likely a typo in one of the new test names.

- [ ] **Step 7: No fix commit if all checks pass**

If steps 1–6 reveal real issues (broken test, type error, lint fail), fix inline in `src/lib/machineRunner.test.ts` and amend the relevant task's commit. Don't create a "review-pass" commit.

If no fixes needed, T4 has no commit.

---

## Self-review

**Spec coverage.** Each spec section maps to tasks:

- §Decisions and §File map — captured in plan intro and the file map.
- §Test layout (sibling structure) — T1 sets the import block + first describe; T2/T3 append siblings.
- §`describe('timer')` 6 tests — T1.
- §`describe('pending')` 5 tests — T2.
- §`describe('error')` 5 tests — T3.
- §Out of scope — explicitly not in any task.
- §Self-review (5 verifications) — T4.

**Placeholder scan.** No "TBD", "TODO", or "implement later". Every code step shows the actual test code. Every command shows the expected output.

**Type / vocabulary consistency.** All tests use `MachineRunner`, `WorkerError`, `WORKER_TIMEOUT_MS`, `MAX_STEPS`, `FakeWorker` (via `makeFakeFactory`'s `current()` / `all()`), and the `vi.useFakeTimers` / `vi.advanceTimersByTimeAsync` Vitest API consistently. Scenario IDs match the spec design's `R-<topic>-<facet>` grammar.

**Branch hygiene.** All commits land on the existing `47-test-infra-pr2` branch (which already has the spec design commit `be92e95`). Do not commit to master.
