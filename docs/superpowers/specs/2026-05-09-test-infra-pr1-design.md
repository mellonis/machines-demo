# Test infrastructure — PR1 (Vitest setup + machineRunner protocol tests) — design

Tracks: [#47](https://github.com/mellonis/machines-demo/issues/47) (test infrastructure). PR1 of an expected 4-PR series. Cites scenario IDs from `docs/execution-model.md`.

## Problem

The demo has no automated tests — only `svelte-check` and `eslint`. The Step-semantics churn during #40 would have been caught by even minimal tests of the worker protocol. #47 specifies four scopes: Vitest setup, `machineRunner` tests, `machineWorker` logic tests, component tests, plus a handful of Playwright E2E flows. That's a lot for one PR.

PR1 lands the **harness + the first test pattern** so the rest can be filled in mechanically by follow-up PRs. Specifically:

- Vitest config, npm scripts, dev dependencies.
- The seam that lets tests substitute the worker without invoking Vite's `?worker` plumbing (a small refactor of `MachineRunner`).
- A `FakeWorker` test double + helper factory.
- One category from #47's `machineRunner` test scope: **protocol shape** (request → response wire shapes).
- A grammar update to `docs/execution-model.md` introducing the `R-` scenario ID prefix for runner-internal scenarios.

The other three categories (timer, pending-slot, error wrapping) and the worker / component / E2E layers are explicitly out of scope here. Their patterns follow PR1's structure mechanically.

## Decisions

- **Scope: lean PR1.** Setup + harness + protocol-shape category only. Subsequent PRs (PR2/3/4) layer on the remaining categories. Choosing this over a single all-of-#47 PR because the harness/mock pattern is the contested part — getting it right with a small surface lets every follow-up be a copy-and-fill.
- **Test runner: Vitest.** Per #47, Vite-native, no extra config. Mirrors the existing build's tooling. No alternatives (Jest/Mocha) were seriously considered — Vite-native test runner is the obvious fit.
- **File layout: co-located.** Tests live next to the file under test (`src/lib/machineRunner.test.ts` next to `machineRunner.ts`). Vitest defaults pick these up. Co-located is the small-repo modern convention; keeps "open the dir, see code + tests together" ergonomics. A future `tests/` directory for E2E (PR4) doesn't conflict.
- **Worker mocking: factory injection (production-side change).** `MachineRunner` accepts an explicit `workerFactory: () => MachineWorkerLike` constructor argument. Production callers pass `() => new MachineWorker()`; tests pass `() => new FakeWorker()`. Chosen over `vi.mock`-of-`?worker`-import (fragile, ties tests to Vite plumbing) and over real-Worker spawning (slow, and the test surface still has to define a stub's protocol). One existing call site in `MachineView.svelte` updates to pass the factory.
- **Factory always returns a fresh fake.** Mirrors production: `MachineRunner.spawnWorker()` invokes the factory every `build()`. Sharing a single fake would conflate distinct worker sessions and break tests that exercise the supersede-on-rebuild path. Helper `makeFakeFactory()` exposes `current()` and `all()` for single-build and multi-build tests respectively.
- **Scenario ID convention: hybrid.** Runner tests cite `S-...` IDs where they map to a UI scenario, `R-...` IDs for runner-internal mechanics with no UI counterpart. Format `R-<topic>-<facet>` (lowercase, hyphenated). Follows the same `\b[SR]-[a-z-]+` grep contract as the spec's existing `S-` prefix. Both prefixes are documented in the execution-model spec's §Scenario ID grammar.
- **Test environment: `node`.** `MachineRunner` doesn't touch the DOM; runner tests don't need `happy-dom` or `jsdom`. Component tests (PR3) will need a DOM environment, but configuring it now is YAGNI.
- **No CI integration in PR1.** `npm test` runs locally; wiring it into the CD workflow's pre-build step is a separate small PR after PR1 lands and the test pattern is validated.

## File map

| File | Change | Roughly |
|---|---|---|
| `vitest.config.ts` | **Create** — minimal Vitest config (node env, explicit imports). | ~10 lines |
| `package.json` | **Modify** — add `vitest` + `@vitest/coverage-v8` to devDependencies; add `test`, `test:watch`, `test:coverage` scripts. | +2 deps, +3 scripts |
| `src/lib/machineRunner.ts` | **Modify** — add `MachineWorkerLike` interface + `WorkerFactory` type; constructor takes required `workerFactory`; drop `MachineWorker` import; `private worker: MachineWorkerLike \| null`. | ~15 lines net |
| `src/components/MachineView.svelte` | **Modify** — single callsite update: import `MachineWorker`, pass `() => new MachineWorker()` as second arg to `new MachineRunner(...)`. | ~3 lines |
| `src/lib/testUtils.ts` | **Create** — `FakeWorker` class + `makeFakeFactory()` helper. | ~70 lines |
| `src/lib/machineRunner.test.ts` | **Create** — 7 protocol-shape tests. | ~150 lines |
| `docs/execution-model.md` | **Modify** — append new §14 Scenario ID grammar (lift from meta-spec, includes both `S-` and `R-` rows from the start, plus conventions and "where IDs live" bullets). | ~30 lines |

## Production refactor — `MachineRunner` factory injection

Constructor signature changes from `constructor(engine: Engine)` to `constructor(engine: Engine, workerFactory: WorkerFactory)`. The factory is required (not optional) — production and tests both supply one explicitly, no asymmetry.

```ts
// src/lib/machineRunner.ts (no MachineWorker import — moves to the caller)
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

export interface MachineWorkerLike {
  postMessage(msg: WorkerRequest): void;
  terminate(): void;
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
}

export type WorkerFactory = () => MachineWorkerLike;

export class WorkerError extends Error { /* unchanged */ }

export class MachineRunner {
  readonly engine: Engine;
  private workerFactory: WorkerFactory;
  private worker: MachineWorkerLike | null = null;
  // ... existing private fields unchanged

  constructor(engine: Engine, workerFactory: WorkerFactory) {
    this.engine = engine;
    this.workerFactory = workerFactory;
  }

  private spawnWorker(): void {
    this.rejectAll(new Error('superseded by new worker'));
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.worker = this.workerFactory(); // ← was `new MachineWorker()`
    this.worker.onmessage = (e) => this.onMessage(e.data);
    this.worker.onerror = (e) => this.onWorkerError(e);
  }

  // ... rest of the class is identical (build / step / run / resume / setDebug / terminate)
}
```

Caller change in `MachineView.svelte` is one import + one constructor argument:

```ts
// before
import { MachineRunner } from '$lib/machineRunner';
const runner = new MachineRunner(engine);

// after
import MachineWorker from '$lib/machineWorker.ts?worker';
import { MachineRunner } from '$lib/machineRunner';
const runner = new MachineRunner(engine, () => new MachineWorker());
```

The Vite-specific `?worker` import suffix is now contained in `MachineView.svelte` (the only Svelte/Vite-specific module on the runner-construction path). `machineRunner.ts` becomes pure TypeScript with no build-tool dependency.

## `FakeWorker` and `makeFakeFactory()`

```ts
// src/lib/testUtils.ts
import type { MachineWorkerLike, WorkerFactory } from './machineRunner';
import type { WorkerRequest, WorkerResponse } from './types';

export class FakeWorker implements MachineWorkerLike {
  /** Every postMessage call captured in order. Tests assert against this. */
  postedMessages: WorkerRequest[] = [];

  /** Set by MachineRunner.spawnWorker. Tests trigger via respond() / errorEvent(). */
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;

  /** True after terminate() — postMessage on a terminated worker throws. */
  terminated = false;

  postMessage(msg: WorkerRequest): void {
    if (this.terminated) throw new Error('postMessage on terminated worker');
    this.postedMessages.push(msg);
  }

  terminate(): void {
    this.terminated = true;
  }

  // -- Test helpers (not part of the MachineWorkerLike interface) --

  /** Simulate a worker→main message. */
  respond(data: WorkerResponse): void {
    if (!this.onmessage) throw new Error('respond() before onmessage handler set');
    this.onmessage({ data } as MessageEvent<WorkerResponse>);
  }

  /** Simulate a worker-side error. */
  errorEvent(message: string): void {
    if (!this.onerror) throw new Error('errorEvent() before onerror handler set');
    this.onerror({ message } as ErrorEvent);
  }

  /** Most recent posted message — convenience for assertions. */
  get last(): WorkerRequest | undefined {
    return this.postedMessages[this.postedMessages.length - 1];
  }
}

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

Test patterns:

**Single-build test** — most common in the protocol-shape category:

```ts
const { factory, current } = makeFakeFactory();
const runner = new MachineRunner('turing', factory);
const buildPromise = runner.build('// user code');
expect(current().last).toEqual({ type: 'build', engine: 'turing', code: '// user code' });
current().respond({ type: 'built', tapes: [...], alphabets: [...], halted: false });
await buildPromise;
```

**Multi-build test** — for supersede-on-rebuild assertions (deferred to PR2 but the helper supports it):

```ts
const { factory, all } = makeFakeFactory();
const runner = new MachineRunner('turing', factory);
await runFirstBuild(runner, all);
const secondBuild = runner.build('// new code');
expect(all()[0].terminated).toBe(true);
all()[1].respond({ type: 'built', tapes: [...], ... });
await secondBuild;
```

## Test pattern + naming

**File**: `src/lib/machineRunner.test.ts`. Co-located with `machineRunner.ts`.

**Top-level structure**: a single `describe('MachineRunner', ...)` with category-named nested blocks.

```ts
import { describe, it, expect } from 'vitest';
import { MachineRunner, WorkerError } from './machineRunner';
import { makeFakeFactory } from './testUtils';

describe('MachineRunner', () => {
  describe('protocol shape', () => {
    it('R-protocol-build: posts {type:"build",engine,code} and resolves with BuiltResponse', async () => {
      // ...
    });
    // ...
  });
  // PR2/3 add `describe('timer', ...)`, `describe('pending', ...)`, `describe('error', ...)`.
});
```

**`it()` naming**: `'<scenario-id>: <one-line behavior>'`. Two flavors:

- **`R-...` ID** for runner-internal mechanics (most of PR1). Format `R-<topic>-<facet>`. Topic matches the `describe` block name (`protocol`, `timer`, `pending`, `error`); facet is a short descriptor.
- **`S-...` ID** when the test directly maps to a UI scenario from §10 of `docs/execution-model.md`. Rare in PR1's protocol category; one example: a test verifying `runner.run({ step: true })` posts `step: true` cites `S-step-paused-off` because that scenario relies on the runner's correct posting.

**Grep contract**: tests cite IDs via `\b[SR]-[a-z-]+`. CI / contributor docs grep this regex to find every cited scenario across `*.test.ts` files.

## The seven tests in PR1

Each test follows the single-build pattern above. Acceptance criteria are listed alongside.

1. **`R-protocol-build`** — `runner.build(code)` posts `{ type: 'build', engine, code }` and resolves with the `BuiltResponse` payload the fake responds with. Asserts that the worker is spawned via the factory.
2. **`R-protocol-step`** — after a build, `runner.step()` posts `{ type: 'step' }` and resolves with the `SteppedResponse` payload.
3. **`R-protocol-run`** — `runner.run({ maxSteps: 100, debug: true, step: false })` posts `{ type: 'run', maxSteps: 100, debug: true, step: false }`. The default behavior (`runner.run()` with no args) posts `{ type: 'run', maxSteps: MAX_STEPS, debug: false, step: false }`. Resolves with `RanResponse`.
4. **`R-protocol-resume`** — during a paused run, `runner.resume(true)` posts `{ type: 'resume', step: true }`; `runner.resume()` (default) posts `{ type: 'resume', step: false }`. The run Promise stays pending — resume is not directly resolving.
5. **`R-protocol-set-debug`** — `runner.setDebug(true)` posts `{ type: 'setDebug', on: true }`. Fire-and-forget; no Promise / no return value.
6. **`R-protocol-paused-then-ran`** — `runner.run({ onPaused })` invokes `onPaused(pausedPayload)` when the fake responds with a `paused` message, then resolves with `RanResponse` when the fake responds with a `ran` message. Asserts the onPaused payload matches what was sent.
7. **`S-step-paused-off / R-protocol-step-arming`** — `runner.run({ step: true })` posts `step: true` on the wire. Confirms the cold-start Step path's request shape. Cited under both prefixes because this is the runner-side contract for the user-facing `S-step-{idle,manual,halted}-off` scenarios.

Approximately 150 lines for the test file. ~20 lines per test on average (setup + send + assert + respond + assert).

**What's NOT covered in PR1** (each is a `describe` block that follows-up PRs add):

- `describe('timer')` — per-segment timeout fires after `WORKER_TIMEOUT_MS`; suspend on `paused`, restart on `resume`-send. **PR2.**
- `describe('pending')` — `simplePending` and `runPending` slots reject on overlap; supersede-on-rebuild rejects existing pending requests; `terminate()` clears both. **PR2.**
- `describe('error')` — worker-side `error` response wraps as `WorkerError` with `tapes` field; `error` during a `run` rejects the run Promise; `error` during a simple request rejects the simple Promise; `onerror` event invokes `rejectAll`. **PR2.**

## Spec edit — create §14 Scenario ID grammar in `docs/execution-model.md`

The deliverable currently has no scenario-ID grammar published — the grammar table from the meta-spec (`2026-05-08-execution-model-spec-design.md`) was never lifted across. PR1 lifts it as a new closing section §14, with both `S-` and `R-` prefixes documented from the start. Test authors hitting `S-...` or `R-...` IDs need a published reference; until now they had to read the meta-spec to find one.

The new section appends after §13 Cross-references:

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

Notes for the implementer:

- The lift is largely verbatim from the meta-spec's §Scenario ID grammar, with two updates: the `R-` prefix is included in the table from the start (no `+` diff), and the "Tests" bullet's wording mentions both prefixes.
- The grammar table grows two extra rows (`<topic>` and `<facet>`) over the meta-spec version to document `R-`'s structure. The `(S only)` / `(R only)` annotations clarify which slots apply to which prefix.
- After this section lands, the meta-spec's grammar block can be deleted in a follow-up cleanup (the deliverable now owns the canonical version), but PR1 leaves the meta-spec untouched to keep the diff focused.

## Vitest config

```ts
// vitest.config.ts
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

`globals: false` keeps tests free of magic globals — every test file imports `describe`, `it`, `expect` explicitly. `environment: 'node'` is sufficient for runner tests; component tests in PR3 will need to switch to `happy-dom` or `jsdom` (a future config split, not a PR1 concern).

## `package.json` updates

Add to `devDependencies` (entries to merge into the existing object):

```json
"vitest": "^2.1.0",
"@vitest/coverage-v8": "^2.1.0"
```

(Pin the major; minor/patch float. Vitest 2.x is current at time of writing; 3.x will likely require minor config changes when adopted.)

Add to `scripts` (entries to merge into the existing object):

```json
"test": "vitest run",
"test:watch": "vitest",
"test:coverage": "vitest run --coverage"
```

`vitest run` is the one-shot mode used in CI; `vitest` (no args) is watch mode for development.

## Out of scope (deferred)

- **Other `machineRunner` test categories** (timer, pending, error wrapping). PR2.
- **Worker-side logic tests.** PR2 of #47 — extracts pure helpers from `machineWorker.ts` and unit-tests those.
- **Component tests.** PR3 of #47 — `@testing-library/svelte` for Toolbar's `runLabel` derivation, button-disabled states, debug-toggle wiring.
- **Playwright E2E.** PR4 of #47 — happy paths through the full UI stack.
- **CI integration.** `npm test` is local-only in PR1. Wiring it into the CD workflow as a pre-build gate is a separate small PR after PR1 validates the harness.
- **Coverage thresholds.** No floor enforced in PR1. After PR2 lands the rest of `machineRunner` tests, threshold can be set realistically.
- **The `S-step-step-*` / `S-run-step-*` legacy IDs** mentioned in §11 of the execution-model spec — those describe today's RUNNING_STEP code path; tests for them would be skipped under #43's tracking and aren't worth writing in PR1.

## Self-review

After writing tests in implementation:

1. **Each `it()` name matches the `\b[SR]-[a-z-]+: <text>` pattern.** `grep -E 'it\(.*[SR]-' src/lib/machineRunner.test.ts` should match every test.
2. **Every cited scenario ID exists somewhere it's defined** — `S-` IDs in `docs/execution-model.md`'s matrix / cold-start / walk-throughs; `R-` IDs introduced by this PR follow the `R-<topic>-<facet>` format.
3. **No test depends on a real Worker.** `grep -n 'new Worker\|new MachineWorker' src/lib/machineRunner.test.ts` should match nothing.
4. **`MachineView.svelte` callsite still type-checks.** `npm run check` passes.
5. **All 7 tests pass.** `npm test` exits zero.

Fix any issues inline before declaring done.
