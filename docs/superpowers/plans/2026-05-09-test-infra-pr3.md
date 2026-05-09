# Test infrastructure PR3 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract 6 pure helpers from `src/lib/machineWorker.ts` into a new `src/lib/workerHelpers.ts`, write 16 unit tests for them, and refactor the worker to import them. PR3 of [#47](https://github.com/mellonis/machines-demo/issues/47).

**Architecture:** Helpers (`movementCode`, `commandsFromYield`, `snapshotTapes`, `snapshotAlphabets`, `expectPhase`, `armStepAfter`) get pulled out as parameter-driven pure functions and tested directly via Vitest. The worker imports them; module-state references like `tapes` and `phase` are passed as args at the call sites. The dual-site step-arming logic in the worker (cold-start + resume-with-step) collapses into single-line `armStepAfter(target).restore` calls. No wire-protocol change.

**Tech Stack:** Vitest 4.x, TypeScript 5.x, `@turing-machine-js/machine` (only `movementCode` references it).

**Spec:** `docs/superpowers/specs/2026-05-09-test-infra-pr3-design.md`

---

## File map

| File | Change |
|---|---|
| `src/lib/workerHelpers.ts` | **Create** — 6 pure helpers + types (`MachineYield`, `TapeLike`, `WorkerPhaseKind`, `DebugConfig`, `DebugTarget`). |
| `src/lib/workerHelpers.test.ts` | **Create** — Vitest suite, 16 tests across 5 `describe` blocks. |
| `src/lib/machineWorker.ts` | **Modify** — replace 6 inline implementations with imports; pass module-state at call sites; collapse 2 inline arming sites into `armStepAfter`. ~30 lines net reduction. |
| `docs/execution-model.md` | **Modify** — §14 grammar table's `<topic>` row gains the 5 new helper topics. ~1 line. |

---

## Verification model

After each test task: `npm run check && npm run lint && npm test` — all exit 0; test count grows by the number added. After T7 (worker refactor): also run all 25 prior tests to confirm no regression. T9 final pass adds `npm run build` and `npm run test:coverage`.

---

## Task 1: Create `src/lib/workerHelpers.ts`

**Files:**
- Create: `src/lib/workerHelpers.ts`

- [ ] **Step 1: Write the helper module**

Create `src/lib/workerHelpers.ts` with the exact content below:

```ts
import * as turing from '@turing-machine-js/machine';
import type { Command, Movement, TapeSnapshot } from './types';

// --- Movement / command derivation ---

/** Maps a turing.movements.{left,right,stay} symbol to wire format 'L'|'R'|'S'. */
export function movementCode(m: symbol): Movement {
  if (m === turing.movements.left) return 'L';
  if (m === turing.movements.right) return 'R';
  return 'S';
}

export type MachineYield = {
  movements: symbol[];
  currentSymbols: string[];
  nextSymbols: string[];
};

/** Per-tape Command derivation. `symbol === null` means "no write" (resolved
 *  symbol matched the existing one). */
export function commandsFromYield(y: MachineYield): Command[] {
  return y.movements.map((mv, i) => {
    const movement = movementCode(mv);
    const written = y.nextSymbols[i];
    const before = y.currentSymbols[i];
    return { movement, symbol: written === before ? null : written };
  });
}

// --- Tape / alphabet snapshots ---

export type TapeLike = {
  symbols: string[];
  position: number;
  alphabet: { symbols: string[] };
};

/** Defensive-copies each tape's symbols + position into a wire-format snapshot. */
export function snapshotTapes(tapes: readonly TapeLike[]): TapeSnapshot[] {
  return tapes.map((t) => ({
    symbols: [...t.symbols],
    position: t.position,
  }));
}

/** Defensive-copies each tape's alphabet symbols. */
export function snapshotAlphabets(tapes: readonly TapeLike[]): string[][] {
  return tapes.map((t) => [...t.alphabet.symbols]);
}

// --- Phase guard ---

export type WorkerPhaseKind = 'idle' | 'built' | 'running' | 'paused';

/** Throws if `currentKind` is not in `allowed`. Defense-in-depth against
 *  out-of-order requests (e.g. step before build). */
export function expectPhase(currentKind: WorkerPhaseKind, allowed: WorkerPhaseKind[]): void {
  if (!allowed.includes(currentKind)) {
    throw new Error(`worker phase ${currentKind}, expected ${allowed.join('|')}`);
  }
}

// --- Step trick arming ---

export type DebugConfig = { before?: unknown; after?: unknown } | null;
export type DebugTarget = { debug: DebugConfig };

/** Sets `target.debug.after = true` while preserving any user-authored `.before`.
 *  Returns a `restore` function that reverts to the original `target.debug`
 *  (by reference, so a complex original config is restored exactly). */
export function armStepAfter(target: DebugTarget): { restore: () => void } {
  const original = target.debug;
  const preservedBefore = original?.before;
  const newDebug: { before?: unknown; after?: unknown } = { after: true };
  if (preservedBefore !== undefined) newDebug.before = preservedBefore;
  target.debug = newDebug;
  return {
    restore: () => {
      target.debug = original;
    },
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npm run check`

Expected: 0 errors, 0 warnings. (The new module is dead code at this point — nothing imports it yet — but `svelte-check` should typecheck it cleanly.)

- [ ] **Step 3: Verify lint passes**

Run: `npm run lint`

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/workerHelpers.ts
git commit -m "feat(workerHelpers): extract pure helpers from machineWorker (movementCode, commandsFromYield, snapshot*, expectPhase, armStepAfter)"
```

---

## Task 2: Create `workerHelpers.test.ts` with `movement-code` topic

**Files:**
- Create: `src/lib/workerHelpers.test.ts`

- [ ] **Step 1: Write the test file with the first test**

Create `src/lib/workerHelpers.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import * as turing from '@turing-machine-js/machine';
import {
  movementCode,
  commandsFromYield,
  snapshotTapes,
  snapshotAlphabets,
  expectPhase,
  armStepAfter,
  type MachineYield,
  type DebugTarget,
  type TapeLike,
} from './workerHelpers';

describe('workerHelpers', () => {
  describe('movement-code', () => {
    it('R-movement-code-mappings: maps left/right/stay symbols to L/R/S', () => {
      expect(movementCode(turing.movements.left)).toBe('L');
      expect(movementCode(turing.movements.right)).toBe('R');
      expect(movementCode(turing.movements.stay)).toBe('S');
    });
  });
});
```

(Imports include the helpers and types that future test tasks will use; importing them now keeps the import block stable across tasks. ESLint may not yet flag the unused-import warnings since they'll be used by T3-T6.)

- [ ] **Step 2: Run tests**

Run: `npm test`

Expected: 26 tests pass (25 from PR1+PR2 + 1 movement-code test).

- [ ] **Step 3: Run check + lint**

Run: `npm run check && npm run lint`

Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/workerHelpers.test.ts
git commit -m "test(workerHelpers): movement-code topic — 1 table-driven test"
```

---

## Task 3: Append `commands` topic — 4 tests

**Files:**
- Modify: `src/lib/workerHelpers.test.ts`

- [ ] **Step 1: Append the `commands` describe block**

Append inside the outer `describe('workerHelpers', ...)`, after the closing `});` of `describe('movement-code', ...)`:

```ts
  describe('commands', () => {
    it('R-commands-keep: yields { symbol: null } when written equals current', () => {
      const yieldVal: MachineYield = {
        movements: [turing.movements.right],
        currentSymbols: ['a'],
        nextSymbols: ['a'],
      };
      expect(commandsFromYield(yieldVal)).toEqual([{ movement: 'R', symbol: null }]);
    });

    it('R-commands-write: yields { symbol: written } when written differs from current', () => {
      const yieldVal: MachineYield = {
        movements: [turing.movements.left],
        currentSymbols: ['a'],
        nextSymbols: ['b'],
      };
      expect(commandsFromYield(yieldVal)).toEqual([{ movement: 'L', symbol: 'b' }]);
    });

    it('R-commands-multi-tape: returns one command per tape with matching positions', () => {
      const yieldVal: MachineYield = {
        movements: [turing.movements.left, turing.movements.right, turing.movements.stay],
        currentSymbols: ['a', 'b', 'c'],
        nextSymbols: ['x', 'y', 'z'],
      };
      expect(commandsFromYield(yieldVal)).toEqual([
        { movement: 'L', symbol: 'x' },
        { movement: 'R', symbol: 'y' },
        { movement: 'S', symbol: 'z' },
      ]);
    });

    it('R-commands-mixed: per-tape mix of keep and write resolves correctly', () => {
      const yieldVal: MachineYield = {
        movements: [turing.movements.right, turing.movements.stay, turing.movements.left],
        currentSymbols: ['a', 'b', 'c'],
        nextSymbols: ['a', 'B', 'c'], // tape 0 keeps, tape 1 writes 'B', tape 2 keeps
      };
      expect(commandsFromYield(yieldVal)).toEqual([
        { movement: 'R', symbol: null },
        { movement: 'S', symbol: 'B' },
        { movement: 'L', symbol: null },
      ]);
    });
  });
```

- [ ] **Step 2: Run tests**

Run: `npm test`

Expected: 30 tests pass.

- [ ] **Step 3: Run check + lint**

Run: `npm run check && npm run lint`

Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/workerHelpers.test.ts
git commit -m "test(workerHelpers): commands topic — 4 tests for keep/write/multi-tape/mixed"
```

---

## Task 4: Append `snapshot` topic — 4 tests

**Files:**
- Modify: `src/lib/workerHelpers.test.ts`

- [ ] **Step 1: Append the `snapshot` describe block**

Append after the `describe('commands', ...)` closing `});`:

```ts
  describe('snapshot', () => {
    it('R-snapshot-tapes-clones-symbols: returned symbols array is a defensive copy (not aliased)', () => {
      const tape: TapeLike = {
        symbols: ['a', 'b', 'c'],
        position: 1,
        alphabet: { symbols: [' ', 'a', 'b', 'c'] },
      };
      const snap = snapshotTapes([tape]);

      expect(snap).toHaveLength(1);
      expect(snap[0].symbols).toEqual(['a', 'b', 'c']);
      expect(snap[0].position).toBe(1);
      expect(snap[0].symbols).not.toBe(tape.symbols);

      // Mutating the snapshot must not affect the original.
      snap[0].symbols.push('d');
      expect(tape.symbols).toEqual(['a', 'b', 'c']);
    });

    it('R-snapshot-tapes-multi-tape: handles N tapes with correct positions', () => {
      const tapes: TapeLike[] = [
        { symbols: ['a'], position: 0, alphabet: { symbols: [' ', 'a'] } },
        { symbols: ['b', 'c'], position: 1, alphabet: { symbols: [' ', 'b', 'c'] } },
        { symbols: ['d', 'e', 'f'], position: 2, alphabet: { symbols: [' ', 'd', 'e', 'f'] } },
      ];
      const snap = snapshotTapes(tapes);
      expect(snap).toEqual([
        { symbols: ['a'], position: 0 },
        { symbols: ['b', 'c'], position: 1 },
        { symbols: ['d', 'e', 'f'], position: 2 },
      ]);
    });

    it('R-snapshot-alphabets-clones: returned string[] is a defensive copy', () => {
      const tape: TapeLike = {
        symbols: ['a'],
        position: 0,
        alphabet: { symbols: [' ', 'a', 'b'] },
      };
      const snap = snapshotAlphabets([tape]);

      expect(snap).toEqual([[' ', 'a', 'b']]);
      expect(snap[0]).not.toBe(tape.alphabet.symbols);

      snap[0].push('c');
      expect(tape.alphabet.symbols).toEqual([' ', 'a', 'b']);
    });

    it('R-snapshot-alphabets-multi-tape: handles N tapes', () => {
      const tapes: TapeLike[] = [
        { symbols: ['a'], position: 0, alphabet: { symbols: [' ', 'a'] } },
        { symbols: ['b'], position: 0, alphabet: { symbols: [' ', 'b', 'c'] } },
      ];
      expect(snapshotAlphabets(tapes)).toEqual([
        [' ', 'a'],
        [' ', 'b', 'c'],
      ]);
    });
  });
```

- [ ] **Step 2: Run tests**

Run: `npm test`

Expected: 34 tests pass.

- [ ] **Step 3: Run check + lint**

Run: `npm run check && npm run lint`

Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/workerHelpers.test.ts
git commit -m "test(workerHelpers): snapshot topic — 4 tests for tape/alphabet defensive copies"
```

---

## Task 5: Append `phase-guard` topic — 3 tests

**Files:**
- Modify: `src/lib/workerHelpers.test.ts`

- [ ] **Step 1: Append the `phase-guard` describe block**

Append after the `describe('snapshot', ...)` closing `});`:

```ts
  describe('phase-guard', () => {
    it('R-phase-guard-allows: does not throw when current is in allowed list', () => {
      expect(() => expectPhase('built', ['idle', 'built'])).not.toThrow();
      expect(() => expectPhase('paused', ['paused'])).not.toThrow();
    });

    it('R-phase-guard-rejects: throws when current is not in allowed list', () => {
      expect(() => expectPhase('idle', ['built'])).toThrow();
      expect(() => expectPhase('running', ['idle', 'built'])).toThrow();
    });

    it('R-phase-guard-message-format: error message reads `worker phase X, expected Y|Z`', () => {
      expect(() => expectPhase('idle', ['built', 'paused']))
        .toThrow('worker phase idle, expected built|paused');
    });
  });
```

- [ ] **Step 2: Run tests**

Run: `npm test`

Expected: 37 tests pass.

- [ ] **Step 3: Run check + lint**

Run: `npm run check && npm run lint`

Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/workerHelpers.test.ts
git commit -m "test(workerHelpers): phase-guard topic — 3 tests for allow/reject/message"
```

---

## Task 6: Append `step-arm` topic — 4 tests

**Files:**
- Modify: `src/lib/workerHelpers.test.ts`

- [ ] **Step 1: Append the `step-arm` describe block**

Append after the `describe('phase-guard', ...)` closing `});`:

```ts
  describe('step-arm', () => {
    it('R-step-arm-sets-after: assigns target.debug = { after: true } when original was null', () => {
      const target: DebugTarget = { debug: null };
      armStepAfter(target);
      expect(target.debug).toEqual({ after: true });
    });

    it('R-step-arm-preserves-before: keeps user-authored .before in the new debug config', () => {
      const target: DebugTarget = { debug: { before: true } };
      armStepAfter(target);
      expect(target.debug).toEqual({ after: true, before: true });
    });

    it('R-step-arm-restore-null: restore() reverts target.debug to original null', () => {
      const target: DebugTarget = { debug: null };
      const { restore } = armStepAfter(target);
      expect(target.debug).not.toBeNull();
      restore();
      expect(target.debug).toBeNull();
    });

    it('R-step-arm-restore-by-reference: restore() puts the exact original object reference back', () => {
      const original = { before: true, after: 'someFilter' as unknown };
      const target: DebugTarget = { debug: original };
      const { restore } = armStepAfter(target);
      // Helper assigned a NEW object containing { after: true, before: true }.
      expect(target.debug).not.toBe(original);
      restore();
      // Restore puts the SAME original reference back, not a copy.
      expect(target.debug).toBe(original);
    });
  });
```

- [ ] **Step 2: Run tests**

Run: `npm test`

Expected: 41 tests pass.

- [ ] **Step 3: Run check + lint**

Run: `npm run check && npm run lint`

Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/workerHelpers.test.ts
git commit -m "test(workerHelpers): step-arm topic — 4 tests for arm/preserve/restore semantics"
```

---

## Task 7: Refactor `machineWorker.ts` to use the helpers

**Files:**
- Modify: `src/lib/machineWorker.ts`

- [ ] **Step 1: Add helper imports**

In `src/lib/machineWorker.ts`, find the existing `import * as turing from ...` line (near the top of the imports block). Add this directly after it:

```ts
import {
  commandsFromYield,
  snapshotTapes,
  snapshotAlphabets,
  expectPhase,
  armStepAfter,
  type MachineYield,
  type DebugTarget,
} from './workerHelpers';
```

- [ ] **Step 2: Remove the now-redundant local declarations**

Delete the following from `machineWorker.ts`:

- Lines around `type MachineYield = { ... };` (the local type alias — replace usage with the imported one).
- The entire `function expectPhase(...allowed: WorkerPhase['kind'][]): void { ... }` block.
- The entire `function movementCode(m: symbol): Movement { ... }` block.
- The entire `function commandsFromYield(y: MachineYield): Command[] { ... }` block.
- The entire `function snapshotTapes(): TapeSnapshot[] { ... }` block.
- The entire `function snapshotAlphabets(): string[][] { ... }` block.

After deletion, `machineWorker.ts` no longer defines these functions or the `MachineYield` type — they all come from `workerHelpers`.

- [ ] **Step 3: Update `expectPhase` call sites (3 sites)**

Find and replace:

```ts
// before
expectPhase('built');

// after
expectPhase(phase.kind, ['built']);
```

```ts
// before (the second site)
expectPhase('built');

// after
expectPhase(phase.kind, ['built']);
```

```ts
// before (in the message handler's resume case)
expectPhase('paused');

// after
expectPhase(phase.kind, ['paused']);
```

Three sites total. Use grep if unsure: `grep -n 'expectPhase(' src/lib/machineWorker.ts`.

- [ ] **Step 4: Update `snapshotTapes()` / `snapshotAlphabets()` call sites (5 sites)**

Find every `snapshotTapes()` and `snapshotAlphabets()` call (no args) and add the `tapes` argument:

```ts
// before
tapes: snapshotTapes(),
alphabets: snapshotAlphabets(),

// after
tapes: snapshotTapes(tapes),
alphabets: snapshotAlphabets(tapes),
```

Five sites total. Use grep: `grep -n 'snapshotTapes()\|snapshotAlphabets()' src/lib/machineWorker.ts`.

The `commandsFromYield(...)` calls (3 sites) keep their signature as-is — only the import source changes (to `workerHelpers`).

- [ ] **Step 5: Replace inline arming at cold-start site**

Find the cold-start step-arming block (current lines ~337-345 in the `run()` function). Replace:

```ts
// before
if (step && initialState) {
  const target = initialState as { debug: { before?: unknown; after?: unknown } | null };
  const original = target.debug;
  const newDebug: { before?: unknown; after?: unknown } = { after: true };
  if (original?.before !== undefined) newDebug.before = original.before;
  target.debug = newDebug;
  pendingRestore = () => { target.debug = original; };
  stepPending = true;
}

// after
if (step && initialState) {
  const { restore } = armStepAfter(initialState as DebugTarget);
  pendingRestore = restore;
  stepPending = true;
}
```

- [ ] **Step 6: Replace inline arming at resume-with-step site**

Find the resume-with-step arming block (current lines ~393-407 inside `onDebugBreakFn`). Replace:

```ts
// before
if (action.step) {
  stepPending = true;
  // Arm the iteration-we're-stepping-through's state.debug.after = true
  // so its after-fire fires (in the next iteration's body) and we can
  // pause there. For a `before` break: m IS that iteration (m.state).
  // For an `after` break (m substituted to prevYield): the next iter's
  // state lives at m.nextState. Preserve any original `before` filter.
  // Read .before via the getter (DebugConfig accessor — spread skips it).
  const target = (
    m.debugBreak?.before ? m.state : m.nextState
  ) as { debug: { before?: unknown; after?: unknown } | null };
  const original = target.debug;
  const preservedBefore = original?.before;
  const newDebug: { before?: unknown; after?: unknown } = { after: true };
  if (preservedBefore !== undefined) newDebug.before = preservedBefore;
  target.debug = newDebug;
  pendingRestore = () => { target.debug = original; };
}

// after
if (action.step) {
  stepPending = true;
  // For a `before` break: m IS the iteration we want to step through.
  // For an `after` break (m substituted to prevYield): the next iter's
  // state lives at m.nextState. armStepAfter handles the .before
  // preservation and returns a restore function.
  const target = (
    m.debugBreak?.before ? m.state : m.nextState
  ) as DebugTarget;
  const { restore } = armStepAfter(target);
  pendingRestore = restore;
}
```

- [ ] **Step 7: Type-check, lint, run all tests**

Run: `npm run check && npm run lint && npm test`

Expected:
- `npm run check`: 0 errors, 0 warnings.
- `npm run lint`: exit 0.
- `npm test`: 41 tests pass — the 16 new helper tests plus all 25 PR1+PR2 tests (regression check on the worker refactor).

If `npm test` shows failures in `machineRunner.test.ts`, the worker refactor broke something — review the call site updates in steps 3-6 carefully.

- [ ] **Step 8: Commit**

```bash
git add src/lib/machineWorker.ts
git commit -m "refactor(machineWorker): use workerHelpers; collapse dual-site step-arming via armStepAfter"
```

---

## Task 8: Update `docs/execution-model.md` §14 grammar

**Files:**
- Modify: `docs/execution-model.md`

- [ ] **Step 1: Update the `<topic>` row in §14's grammar table**

In `docs/execution-model.md`, find the §14 Scenario ID grammar table. Locate the row that currently reads:

```
| `<topic>` (R only) | `protocol`, `timer`, `pending`, `error`, plus equivalents for the worker / helper test scopes added by future PRs |
```

Replace it with:

```
| `<topic>` (R only) | `machineRunner.test.ts`: `protocol`, `timer`, `pending`, `error`. `workerHelpers.test.ts`: `movement-code`, `commands`, `snapshot`, `phase-guard`, `step-arm`. Future PRs add equivalents for component / E2E test scopes. |
```

- [ ] **Step 2: Verify**

Run: `grep -n 'workerHelpers.test.ts' docs/execution-model.md`

Expected: at least one match in §14.

- [ ] **Step 3: Commit**

```bash
git add docs/execution-model.md
git commit -m "docs(execution-model): §14 — add 5 R- topics for workerHelpers tests"
```

---

## Task 9: Final verification

**Files:** none modified

- [ ] **Step 1: Type-check**

Run: `npm run check`

Expected: 0 errors, 0 warnings.

- [ ] **Step 2: Lint**

Run: `npm run lint`

Expected: exit 0.

- [ ] **Step 3: Build**

Run: `npm run build`

Expected: succeeds; `dist/` produced.

- [ ] **Step 4: Run all tests**

Run: `npm test`

Expected:

```
 Test Files  2 passed (2)
      Tests  41 passed (41)
```

(2 test files: `src/lib/machineRunner.test.ts` from PR1+PR2, and `src/lib/workerHelpers.test.ts` from PR3.)

- [ ] **Step 5: Coverage check**

Run: `npm run test:coverage`

Expected:
- `src/lib/workerHelpers.ts`: ≥95% statements (the 6 helpers are small; tests should cover every branch).
- `src/lib/machineWorker.ts`: roughly unchanged from PR2 baseline (the helpers were ~30% of its statements; they're now exercised through `workerHelpers.ts` instead, so worker-direct coverage drops but total project coverage rises).
- `src/lib/machineRunner.ts`: unchanged (~92% from PR2).

Capture the per-file `workerHelpers.ts` coverage in your report.

- [ ] **Step 6: Scenario-ID grep audit**

Run:

```bash
grep -oE '\b[SR]-[a-z-]+' src/lib/workerHelpers.test.ts | sort -u
```

Expected: 16 unique IDs:

```
R-commands-keep
R-commands-mixed
R-commands-multi-tape
R-commands-write
R-movement-code-mappings
R-phase-guard-allows
R-phase-guard-message-format
R-phase-guard-rejects
R-snapshot-alphabets-clones
R-snapshot-alphabets-multi-tape
R-snapshot-tapes-clones-symbols
R-snapshot-tapes-multi-tape
R-step-arm-preserves-before
R-step-arm-restore-by-reference
R-step-arm-restore-null
R-step-arm-sets-after
```

No `S-` IDs in this file (PR3 has no UI-scenario citations).

- [ ] **Step 7: Worker module size check**

Run: `wc -l src/lib/machineWorker.ts`

Expected: ~510 lines (down from ~541 — the inline implementations removed in T7 net to ~30 lines saved after import lines added back).

- [ ] **Step 8: Apply fixes if needed**

If any of steps 1–7 reveal real issues (broken test, type error, lint fail, missed call site), fix them inline and amend the relevant task's commit. Don't create a "review-pass" commit.

If no fixes needed, T9 has no commit.

---

## Self-review

**Spec coverage.** Each spec section maps to tasks:

- §Decisions and §File map — captured in plan intro and the file map.
- §Helper signatures — T1 verbatim.
- §Worker module changes — T7 (with each call-site category as its own step).
- §Test layout (5 topics, 16 tests) — T2 (movement-code), T3 (commands), T4 (snapshot), T5 (phase-guard), T6 (step-arm).
- §Spec edit (§14 topic list) — T8.
- §Out of scope — explicitly not in any task.
- §Self-review (6 verifications) — T9.

**Placeholder scan.** No "TBD", "TODO", or "implement later". Every code step shows actual code; every command shows expected output.

**Type / vocabulary consistency.** Helper names (`movementCode`, `commandsFromYield`, `snapshotTapes`, `snapshotAlphabets`, `expectPhase`, `armStepAfter`), type names (`MachineYield`, `TapeLike`, `WorkerPhaseKind`, `DebugConfig`, `DebugTarget`), and scenario IDs all use consistent spelling across all 9 tasks. `armStepAfter`'s return shape is `{ restore: () => void }` everywhere (T1, T6 tests, T7 call sites).

**Branch hygiene.** All commits land on the existing `47-test-infra-pr3` branch (which already has the spec design commit `eb6f64f`). Don't commit to master.
