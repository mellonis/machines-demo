# Test infrastructure — PR3 (worker helpers extraction + tests) — design

Tracks: [#47](https://github.com/mellonis/machines-demo/issues/47) (test infrastructure). PR3 of an expected 5-PR series. Builds on PR1 (#55, merged) and PR2 (#56, merged).

## Problem

`src/lib/machineWorker.ts` runs `self.onmessage = (e) => { ... }` at the top level — direct import from a Node test runner explodes (`self` undefined). Per #47's Scope 3, the testable bits inside the worker (phase machine, command derivation, step-trick arming, `expectPhase`) need to be pulled into pure helpers that *don't* touch the Worker boundary, then unit-tested.

The same step-arming logic is also currently duplicated inline in two places inside the worker: cold-start (in the `run()` body) and resume-with-step (inside `onDebugBreakFn`). The extraction DRYs these and makes the arming behavior crisply testable.

## Decisions

- **Scope: all six helpers.** `movementCode`, `commandsFromYield`, `snapshotTapes`, `snapshotAlphabets`, `expectPhase`, `armStepAfter`. Smaller-scope alternatives (just the already-pure two; or skip `armStepAfter`) leave the dual-site arming logic in the worker, which is the highest-value test target. Going broad once is cleaner than two follow-up PRs.
- **File layout: `src/lib/workerHelpers.ts`.** Flat single-concept name matching the existing `caps.ts` / `format.ts` / `persist.ts` style. Tests at `src/lib/workerHelpers.test.ts`.
- **Test layout: per-helper topic in scenario IDs.** Five new `R-` topics added to §14: `movement-code`, `commands`, `snapshot`, `phase-guard`, `step-arm`. Mirrors PR2's per-category `timer` / `pending` / `error` topics — gives `R-step-arm-*` grep groupings per helper.
- **No production behavior change.** The worker's wire protocol (postMessage shapes) is unchanged. Refactor preserves exact semantics including the by-reference original capture in `armStepAfter`.
- **Tests are pure synchronous units.** No `async`, no fake timers, no `FakeWorker` — these helpers don't touch the Worker boundary, so the `setup → call → assert` shape applies directly.

## File map

| File | Change |
|---|---|
| `src/lib/workerHelpers.ts` | **Create** — 6 pure helpers + supporting types. |
| `src/lib/workerHelpers.test.ts` | **Create** — Vitest suite, 16 tests across 5 topic groups. |
| `src/lib/machineWorker.ts` | **Modify** — replace 6 inline implementations with imports; pass module-state args at call sites; collapse 2 inline arming sites into `armStepAfter` calls. ~30 lines net reduction. |
| `docs/execution-model.md` | **Modify** — §14 grammar table's `<topic>` row gains the 5 new helper topics, grouped by source file. ~1 line. |

No other files modified. No new dependencies.

## Helper signatures (`src/lib/workerHelpers.ts`)

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

Notes:

- **Local types** (`MachineYield`, `TapeLike`, `WorkerPhaseKind`, `DebugConfig`, `DebugTarget`) describe only the structural shapes the helpers need, not full upstream types. Keeps the helpers decoupled from `@turing-machine-js/machine` private internals.
- **`movementCode`** is the only helper that imports `@turing-machine-js/machine` (Symbol-identity comparison). Engine-agnostic — `@post-machine-js/machine` builds on the same upstream Symbols.
- **`armStepAfter` restores by reference** — when restored, `target.debug` is the *exact same* object the helper saw, not a copy.
- **`expectPhase` takes `currentKind` directly** (not the whole `WorkerPhase` discriminated union), so callers do `expectPhase(phase.kind, ['built'])`.

## Worker module changes (`src/lib/machineWorker.ts`)

Imports added at top (after the existing `import * as turing` block):

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

Removed (current lines 173–217):

- `function expectPhase(...allowed)`
- `function movementCode(m)`
- `function commandsFromYield(y)`
- `function snapshotTapes()`
- `function snapshotAlphabets()`
- The local `MachineYield` type alias at line 64 (now imported)

The local `WorkerPhase` discriminated union stays in `machineWorker.ts` (the helper only needs the `kind` token).

Call site updates:

1. **`expectPhase` calls** (3 sites: lines 282, 308, 513) — change to array form, pass `phase.kind`:
   ```ts
   expectPhase(phase.kind, ['built']);
   expectPhase(phase.kind, ['paused']);
   ```
2. **`snapshotTapes()` / `snapshotAlphabets()` calls** (5 sites: lines 376, 475, 476, 502, 538) — pass the `tapes` module variable:
   ```ts
   tapes: snapshotTapes(tapes),
   alphabets: snapshotAlphabets(tapes),
   ```
3. **`commandsFromYield()` calls** (3 sites: lines 287, 299, 417) — unchanged signature; just become imported.
4. **`armStepAfter` replaces inline arming** (2 sites: lines 337-345 cold-start, lines 393-407 resume-with-step):
   ```ts
   // cold-start (lines 337-345)
   if (step && initialState) {
     const { restore } = armStepAfter(initialState as DebugTarget);
     pendingRestore = restore;
     stepPending = true;
   }

   // resume-with-step (lines 393-407)
   const target = (
     m.debugBreak?.before ? m.state : m.nextState
   ) as DebugTarget;
   const { restore } = armStepAfter(target);
   pendingRestore = restore;
   ```

The 10-line inline arming at each site collapses to 3-4 lines. ~14 lines saved across both sites.

## Test layout (`src/lib/workerHelpers.test.ts`)

Imports:

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
```

Five `describe` blocks covering 16 tests:

```ts
describe('workerHelpers', () => {
  describe('movement-code', () => {
    // 1 table-driven test
  });

  describe('commands', () => {
    // 4 tests: keep, write, multi-tape, mixed
  });

  describe('snapshot', () => {
    // 4 tests: tapes-clones, tapes-multi, alphabets-clones, alphabets-multi
  });

  describe('phase-guard', () => {
    // 3 tests: allows, rejects, message format
  });

  describe('step-arm', () => {
    // 4 tests: sets-after, preserves-before, restore-null, restore-by-reference
  });
});
```

The 16 tests:

| Topic | Scenario ID | Asserts |
|---|---|---|
| `movement-code` | `R-movement-code-mappings` | `left`/`right`/`stay` symbols → `'L'`/`'R'`/`'S'` (3 cases in one test) |
| `commands` | `R-commands-keep` | `written === current` → `{ movement, symbol: null }` |
| `commands` | `R-commands-write` | `written !== current` → `{ movement, symbol: written }` |
| `commands` | `R-commands-multi-tape` | N input tapes → N output Commands, indexed correctly |
| `commands` | `R-commands-mixed` | per-tape mix of keep/write resolved per index |
| `snapshot` | `R-snapshot-tapes-clones-symbols` | returned `symbols` array is a defensive copy (not aliased to input) |
| `snapshot` | `R-snapshot-tapes-multi-tape` | N input tapes → N snapshots with correct positions |
| `snapshot` | `R-snapshot-alphabets-clones` | returned `string[]` is a defensive copy |
| `snapshot` | `R-snapshot-alphabets-multi-tape` | N input tapes → N alphabets |
| `phase-guard` | `R-phase-guard-allows` | does not throw when `current` is in `allowed` list |
| `phase-guard` | `R-phase-guard-rejects` | throws when `current` is not in `allowed` list |
| `phase-guard` | `R-phase-guard-message-format` | error message reads `worker phase X, expected Y\|Z` |
| `step-arm` | `R-step-arm-sets-after` | original `null` → `{ after: true }` |
| `step-arm` | `R-step-arm-preserves-before` | original `{ before: filter }` → `{ after: true, before: filter }` |
| `step-arm` | `R-step-arm-restore-null` | `restore()` reverts to `null` |
| `step-arm` | `R-step-arm-restore-by-reference` | `restore()` puts the exact original object reference back |

Each test follows `setup → call → assert`. No async, no fake timers, no `FakeWorker`. The plan can include the full test bodies verbatim — they're short.

## Spec edit (`docs/execution-model.md` §14)

The `<topic>` row in the §14 grammar table grows by 5 entries:

```diff
- | `<topic>` (R only) | `protocol`, `timer`, `pending`, `error`, plus equivalents for the worker / helper test scopes added by future PRs |
+ | `<topic>` (R only) | `machineRunner.test.ts`: `protocol`, `timer`, `pending`, `error`. `workerHelpers.test.ts`: `movement-code`, `commands`, `snapshot`, `phase-guard`, `step-arm`. Future PRs add equivalents for component / E2E test scopes. |
```

One row replaced with an updated row. No other §14 changes.

## Out of scope

- **Tests for the worker's `build()` and `step()` request handlers themselves** — those still touch `self.onmessage` and the upstream library's stateful generator. PR3 covers what's purely extractable; the request-handler-level coverage is what the runner-side tests already exercise via the `FakeWorker` protocol layer.
- **Component tests** (Toolbar, MachineView) — PR4.
- **Playwright E2E** — PR5.
- **CI integration** of `npm test` as a pre-build gate — separate small PR.
- **Coverage threshold enforcement** — defer until E2E and component layers land.
- **Refactoring `WorkerPhase` to be testable** beyond the `kind` token — the discriminated union with phase-specific payload (`built; halted: boolean`) stays inside the worker since the rest of the union isn't exercised outside the worker.

## Self-review

After writing tests:

1. **Each `it()` name matches `\bR-[a-z-]+: <text>` pattern.** All 16 PR3 tests are `R-`-prefixed.
2. **No production behavior change.** Run the existing `machineRunner.test.ts` after the worker refactor — all 25 PR1+PR2 tests still pass.
3. **Worker module shrinks net.** `wc -l src/lib/machineWorker.ts` should drop by ~30 lines from the inline-implementation removal (helper imports add a few lines back).
4. **Helper file at 100% statement coverage.** `npm run test:coverage` reports `workerHelpers.ts` fully covered (the 16 tests exercise every branch).
5. **Total test count.** PR1: 9 + PR2: 16 + PR3: 16 = 41 tests across 2 files.
6. **Scenario-ID grep audit.** `grep -oE '\bR-[a-z-]+' src/lib/workerHelpers.test.ts | sort -u` returns 16 unique IDs; none clash with the runner-test IDs (different topic prefixes guarantee uniqueness).

Fix any issues inline before declaring done.
