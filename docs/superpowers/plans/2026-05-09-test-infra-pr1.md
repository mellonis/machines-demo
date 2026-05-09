# Test infrastructure PR1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land Vitest + the first 7 `machineRunner` protocol-shape tests, plus the production refactor (factory injection) and test helpers (`FakeWorker`, `makeFakeFactory`) that subsequent test PRs build on. PR1 of [#47](https://github.com/mellonis/machines-demo/issues/47).

**Architecture:** `MachineRunner` accepts a required `workerFactory: () => MachineWorkerLike` arg, removing the Vite `?worker` import from the runner module. Tests use a `FakeWorker` test double that captures `postMessage` calls and lets tests trigger synthetic responses. Each test asserts a single request/response shape from #47's protocol category.

**Tech Stack:** Vitest 2.x, Vite 5.x, TypeScript 5.x, Svelte 5.x. No DOM environment needed for runner tests (`environment: 'node'`).

**Spec:** `docs/superpowers/specs/2026-05-09-test-infra-pr1-design.md`

---

## File map

| File | Change |
|---|---|
| `vitest.config.ts` | **Create** — minimal Vitest config (node env, explicit imports, v8 coverage). |
| `package.json` | **Modify** — add `vitest` + `@vitest/coverage-v8` to devDependencies; add `test`, `test:watch`, `test:coverage` scripts. |
| `src/lib/machineRunner.ts` | **Modify** — add `MachineWorkerLike` interface + `WorkerFactory` type, drop `MachineWorker` import, constructor takes required `workerFactory` arg. |
| `src/components/MachineView.svelte` | **Modify** — single callsite update: import `MachineWorker`, pass `() => new MachineWorker()` to `new MachineRunner(...)`. |
| `src/lib/testUtils.ts` | **Create** — `FakeWorker` class + `makeFakeFactory()` helper. |
| `src/lib/machineRunner.test.ts` | **Create** — 7 protocol-shape tests. |
| `docs/execution-model.md` | **Modify** — append §14 Scenario ID grammar (lifts grammar from the meta-spec, includes both `S-` and `R-` prefixes). |

---

## Verification model

Each task ends with one or more of these checks:

1. `npm run check` — `svelte-check` + `tsc --noEmit`. Must exit 0.
2. `npm run lint` — ESLint flat config. Must exit 0.
3. `npm test` — Vitest one-shot mode. After T2 lands the harness, every subsequent task runs this and expects a PASSING test count that grows by 1.

The production refactor in T3 is a structural change with no behavior delta; T3's verification is `npm run check` only (TypeScript types must agree across `machineRunner.ts` and `MachineView.svelte`). Tests get added one at a time from T5 onward.

---

## Task 1: Add §14 Scenario ID grammar to the deliverable

**Files:**
- Modify: `docs/execution-model.md`

- [ ] **Step 1: Append §14 at the end of the file**

Append the following section after the existing §13 Cross-references. Single blank-line separator before the new heading.

````markdown
## 14. Scenario ID grammar

`<prefix>-<action-or-topic>-<context-or-facet>-<flags?>`

| Slot | Values |
|---|---|
| `S-` | literal prefix; marks the token as a UI-scenario reference. Used throughout §§4–10. |
| `R-` | runner / worker / helper internal scenarios (no UI counterpart). Format `R-<topic>-<facet>`, e.g. `R-protocol-build`, `R-timer-suspend-on-paused`. Used in `*.test.ts` files alongside `S-...` IDs. |
| `<action>` (S only) | `build`, `step`, `run`, `continue`, `stop`, `takectl`, `apply`, `debug-toggle`, `withpause-toggle`, `error`, `truncate`, `timeout` |
| `<from-state>` (S only) | `demo`, `idle`, `manual`, `auto`, `cont`, `paused`, `halted` (and `step` only in §11 for legacy RUNNING_STEP citations) |
| `<topic>` (R only) | `protocol`, `timer`, `pending`, `error`, plus equivalents for the worker / helper test scopes added by future PRs |
| `<facet>` (R only) | short descriptor — `build`, `step-cycle`, `suspend-on-paused`, `reject-overlap`, `wraps-error-with-tapes`, etc. |
| `<flags?>` (S only) | optional flag suffix(es); `on` / `off` (debug), `auto` / `cont` (withPause when ambiguous), or compound like `off-auto` |

Conventions:
- Lowercase + hyphen throughout. No shift key, easy to grep.
- One token per slot. Don't run flags together.
- Drop slots that don't matter — uniform behavior across flags ⇒ no flag suffix.
- Stable across spec edits — prefer adding new IDs over renaming.
- Both prefixes follow the regex `\b[SR]-[a-z-]+`. Tests / CI grep this to find every cited scenario.

Where IDs live:
- **Matrix cells** (§8): `S-step-paused-off: arm .after, resume(step), → PAUSED`. Text after `:` is the one-line outcome.
- **Walk-throughs** (§10): each opens with `### \`S-step-paused-off\` / \`S-step-paused-on\` — Step from break` so the ID is the section anchor.
- **Tests** ([#47](https://github.com/mellonis/machines-demo/issues/47)): each `it()` cites at least one ID. UI-flow tests cite `S-...` (component / E2E layers); runner / worker / helper tests cite `R-...`. Failing tests point straight at the spec rule they broke.
- **§11 entries**: cite the IDs they affect when describing today's divergences.
````

- [ ] **Step 2: Verify**

Run: `grep -E '^## ' docs/execution-model.md`

Expected: 14 numbered headings, ending with `## 14. Scenario ID grammar`.

- [ ] **Step 3: Commit**

```bash
git add docs/execution-model.md
git commit -m "docs(execution-model): add §14 Scenario ID grammar (lifts from meta-spec)"
```

---

## Task 2: Install Vitest + add scripts + create config

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Install Vitest and the v8 coverage provider**

Run:

```bash
npm install --save-dev vitest @vitest/coverage-v8
```

Expected: `package.json` and `package-lock.json` updated; new entries in `devDependencies` for `vitest` and `@vitest/coverage-v8`. Both at v2.x or whatever's current; the major version is what matters.

- [ ] **Step 2: Add npm scripts to `package.json`**

In `package.json`, replace the existing `scripts` block:

```json
"scripts": {
  "dev": "vite",
  "build": "svelte-check --tsconfig ./tsconfig.json && vite build",
  "preview": "vite preview",
  "check": "svelte-check --tsconfig ./tsconfig.json",
  "lint": "eslint ."
},
```

with:

```json
"scripts": {
  "dev": "vite",
  "build": "svelte-check --tsconfig ./tsconfig.json && vite build",
  "preview": "vite preview",
  "check": "svelte-check --tsconfig ./tsconfig.json",
  "lint": "eslint .",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage"
},
```

- [ ] **Step 3: Create `vitest.config.ts`**

Create `vitest.config.ts` at the repo root:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/**/*.test.ts', 'src/lib/testUtils.ts'],
    },
  },
});
```

- [ ] **Step 4: Verify Vitest runs**

Run: `npm test`

Expected output (no test files exist yet):

```
No test files found, exiting with code 1
include: src/**/*.test.ts
```

That's fine for now — the harness is wired up; tests follow in T5+. The exit code 1 isn't ideal but is Vitest's default when no tests exist; it'll flip to 0 once T5 lands the first test.

Also run: `npm run check`

Expected: 0 errors, 0 warnings.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "test(infra): install Vitest and configure node environment"
```

---

## Task 3: Refactor `MachineRunner` for factory injection

**Files:**
- Modify: `src/lib/machineRunner.ts`
- Modify: `src/components/MachineView.svelte`

- [ ] **Step 1: Update `src/lib/machineRunner.ts`**

Replace the imports block (top of file, lines starting with `import MachineWorker from './machineWorker.ts?worker';`) so it reads:

```ts
import { MAX_STEPS, WORKER_TIMEOUT_MS } from './caps.ts';
import {
  type BuiltResponse,
  type Engine,
  type PausedResponse,
  type RanResponse,
  type SteppedResponse,
  type TapeSnapshot,
  type WorkerRequest,
  type WorkerResponse,
} from './types.ts';
```

(Removed: `import MachineWorker from './machineWorker.ts?worker';`. Kept everything else.)

After the `WorkerError` class declaration and before the `type SimplePending` line, add the new interface and type alias:

```ts
export interface MachineWorkerLike {
  postMessage(msg: WorkerRequest): void;
  terminate(): void;
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
}

export type WorkerFactory = () => MachineWorkerLike;
```

Change the `private worker:` field declaration from:

```ts
private worker: Worker | null = null;
```

to:

```ts
private worker: MachineWorkerLike | null = null;
```

Add a `private workerFactory: WorkerFactory;` field declaration alongside. Update the constructor from:

```ts
constructor(engine: Engine) {
  this.engine = engine;
}
```

to:

```ts
constructor(engine: Engine, workerFactory: WorkerFactory) {
  this.engine = engine;
  this.workerFactory = workerFactory;
}
```

Update `spawnWorker()` — change the line `this.worker = new MachineWorker();` to:

```ts
this.worker = this.workerFactory();
```

The `onmessage` and `onerror` assignments below it work as-is. The rest of the class is unchanged.

- [ ] **Step 2: Update `src/components/MachineView.svelte`**

Find the `import { MachineRunner }` import line (somewhere near the top of the `<script lang="ts">` block) and add a new import line directly above it:

```ts
import MachineWorker from '$lib/machineWorker.ts?worker';
```

Find the `runner = new MachineRunner(engine)` line (or `new MachineRunner(...)` wherever it's used). Update it to:

```ts
runner = new MachineRunner(engine, () => new MachineWorker());
```

If the import path uses a relative form (`'../lib/machineRunner'`) and not `$lib`, mirror the existing convention for the runner — do NOT introduce `$lib` if the codebase isn't already using path aliases. Inspect the existing `import { MachineRunner }` line first; use the same style for the new `MachineWorker` import.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npm run check`

Expected: 0 errors, 0 warnings. The new types resolve, `MachineRunner`'s constructor now requires two args, and the `MachineView.svelte` callsite supplies both.

- [ ] **Step 4: Verify lint passes**

Run: `npm run lint`

Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/lib/machineRunner.ts src/components/MachineView.svelte
git commit -m "refactor(machineRunner): inject worker factory; remove ?worker import"
```

---

## Task 4: Add `FakeWorker` and `makeFakeFactory` to `testUtils.ts`

**Files:**
- Create: `src/lib/testUtils.ts`

- [ ] **Step 1: Create the file**

Create `src/lib/testUtils.ts`:

```ts
import type { MachineWorkerLike, WorkerFactory } from './machineRunner';
import type { WorkerRequest, WorkerResponse } from './types';

/**
 * Test double for the Web Worker that `MachineRunner` posts to.
 *
 * - `postedMessages` captures every request sent by the runner.
 * - Tests trigger inbound messages via `respond(...)` and `errorEvent(...)`.
 * - Implements `MachineWorkerLike` structurally; can be passed wherever a
 *   real `Worker` is expected on the runner side.
 */
export class FakeWorker implements MachineWorkerLike {
  postedMessages: WorkerRequest[] = [];

  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;

  terminated = false;

  postMessage(msg: WorkerRequest): void {
    if (this.terminated) throw new Error('postMessage on terminated worker');
    this.postedMessages.push(msg);
  }

  terminate(): void {
    this.terminated = true;
  }

  // -- Test helpers (not part of MachineWorkerLike) --

  respond(data: WorkerResponse): void {
    if (!this.onmessage) throw new Error('respond() before onmessage handler set');
    this.onmessage({ data } as MessageEvent<WorkerResponse>);
  }

  errorEvent(message: string): void {
    if (!this.onerror) throw new Error('errorEvent() before onerror handler set');
    this.onerror({ message } as ErrorEvent);
  }

  get last(): WorkerRequest | undefined {
    return this.postedMessages[this.postedMessages.length - 1];
  }
}

/**
 * Returns a factory that produces a fresh `FakeWorker` on each call, plus
 * accessors for the most recent fake (`current()`) and every fake produced
 * (`all()`). Mirrors `MachineRunner.spawnWorker` semantics: each `build()`
 * invokes the factory once.
 */
export function makeFakeFactory(): {
  factory: WorkerFactory;
  current: () => FakeWorker;
  all: () => FakeWorker[];
} {
  const fakes: FakeWorker[] = [];
  return {
    factory: () => {
      const fake = new FakeWorker();
      fakes.push(fake);
      return fake;
    },
    current: () => {
      const last = fakes[fakes.length - 1];
      if (!last) throw new Error('makeFakeFactory: factory not yet called');
      return last;
    },
    all: () => fakes.slice(),
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npm run check`

Expected: 0 errors, 0 warnings. (`testUtils.ts` is picked up by `svelte-check` because it's under `src/lib/`. The interface and type imports must resolve from the refactored `machineRunner.ts`.)

- [ ] **Step 3: Verify lint passes**

Run: `npm run lint`

Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/lib/testUtils.ts
git commit -m "test(infra): add FakeWorker and makeFakeFactory test helpers"
```

---

## Task 5: First test — `R-protocol-build`

**Files:**
- Create: `src/lib/machineRunner.test.ts`

- [ ] **Step 1: Create the test file with the first test**

Create `src/lib/machineRunner.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { MachineRunner } from './machineRunner';
import { makeFakeFactory } from './testUtils';

describe('MachineRunner', () => {
  describe('protocol shape', () => {
    it('R-protocol-build: posts {type:"build",engine,code} and resolves with BuiltResponse', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');

      expect(current().last).toEqual({
        type: 'build',
        engine: 'turing',
        code: '// user code',
      });

      const builtPayload = {
        type: 'built' as const,
        tapes: [],
        alphabets: [],
        halted: false,
      };
      current().respond(builtPayload);

      await expect(buildPromise).resolves.toEqual(builtPayload);
    });
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npm test`

Expected:

```
 ✓ src/lib/machineRunner.test.ts (1 test)
   ✓ MachineRunner > protocol shape > R-protocol-build: posts {type:"build",engine,code} and resolves with BuiltResponse

 Test Files  1 passed (1)
      Tests  1 passed (1)
```

If the test fails, the most likely cause is a typo in the request shape or response payload — fix and re-run before committing.

- [ ] **Step 3: Commit**

```bash
git add src/lib/machineRunner.test.ts
git commit -m "test(machineRunner): R-protocol-build (build request → BuiltResponse)"
```

---

## Task 6: `R-protocol-step`

**Files:**
- Modify: `src/lib/machineRunner.test.ts`

- [ ] **Step 1: Add the step test**

Append a new `it(...)` block inside the existing `describe('protocol shape', ...)` after the `R-protocol-build` test. Inside `describe('protocol shape')`:

```ts
    it('R-protocol-step: posts {type:"step"} and resolves with SteppedResponse', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      // Build first to spawn the worker.
      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false });
      await buildPromise;

      const stepPromise = runner.step();

      expect(current().last).toEqual({ type: 'step' });

      const steppedPayload = {
        type: 'stepped' as const,
        halted: false,
        commands: null,
        nextCommands: null,
        stepsApplied: 1,
      };
      current().respond(steppedPayload);

      await expect(stepPromise).resolves.toEqual(steppedPayload);
    });
```

- [ ] **Step 2: Run tests**

Run: `npm test`

Expected: 2 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/machineRunner.test.ts
git commit -m "test(machineRunner): R-protocol-step (step request → SteppedResponse)"
```

---

## Task 7: `R-protocol-run`

**Files:**
- Modify: `src/lib/machineRunner.test.ts`

- [ ] **Step 1: Add the run test**

Append inside `describe('protocol shape')` after the `R-protocol-step` test. Add an import for `MAX_STEPS` at the top of the file (modifying the existing top-of-file imports to include `import { MAX_STEPS } from './caps';`):

```ts
import { describe, it, expect } from 'vitest';
import { MAX_STEPS } from './caps';
import { MachineRunner } from './machineRunner';
import { makeFakeFactory } from './testUtils';
```

Then add the test:

```ts
    it('R-protocol-run: posts {type:"run",maxSteps,debug,step} and resolves with RanResponse', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      // Build first.
      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false });
      await buildPromise;

      // Custom-arg run.
      const runPromise = runner.run({ maxSteps: 100, debug: true, step: false });

      expect(current().last).toEqual({
        type: 'run',
        maxSteps: 100,
        debug: true,
        step: false,
      });

      const ranPayload = {
        type: 'ran' as const,
        tapes: [],
        truncated: false,
        commands: [],
        startStep: 0,
        stepsApplied: 5,
      };
      current().respond(ranPayload);

      await expect(runPromise).resolves.toEqual(ranPayload);
    });

    it('R-protocol-run-defaults: posts MAX_STEPS, debug=false, step=false on bare run()', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false });
      await buildPromise;

      const runPromise = runner.run();

      expect(current().last).toEqual({
        type: 'run',
        maxSteps: MAX_STEPS,
        debug: false,
        step: false,
      });

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
```

(Two `it(...)` calls in this task — one for explicit args, one for defaults. The defaults case is part of the protocol-shape contract since the runner adds `?? MAX_STEPS` etc., and tests should lock that behavior down.)

- [ ] **Step 2: Run tests**

Run: `npm test`

Expected: 4 tests pass (R-protocol-build, R-protocol-step, R-protocol-run, R-protocol-run-defaults).

- [ ] **Step 3: Commit**

```bash
git add src/lib/machineRunner.test.ts
git commit -m "test(machineRunner): R-protocol-run + run-defaults (run request shapes)"
```

---

## Task 8: `R-protocol-resume`

**Files:**
- Modify: `src/lib/machineRunner.test.ts`

- [ ] **Step 1: Add the resume test**

Append inside `describe('protocol shape')` after the run tests:

```ts
    it('R-protocol-resume: posts {type:"resume",step} and does not resolve the run promise', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      // Build, then start a run with onPaused.
      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false });
      await buildPromise;

      let pausedSeen = false;
      const runPromise = runner.run({
        onPaused: () => {
          pausedSeen = true;
        },
      });

      // Worker pauses.
      current().respond({
        type: 'paused',
        tapes: [],
        commands: [],
        stepsApplied: 1,
        state: 'q1',
        currentSymbols: ['a'],
        debugBreak: { before: true },
      });
      expect(pausedSeen).toBe(true);

      // Now resume(step=true).
      runner.resume(true);

      expect(current().last).toEqual({ type: 'resume', step: true });

      // Run promise still pending — resolves only on `ran`/`error`.
      // Sanity check: settle a microtask, ensure no resolution yet.
      let runResolved = false;
      void runPromise.then(() => {
        runResolved = true;
      });
      await Promise.resolve();
      expect(runResolved).toBe(false);

      // Default resume() posts step:false.
      runner.resume();
      expect(current().last).toEqual({ type: 'resume', step: false });

      // Cleanly settle the pending run by responding with `ran`.
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
```

- [ ] **Step 2: Run tests**

Run: `npm test`

Expected: 5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/machineRunner.test.ts
git commit -m "test(machineRunner): R-protocol-resume (resume request shape; run stays pending)"
```

---

## Task 9: `R-protocol-set-debug`

**Files:**
- Modify: `src/lib/machineRunner.test.ts`

- [ ] **Step 1: Add the setDebug test**

Append inside `describe('protocol shape')`:

```ts
    it('R-protocol-set-debug: posts {type:"setDebug",on}', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      // Build first to spawn the worker (setDebug is a no-op without one).
      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false });
      await buildPromise;

      runner.setDebug(true);
      expect(current().last).toEqual({ type: 'setDebug', on: true });

      runner.setDebug(false);
      expect(current().last).toEqual({ type: 'setDebug', on: false });
    });

    it('R-protocol-set-debug-no-worker: setDebug before build is a silent no-op', () => {
      const { factory } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      // No build yet, so no worker. setDebug must not throw.
      expect(() => runner.setDebug(true)).not.toThrow();
    });
```

(Two tests — happy path with the worker spawned, plus the documented no-op-before-build path.)

- [ ] **Step 2: Run tests**

Run: `npm test`

Expected: 7 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/machineRunner.test.ts
git commit -m "test(machineRunner): R-protocol-set-debug (worker-present and no-worker)"
```

---

## Task 10: `R-protocol-paused-then-ran`

**Files:**
- Modify: `src/lib/machineRunner.test.ts`

- [ ] **Step 1: Add the paused-cycle test**

Append inside `describe('protocol shape')`:

```ts
    it('R-protocol-paused-then-ran: run() invokes onPaused on paused, resolves on ran', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false });
      await buildPromise;

      const pausedPayloads: Parameters<NonNullable<Parameters<MachineRunner['run']>[0]>['onPaused']>[0][] = [];
      const runPromise = runner.run({
        debug: true,
        onPaused: (p) => {
          pausedPayloads.push(p);
        },
      });

      const pausedPayload = {
        type: 'paused' as const,
        tapes: [],
        commands: [],
        stepsApplied: 1,
        state: 'q1',
        currentSymbols: ['a'],
        debugBreak: { before: true },
      };
      current().respond(pausedPayload);

      // onPaused fired with the payload.
      expect(pausedPayloads).toHaveLength(1);
      expect(pausedPayloads[0]).toEqual(pausedPayload);

      // Run still pending.
      let runSettled = false;
      void runPromise.then(() => {
        runSettled = true;
      });
      await Promise.resolve();
      expect(runSettled).toBe(false);

      // Now finish the run.
      const ranPayload = {
        type: 'ran' as const,
        tapes: [],
        truncated: false,
        commands: [],
        startStep: 0,
        stepsApplied: 5,
      };
      current().respond(ranPayload);

      await expect(runPromise).resolves.toEqual(ranPayload);
    });
```

The unwieldy `Parameters<...>` chain at the top of the test extracts the type of `onPaused`'s argument from the runner's public signature without re-importing `PausedResponse`. Keeps the test surface minimal.

- [ ] **Step 2: Run tests**

Run: `npm test`

Expected: 8 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/lib/machineRunner.test.ts
git commit -m "test(machineRunner): R-protocol-paused-then-ran (onPaused callback + run resolution)"
```

---

## Task 11: `S-step-paused-off / R-protocol-step-arming`

**Files:**
- Modify: `src/lib/machineRunner.test.ts`

- [ ] **Step 1: Add the cold-start step-arming test**

Append inside `describe('protocol shape')`:

```ts
    it('S-step-paused-off / R-protocol-step-arming: run({step:true}) posts step=true', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false });
      await buildPromise;

      const runPromise = runner.run({ step: true, debug: false });

      expect(current().last).toMatchObject({
        type: 'run',
        step: true,
        debug: false,
      });

      // Wrap up cleanly so the pending run doesn't leak between tests.
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
```

This test uses `toMatchObject` (not `toEqual`) because the `maxSteps` field is included by the runner (set to `MAX_STEPS` by default) and we don't care about its specific value here — only that `step: true` and `debug: false` cross the wire.

- [ ] **Step 2: Run tests**

Run: `npm test`

Expected: 9 tests pass.

(Note: this is one more test than the spec's "7 tests" target — the run-defaults and setDebug-no-worker subtests in T7 / T9 each added one extra. The spec's 7-test count was the headline scenario count; the actual `it()` count is 9. Both are correct per the spec's intent — every protocol facet locked down.)

- [ ] **Step 3: Commit**

```bash
git add src/lib/machineRunner.test.ts
git commit -m "test(machineRunner): S-step-paused-off / R-protocol-step-arming (cold-start step wire shape)"
```

---

## Task 12: Final verification

**Files:** none modified

- [ ] **Step 1: Type-check**

Run: `npm run check`

Expected: 0 errors, 0 warnings.

- [ ] **Step 2: Lint**

Run: `npm run lint`

Expected: exit 0.

- [ ] **Step 3: Build (sanity check that runtime code wasn't broken)**

Run: `npm run build`

Expected: build succeeds; `dist/` produced. Tests aren't part of the build, so this only verifies the production refactor (T3) is clean.

- [ ] **Step 4: Run all tests**

Run: `npm test`

Expected:

```
 Test Files  1 passed (1)
      Tests  9 passed (9)
```

- [ ] **Step 5: Coverage spot-check**

Run: `npm run test:coverage`

Expected: `src/lib/machineRunner.ts` shows partial coverage (the protocol-shape paths exercised; the timer, pending-overlap, and error paths still uncovered — those land in PR2). No coverage threshold is enforced; this is informational.

- [ ] **Step 6: Scenario-ID grep audit**

Run:

```bash
grep -oE '\b[SR]-[a-z-]+' src/lib/machineRunner.test.ts | sort -u
```

Expected: every cited ID is one of:
- `R-protocol-build`
- `R-protocol-step`
- `R-protocol-run`
- `R-protocol-run-defaults`
- `R-protocol-resume`
- `R-protocol-set-debug`
- `R-protocol-set-debug-no-worker`
- `R-protocol-paused-then-ran`
- `R-protocol-step-arming`
- `S-step-paused-off`

No typos, no orphans. Ten unique IDs across 9 tests (the cold-start test cites both `S-step-paused-off` and `R-protocol-step-arming`).

- [ ] **Step 7: No further commit needed**

If any of T1's grammar references or T11's compound ID didn't match, fix inline in the relevant file and amend that task's commit (don't create a "review fixes" commit — keep the per-task commit history clean).

---

## Self-review

**Spec coverage.** Each spec section maps to tasks:

- §Decisions and §Modes (ideal model) — captured in the plan's intro and file map.
- §Production refactor — T3.
- §FakeWorker and makeFakeFactory — T4.
- §Test pattern + naming — every test in T5–T11 follows the `R-...` / `S-...:` naming format.
- §The seven tests — covered across T5–T11 (with two split into sub-tests, hence 9 total).
- §Spec edit (§14 Scenario ID grammar lift) — T1.
- §Vitest config + §package.json updates — T2.
- §Out of scope items — explicitly not in any task.

**Placeholder scan.** No "TBD", "TODO", or "implement later". Every code step shows the actual code. Every command shows the expected output. No "similar to Task N" — code is repeated where helpful.

**Type / vocabulary consistency.** `MachineRunner`, `MachineWorkerLike`, `WorkerFactory`, `FakeWorker`, `makeFakeFactory`, `current()`, `all()`, `respond()`, `errorEvent()`, `last` — all named identically across the plan and the spec. Scenario IDs match the spec design's grammar (lowercase, hyphenated, `S-` and `R-` prefixes).

**Branch hygiene.** All commits land on the existing feature branch `47-test-infra-pr1` (which already has the spec design commit). Implementer must verify they're on that branch before T1; do not commit to master.
