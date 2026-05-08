# Worker run() mode with onDebugBreak — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire v4's `onDebugBreak` into the demo's Run flow end-to-end, so user code that sets `state.debug` / `haltState.debug` pauses execution at break points with Continue / Step / Stop affordances. Track #40.

**Architecture:** Extend the worker's existing `run` request with an optional `debug` flag and break-pause support. Add `resume` request and `paused` response. New main-thread mode `RUNNING_PAUSED_AT_BREAK` with Continue/Step/Stop. A "Debug mode" checkbox in the Toolbar gates whether breaks pause; Step from break uses a `nextState.debug = { before: true }` one-shot trick (deferred via `onStep` for `after`-breaks). Worker gains a phase state machine (defense in depth).

**Tech Stack:** TypeScript, Svelte 5 (runes), Web Worker, `@turing-machine-js/machine` v4, Vite. No test framework — verification is `npm run check` + `npm run build` + `npm run lint` + manual smoke testing.

**Spec:** `docs/superpowers/specs/2026-05-08-worker-run-mode-design.md`

---

## File map

| File | Change |
|---|---|
| `src/lib/types.ts` | Extend `WorkerRequest` (`run.debug?`, new `resume`); add `PausedResponse`; add to `WorkerResponse` union |
| `src/lib/persist.ts` | Add `loadDebugMode` / `saveDebugMode` |
| `src/lib/machineWorker.ts` | Phase machine; `await machine.run({...})` replacing `runToEnd`; `paused` posting; `resume` handler; `pendingStepNext` flag for after-break step trick |
| `src/lib/machineRunner.ts` | Async run lifecycle: `onPaused` callback in `run()` opts, `resume(step?)` API, per-segment timer (suspend on `paused`, resume on `resume`-send) |
| `src/lib/defaultCode.ts` | One-line "don't run the machine" comment in all 3 snippets |
| `src/components/Toolbar.svelte` | Add "Debug mode" checkbox + `debugMode` prop |
| `src/components/MachineView.svelte` | New `RUNNING_PAUSED_AT_BREAK` mode; debugMode state + persist; paused handler with log replay; Continue/Step/Stop wiring; take-control log entry; `_runMirrorStep` async + `await` (line 258 fix) |
| `README.md` | "Architecture: two lands" — add `paused` / `resume` to wire shapes |

---

## Verification model

This codebase has no automated tests. Each task that changes code finishes with:

1. `npm run check` — `svelte-check` + `tsc --noEmit`. Must be 0 errors / 0 warnings.
2. `npm run lint` — ESLint flat config. Must exit 0.
3. `npm run build` — production build. Must succeed.

A final smoke-test task (Task 13) walks both engines through every UX path.

---

## Task 1: Extend worker boundary types

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Extend `WorkerRequest` and add `PausedResponse`**

In `src/lib/types.ts`, update the `WorkerRequest` union and add a new response type. Replace lines 48-51 (the `WorkerRequest` union) with:

```ts
export type WorkerRequest =
  | { type: 'build'; engine: Engine; code: string }
  | { type: 'step' }
  | { type: 'run'; maxSteps?: number; debug?: boolean }
  | { type: 'resume'; step?: boolean };
```

Add this `PausedResponse` shape immediately after `RanResponse` (around line 86, before `ErrorResponse`):

```ts
/**
 * Sent by the worker when `machine.run({ debug: true, ... })` hit a break
 * point (state.debug or haltState.debug). The main thread responds with a
 * `resume` request (optionally `step: true`) to continue, or terminates the
 * worker via the runner to stop. The worker's `run()` Promise stays pending
 * across paused/resume cycles; only `ran` / `error` complete it.
 */
export type PausedResponse = {
  type: 'paused';
  tapes: TapeSnapshot[];
  /**
   * Per-step commands buffered since the previous `paused` (or since the
   * `run` request started). The main thread replays these in the Log so the
   * user sees the trace leading up to the break; tape state is restored
   * from `tapes` (snap, no animation), same path as `ran`.
   */
  commands: Command[][];
  stepsApplied: number;
  /** `m.state.name` — the user's State instance does not cross the boundary. */
  state: string;
  currentSymbols: string[];
  /** At least one of `before` / `after` is `true`. Field shape mirrors the
   * upstream `m.debugBreak` type (omitted-key = false, never `undefined`). */
  debugBreak: { before?: true; after?: true };
};
```

Add `PausedResponse` to the `WorkerResponse` union (line 100-104):

```ts
export type WorkerResponse =
  | BuiltResponse
  | SteppedResponse
  | RanResponse
  | PausedResponse
  | ErrorResponse;
```

- [ ] **Step 2: Verify the type changes**

Run: `npm run check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "Worker types: add resume/paused, run.debug flag (#40)"
```

---

## Task 2: Persist debugMode

**Files:**
- Modify: `src/lib/persist.ts`

- [ ] **Step 1: Add load/save for debugMode**

In `src/lib/persist.ts`, add two functions after `saveExampleId` (around line 62):

```ts
export function loadDebugMode(engine: Engine): boolean {
  try {
    return localStorage.getItem(engineKey(engine, 'debugMode')) === 'true';
  } catch {
    return false;
  }
}

export function saveDebugMode(engine: Engine, on: boolean): void {
  try {
    localStorage.setItem(engineKey(engine, 'debugMode'), on ? 'true' : 'false');
  } catch {
    /* quota or private mode — ignore */
  }
}
```

- [ ] **Step 2: Verify**

Run: `npm run check && npm run lint`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/persist.ts
git commit -m "Persist debugMode per engine (#40)"
```

---

## Task 3: Worker — phase state machine and async run skeleton

**Files:**
- Modify: `src/lib/machineWorker.ts`

This is the largest single task. It does the structural rewrite without yet implementing the Step trick (Task 4).

- [ ] **Step 1: Replace the worker's runtime state and request loop**

Open `src/lib/machineWorker.ts`. Replace the runtime-state block (lines 96-114, "runtime state" through `function reset()`) with:

```ts
/* ───── runtime state ───── */

type WorkerPhase =
  | { kind: 'idle' }
  | { kind: 'built'; halted: boolean }
  | { kind: 'running' }
  | { kind: 'paused' };

let phase: WorkerPhase = { kind: 'idle' };
let machine: AnyMachine | null = null;
let initialState: unknown = null;
let tapes: AnyTape[] = [];
let generator: Generator<MachineYield, void, void> | null = null;
let stepsApplied = 0;
let pendingCommand: MachineYield | null = null;

// Holds the resolver of the Promise awaited inside onDebugBreak. Set when
// the worker is paused at a break; cleared on `resume`. Concurrent `run`
// requests are rejected by the phase machine before they reach this slot.
let resumeResolve: ((action: { step: boolean }) => void) | null = null;

// Per-run buffer of commands captured by onStep. Drained on `paused` (sent
// in the response) and on `ran` (sent in the response).
let runCommandBuffer: Command[][] = [];
let runStartStep = 0;

function reset(): void {
  phase = { kind: 'idle' };
  machine = null;
  initialState = null;
  tapes = [];
  generator = null;
  stepsApplied = 0;
  pendingCommand = null;
  resumeResolve = null;
  runCommandBuffer = [];
  runStartStep = 0;
}

function expectPhase(...allowed: WorkerPhase['kind'][]): void {
  if (!allowed.includes(phase.kind)) {
    throw new Error(
      `worker phase ${phase.kind}, expected ${allowed.join('|')}`,
    );
  }
}
```

- [ ] **Step 2: Update `build()` to set the phase**

In the same file, modify `build()` (around line 153). After the existing `generator = machine.runStepByStep(...)` block (the `if (first.done)` check around line 207-212), set the phase:

```ts
  generator = machine.runStepByStep({ initialState });
  const first = generator.next();
  if (first.done) {
    phase = { kind: 'built', halted: true };
    pendingCommand = null;
  } else {
    phase = { kind: 'built', halted: false };
    pendingCommand = first.value;
  }
}
```

(Replace the `halted = true; pendingCommand = null;` and `halted = false; ...` legacy lines — `halted` is no longer a separate field; phase carries it.)

- [ ] **Step 3: Update `step()` to use phase**

Replace `function step()` (around line 215-230) with:

```ts
function step(): { commands: Command[] | null; nextCommands: Command[] | null; halted: boolean } {
  expectPhase('built');
  const built = phase as Extract<WorkerPhase, { kind: 'built' }>;
  if (built.halted || !pendingCommand || !generator) {
    return { commands: null, nextCommands: null, halted: true };
  }
  const commands = commandsFromYield(pendingCommand);
  const r = generator.next();
  stepsApplied += 1;
  let halted: boolean;
  if (r.done) {
    halted = true;
    pendingCommand = null;
  } else {
    halted = false;
    pendingCommand = r.value;
  }
  phase = { kind: 'built', halted };
  const nextCommands = pendingCommand ? commandsFromYield(pendingCommand) : null;
  return { commands, nextCommands, halted };
}
```

- [ ] **Step 4: Replace `runToEnd` with async `run`**

Delete `runToEnd` (around line 232-250) and replace with:

```ts
async function run(maxSteps: number, debug: boolean): Promise<{ truncated: boolean; startStep: number }> {
  expectPhase('built');
  const built = phase as Extract<WorkerPhase, { kind: 'built' }>;
  if (built.halted || !machine) throw new Error('cannot run: halted or not built');

  // Initial-yield handling: build() always primes pendingCommand. We discard
  // the engine's runStepByStep generator and start a fresh `run()` from the
  // current initial state — the engine handles its own iteration internally.
  generator = null;
  pendingCommand = null;

  runStartStep = stepsApplied;
  runCommandBuffer = [];
  phase = { kind: 'running' };

  let truncated = false;

  try {
    await machine.run({
      initialState,
      stepsLimit: maxSteps,
      onStep: (m: MachineYield) => {
        runCommandBuffer.push(commandsFromYield(m));
        stepsApplied += 1;
      },
      onDebugBreak: debug
        ? async (m: DebugBreakPayload) => {
            // Send the buffered run-segment so far, then wait for resume.
            const commandsBatch = runCommandBuffer;
            runCommandBuffer = [];
            phase = { kind: 'paused' };
            send({
              type: 'paused',
              tapes: snapshotTapes(),
              commands: commandsBatch,
              stepsApplied,
              state: m.state.name ?? '',
              currentSymbols: [...m.currentSymbols],
              debugBreak: { ...m.debugBreak } as { before?: true; after?: true },
            });
            await new Promise<void>((resolve) => {
              resumeResolve = (_action) => {
                resumeResolve = null;
                resolve();
              };
            });
            phase = { kind: 'running' };
          }
        : undefined,
    });
  } catch (err) {
    // The engine throws when its stepsLimit counter is reached. Check the
    // counter at catch time — more reliable than a flag set in onStep
    // (engine may throw before the flag-setting iteration's onStep runs).
    if (stepsApplied - runStartStep >= maxSteps) {
      truncated = true;
      // fall through, send `ran` with truncated: true
    } else {
      // Reset phase before rethrow so the catch in onmessage sees a known
      // state. tapes still hold partial state (existing error path).
      phase = { kind: 'built', halted: false };
      throw err;
    }
  }

  phase = { kind: 'built', halted: true };
  return { truncated, startStep: runStartStep };
}
```

You'll need to add a `MachineYield`-compatible type for `onStep`/`onDebugBreak` payloads. Above the `runtime state` block, add:

```ts
// onDebugBreak payload subset we read. Engine's full type carries more.
type DebugBreakPayload = {
  state: { name?: string };
  currentSymbols: string[];
  nextState: { debug: { before?: true; after?: true } | null };
  debugBreak?: { before?: true; after?: true };
};
```

(The `MachineYield` already exists in this file; it's the engine's per-step yield. We're treating onStep as receiving a `MachineYield`-like object.)

- [ ] **Step 5: Wire `run` and `resume` into the request handler**

Replace the request-handling block (around line 256-315, the `self.onmessage` body) with:

```ts
function send(msg: WorkerResponse): void {
  self.postMessage(msg);
}

self.onmessage = (e: MessageEvent<unknown>) => {
  const msg = e.data;
  if (!msg || typeof msg !== 'object' || !('type' in msg)) {
    send({ type: 'error', message: 'malformed worker message' });
    return;
  }

  const req = msg as WorkerRequest;
  void handleRequest(req);
};

async function handleRequest(req: WorkerRequest): Promise<void> {
  try {
    if (req.type === 'build') {
      build(req.engine, req.code);
      const built = phase as Extract<WorkerPhase, { kind: 'built' }>;
      send({
        type: 'built',
        tapes: snapshotTapes(),
        alphabets: snapshotAlphabets(),
        halted: built.halted,
      });
      return;
    }

    if (req.type === 'step') {
      const { commands, nextCommands, halted } = step();
      send({
        type: 'stepped',
        halted,
        commands,
        nextCommands,
        stepsApplied,
      });
      return;
    }

    if (req.type === 'run') {
      const { truncated, startStep } = await run(req.maxSteps ?? MAX_STEPS, req.debug ?? false);
      send({
        type: 'ran',
        tapes: snapshotTapes(),
        truncated,
        commands: runCommandBuffer,
        startStep,
        stepsApplied,
      });
      runCommandBuffer = [];
      return;
    }

    if (req.type === 'resume') {
      expectPhase('paused');
      const r = resumeResolve;
      if (!r) throw new Error('resume: no pending Promise');
      r({ step: req.step ?? false });
      return;
    }

    throw new Error(`unknown message type: ${(req as { type: string }).type}`);
  } catch (err) {
    send({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
      tapes: tapes.length > 0 ? snapshotTapes() : undefined,
    });
  }
}
```

- [ ] **Step 6: Verify**

Run: `npm run check`
Expected: 0 errors, 0 warnings. If `MachineYield` typing complains for `onStep`, cast at the call site (`m as MachineYield`).

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/lib/machineWorker.ts
git commit -m "Worker: phase machine + async run with onDebugBreak (#40)"
```

---

## Task 4: Worker — Step from break (`nextState.debug` trick)

**Files:**
- Modify: `src/lib/machineWorker.ts`

Adds the deferred-onStep coordination so Step from `RUNNING_PAUSED_AT_BREAK` advances exactly one iteration.

- [ ] **Step 1: Add step-trick state and onStep deferral**

In `src/lib/machineWorker.ts`, add two module-level slots near `resumeResolve`:

```ts
let pendingStepNext = false;
let pendingRestore: (() => void) | null = null;
```

Reset both in `reset()`:

```ts
function reset(): void {
  // ... existing resets ...
  pendingStepNext = false;
  pendingRestore = null;
}
```

- [ ] **Step 2: Wire onStep to apply the deferred trick**

Inside `run()`, replace the `onStep` callback in the `machine.run({...})` call with:

```ts
onStep: (m: MachineYield & { nextState?: { debug: { before?: true } | null } }) => {
  if (pendingStepNext && m.nextState) {
    const ns = m.nextState as { debug: { before?: true } | null };
    const original = ns.debug;
    ns.debug = { before: true };
    pendingRestore = () => { ns.debug = original; };
    pendingStepNext = false;
  }
  runCommandBuffer.push(commandsFromYield(m));
  stepsApplied += 1;
},
```

- [ ] **Step 3: Wire onDebugBreak to consume `step` action and arm the trick**

Inside `run()`, replace the existing `onDebugBreak` callback with:

```ts
onDebugBreak: debug
  ? async (m: DebugBreakPayload) => {
      // Restore the synthesized one-shot before the user observes the break.
      if (pendingRestore) {
        pendingRestore();
        pendingRestore = null;
      }
      const commandsBatch = runCommandBuffer;
      runCommandBuffer = [];
      phase = { kind: 'paused' };
      send({
        type: 'paused',
        tapes: snapshotTapes(),
        commands: commandsBatch,
        stepsApplied,
        state: m.state.name ?? '',
        currentSymbols: [...m.currentSymbols],
        debugBreak: { ...m.debugBreak } as { before?: true; after?: true },
      });
      const action = await new Promise<{ step: boolean }>((resolve) => {
        resumeResolve = (a) => {
          resumeResolve = null;
          resolve(a);
        };
      });
      phase = { kind: 'running' };
      if (action.step) {
        if (m.debugBreak?.before) {
          // m IS the current iteration — arm directly.
          // onStep deferral path: when an `after` break fires, the engine
          // substitutes m to prevYield in onDebugBreak, so the un-substituted
          // machineState reaches us only via the next onStep call. If
          // turing-machine-js#107 lands (escape hatch for un-substituted
          // snapshot), this branch and pendingStepNext can collapse.
          const ns = m.nextState as { debug: { before?: true } | null };
          const original = ns.debug;
          ns.debug = { before: true };
          pendingRestore = () => { ns.debug = original; };
        } else {
          pendingStepNext = true;
        }
      }
    }
  : undefined,
```

- [ ] **Step 4: Verify**

Run: `npm run check && npm run lint && npm run build`
Expected: all clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/machineWorker.ts
git commit -m "Worker: Step from break via nextState.debug trick (#40)"
```

---

## Task 5: Runner — async run lifecycle, onPaused callback, resume API

**Files:**
- Modify: `src/lib/machineRunner.ts`

- [ ] **Step 1: Update imports and add Pending shape for runs**

In `src/lib/machineRunner.ts`, replace the imports block with:

```ts
import MachineWorker from './machineWorker.ts?worker';
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

- [ ] **Step 2: Replace single-pending model with run-aware tracking**

Replace the `Pending` type and the `MachineRunner` class body (everything from line 29 to end of file) with:

```ts
type SimplePending = {
  resolve: (data: WorkerResponse) => void;
  reject: (err: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

type RunPending = {
  resolveRan: (data: RanResponse) => void;
  reject: (err: Error) => void;
  timeoutId: ReturnType<typeof setTimeout> | null;
  onPaused: ((data: PausedResponse) => void) | null;
};

export class MachineRunner {
  readonly engine: Engine;
  private worker: Worker | null = null;
  private simplePending: SimplePending | null = null;
  private runPending: RunPending | null = null;

  constructor(engine: Engine) {
    this.engine = engine;
  }

  private rejectAll(err: Error): void {
    if (this.simplePending) {
      clearTimeout(this.simplePending.timeoutId);
      this.simplePending.reject(err);
      this.simplePending = null;
    }
    if (this.runPending) {
      if (this.runPending.timeoutId) clearTimeout(this.runPending.timeoutId);
      this.runPending.reject(err);
      this.runPending = null;
    }
  }

  private spawnWorker(): void {
    this.rejectAll(new Error('superseded by new worker'));
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.worker = new MachineWorker();
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.onMessage(e.data);
    this.worker.onerror = (e) => this.onWorkerError(e);
  }

  private startRunTimer(): void {
    if (!this.runPending) return;
    if (this.runPending.timeoutId) clearTimeout(this.runPending.timeoutId);
    this.runPending.timeoutId = setTimeout(() => {
      const p = this.runPending;
      this.runPending = null;
      if (this.worker) {
        this.worker.terminate();
        this.worker = null;
      }
      p?.reject(new Error(`timeout after ${WORKER_TIMEOUT_MS}ms — worker terminated (likely infinite loop)`));
    }, WORKER_TIMEOUT_MS);
  }

  private stopRunTimer(): void {
    if (!this.runPending) return;
    if (this.runPending.timeoutId) {
      clearTimeout(this.runPending.timeoutId);
      this.runPending.timeoutId = null;
    }
  }

  private onMessage(data: WorkerResponse): void {
    // `paused` is the only response that doesn't complete a Promise.
    if (data.type === 'paused') {
      if (!this.runPending) return;
      this.stopRunTimer();
      this.runPending.onPaused?.(data);
      return;
    }
    // ran completes the run.
    if (data.type === 'ran') {
      const p = this.runPending;
      this.runPending = null;
      if (!p) return;
      // Clear timer via captured local — stopRunTimer() guards on
      // !this.runPending and would no-op here.
      if (p.timeoutId) clearTimeout(p.timeoutId);
      p.resolveRan(data);
      return;
    }
    if (data.type === 'error') {
      const err = new WorkerError(data.message, data.tapes ?? null);
      if (this.runPending) {
        const p = this.runPending;
        this.runPending = null;
        if (p.timeoutId) clearTimeout(p.timeoutId);
        p.reject(err);
        return;
      }
      if (this.simplePending) {
        const p = this.simplePending;
        this.simplePending = null;
        clearTimeout(p.timeoutId);
        p.reject(err);
        return;
      }
      return;
    }
    // built / stepped
    if (this.simplePending) {
      const p = this.simplePending;
      this.simplePending = null;
      clearTimeout(p.timeoutId);
      p.resolve(data);
    }
  }

  private onWorkerError(e: ErrorEvent): void {
    this.rejectAll(new Error(`worker error: ${e.message ?? 'unknown'}`));
  }

  private sendSimple(msg: WorkerRequest): Promise<WorkerResponse> {
    if (!this.worker) throw new Error('worker not spawned — call build() first');
    if (this.simplePending || this.runPending) throw new Error('previous request still pending');

    return new Promise<WorkerResponse>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.simplePending = null;
        if (this.worker) {
          this.worker.terminate();
          this.worker = null;
        }
        reject(new Error(`timeout after ${WORKER_TIMEOUT_MS}ms — worker terminated (likely infinite loop)`));
      }, WORKER_TIMEOUT_MS);
      this.simplePending = { resolve, reject, timeoutId };
      this.worker!.postMessage(msg);
    });
  }

  async build(code: string): Promise<BuiltResponse> {
    this.spawnWorker();
    const r = await this.sendSimple({ type: 'build', engine: this.engine, code });
    if (r.type !== 'built') throw new Error(`unexpected response: ${r.type}`);
    return r;
  }

  async step(): Promise<SteppedResponse> {
    const r = await this.sendSimple({ type: 'step' });
    if (r.type !== 'stepped') throw new Error(`unexpected response: ${r.type}`);
    return r;
  }

  /**
   * Async run with optional break-pause support. Returns when the worker
   * sends `ran` (halt or stepsLimit). If `debug` is true and a break fires,
   * `onPaused` is called; the consumer must call `resume()` to continue.
   * The Promise stays pending across paused/resume cycles.
   */
  run(opts: {
    maxSteps?: number;
    debug?: boolean;
    onPaused?: (data: PausedResponse) => void;
  } = {}): Promise<RanResponse> {
    if (!this.worker) throw new Error('worker not spawned — call build() first');
    if (this.simplePending || this.runPending) throw new Error('previous request still pending');

    return new Promise<RanResponse>((resolveRan, reject) => {
      this.runPending = {
        resolveRan,
        reject,
        timeoutId: null,
        onPaused: opts.onPaused ?? null,
      };
      this.startRunTimer();
      this.worker!.postMessage({
        type: 'run',
        maxSteps: opts.maxSteps ?? MAX_STEPS,
        debug: opts.debug ?? false,
      });
    });
  }

  /** Send a `resume` to a paused worker. Reactivates the round-trip timer. */
  resume(step: boolean = false): void {
    if (!this.runPending) throw new Error('resume: no pending run');
    if (!this.worker) throw new Error('resume: worker terminated');
    this.startRunTimer();
    this.worker.postMessage({ type: 'resume', step });
  }

  terminate(): void {
    this.rejectAll(new Error('runner terminated'));
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
```

(Keep the `WorkerError` class above — it's unchanged.)

- [ ] **Step 3: Verify**

Run: `npm run check && npm run lint && npm run build`
Expected: all clean. The runner has no consumers using the old `run()` signature aside from `MachineView.svelte` (Task 8 updates it).

- [ ] **Step 4: Commit**

```bash
git add src/lib/machineRunner.ts
git commit -m "Runner: async run with onPaused callback + resume API (#40)"
```

---

## Task 6: Add "Debug mode" checkbox to Toolbar

**Files:**
- Modify: `src/components/Toolbar.svelte`

- [ ] **Step 1: Find the existing `with pause` checkbox markup**

Run: `grep -n "withPause\|with pause" src/components/Toolbar.svelte | head -10`

Note the line numbers — the checkbox markup will be a `<label class="checkbox">` block with `bind:checked={withPause}`.

- [ ] **Step 2: Add `debugMode` prop and matching checkbox**

In the `<script>` block of `src/components/Toolbar.svelte`, find the `Props` type and the `let { ... }: Props = $props()` destructure. Add `debugMode` (boolean, bindable) alongside `withPause`. Example:

```ts
type Props = {
  // ... existing props ...
  withPause: boolean;
  debugMode: boolean;
  // ... existing props ...
};

let {
  // ... existing destructures ...
  withPause = $bindable(),
  debugMode = $bindable(),
  // ... existing destructures ...
}: Props = $props();
```

In the markup, immediately after the `with pause` checkbox `<label>`, add:

```svelte
<label class="checkbox" title="When on, breaks set via state.debug pause execution at a Continue/Step prompt.">
  <input type="checkbox" bind:checked={debugMode} />
  debug
</label>
```

- [ ] **Step 3: Verify**

Run: `npm run check`
Expected: 0 errors. Note that `MachineView.svelte` will not yet be passing `debugMode` — the prop default in `$bindable()` covers that until Task 8 wires it.

Run: `npm run lint`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/Toolbar.svelte
git commit -m "Toolbar: add 'debug' checkbox (#40)"
```

---

## Task 7: MachineView — `debugMode` state + `RUNNING_PAUSED_AT_BREAK` mode

**Files:**
- Modify: `src/components/MachineView.svelte`

- [ ] **Step 1: Add `RUNNING_PAUSED_AT_BREAK` to the mode union**

In `src/components/MachineView.svelte`, replace the `ExecutionMode` type (around line 49-55) with:

```ts
type ExecutionMode =
  | 'DEMO'
  | 'MANUAL'
  | 'RUNNING_STEP'
  | 'RUNNING_AUTO'
  | 'RUNNING_CONTINUOUS'
  | 'RUNNING_PAUSED_AT_BREAK'
  | 'HALTED';
```

- [ ] **Step 2: Add `debugMode` state with persistence**

Add the import for the new persist helpers — find the `from './persist.ts'` block (around lines 21-30) and extend it:

```ts
import {
  loadCode,
  loadExampleId,
  saveExampleId,
  loadSnippets,
  saveSnippet,
  deleteSnippet,
  renameSnippet,
  loadDebugMode,
  saveDebugMode,
  type Snippets,
} from '../lib/persist.ts';
```

After the existing `let withPause = $state(false);` line (around line 71), add:

```ts
let debugMode = $state<boolean>(untrack(() => loadDebugMode(engine)));

$effect(() => {
  saveDebugMode(engine, debugMode);
});
```

- [ ] **Step 3: Update derived flags to include `RUNNING_PAUSED_AT_BREAK`**

Find the `takeControlVisible` derivation (around line 141-143) and update it to hide Take Control while paused at break:

```ts
const takeControlVisible = $derived(
  executionMode !== 'MANUAL' &&
  executionMode !== 'RUNNING_CONTINUOUS' &&
  executionMode !== 'RUNNING_PAUSED_AT_BREAK',
);
```

Find `beltTransitionsOn` (line 144) and update so transitions are also off while paused at break (snap-style mirror reload):

```ts
const beltTransitionsOn = $derived(
  executionMode !== 'RUNNING_CONTINUOUS' &&
  executionMode !== 'RUNNING_PAUSED_AT_BREAK',
);
```

Find `runDisabled` (line 172-178) and update so a run from `RUNNING_PAUSED_AT_BREAK` is allowed (it routes to Continue, see Task 9):

```ts
const runDisabled = $derived(
  pendingOp !== null ||
    !workerLive ||
    executionMode === 'RUNNING_AUTO' ||
    executionMode === 'RUNNING_CONTINUOUS' ||
    (withPause && !intervalIsValid),
);
// (No `RUNNING_PAUSED_AT_BREAK` here — Run becomes Continue while paused.)
```

Find `stepDisabled` (line 164-168) and ensure Step is enabled while paused at break:

```ts
const stepDisabled = $derived(
  pendingOp !== null ||
    !workerLive ||
    executionMode === 'RUNNING_CONTINUOUS',
);
// (`RUNNING_PAUSED_AT_BREAK` — Step is enabled and sends resume {step: true}.)
```

Add a derivation for the run-button shape (label + handler dispatch in Task 9):

```ts
const isPaused = $derived(executionMode === 'RUNNING_PAUSED_AT_BREAK');
```

- [ ] **Step 4: Verify**

Run: `npm run check && npm run lint`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/MachineView.svelte
git commit -m "MachineView: RUNNING_PAUSED_AT_BREAK mode + debugMode state (#40)"
```

---

## Task 8: MachineView — wire Toolbar `debugMode` + line 258 await fix

**Files:**
- Modify: `src/components/MachineView.svelte`

- [ ] **Step 1: Pass `debugMode` to Toolbar**

Find the `<Toolbar ...>` instantiation in the markup (around line 641-674). Add `bind:debugMode` alongside `bind:withPause`. Example:

```svelte
<Toolbar
  ...
  bind:withPause
  bind:debugMode
  ...
/>
```

- [ ] **Step 2: Make `_runMirrorStep` async + await `mirrorMachine.run`**

Replace `_runMirrorStep` (around line 244-259) with:

```ts
async function _runMirrorStep(commands: Command[]): Promise<void> {
  if (!mirrorMachine || !mirrorTapeBlock) return;
  const oneStep = new turing.State({
    [turing.ifOtherSymbol]: {
      command: commands.map((command) => ({
        symbol: command.symbol !== null ? command.symbol : turing.symbolCommands.keep,
        movement:
          command.movement === 'L' ? turing.movements.left
          : command.movement === 'R' ? turing.movements.right
          : turing.movements.stay,
      })),
      nextState: turing.haltState,
    },
  });
  await mirrorMachine.run({ initialState: oneStep });
}
```

Replace `renderFromMirror` (around line 275-284) to await the mirror step:

```ts
async function renderFromMirror(commands: Command[], animate: boolean): Promise<void> {
  if (!mirrorTapeBlock) return;
  await _runMirrorStep(commands);
  mirrorTapeBlock.tapes.forEach((tape, i) => {
    const command = commands[i];
    const delta = (command?.movement === 'L' ? -1 : command?.movement === 'R' ? 1 : 0) as -1 | 0 | 1;
    const wrote = command != null && command.symbol !== null;
    tapesStackRef?.setFromTape(i, tape, delta, animate, wrote);
  });
}
```

Find every caller of `renderFromMirror` and add `await` (or `void` if intentionally fire-and-forget). Likely call sites:
- `doStep()` around line 400
- `onApply()` around line 472 (`renderFromMirror(commands, true);`)
- The demo loop and auto-step `$effect`s

For each, change to `await renderFromMirror(...)` if inside an async function, otherwise wrap in `void (async () => { await renderFromMirror(...); })()`.

- [ ] **Step 3: Verify**

Run: `npm run check`
Expected: 0 errors. If TS complains about a non-async caller missing `await`, either make the caller async or use the `void`-wrapped pattern.

- [ ] **Step 4: Commit**

```bash
git add src/components/MachineView.svelte
git commit -m "MachineView: wire debugMode prop + await mirrorMachine.run (#40)"
```

---

## Task 9: MachineView — paused handler, Continue/Step, log entry

**Files:**
- Modify: `src/components/MachineView.svelte`

This task wires the runner's `onPaused` callback into the UI and adds Continue/Step button dispatch.

- [ ] **Step 1: Add `onPausedHandler` and update `doRun`**

In `src/components/MachineView.svelte`, find `doRun()` (around line 408). Replace the `runner.run()` call site. The full updated `doRun()` body, replacing the `if (withPause) { ... }` branch and the post-reload `runner.run()` block:

```ts
async function doRun(): Promise<void> {
  // RUNNING_PAUSED_AT_BREAK → treat Run click as Continue.
  if (executionMode === 'RUNNING_PAUSED_AT_BREAK') {
    runner.resume(false);
    executionMode = 'RUNNING_CONTINUOUS';
    return;
  }

  if (withPause) {
    // Resume auto-stepping from current RUNNING_STEP position without reload.
    if (executionMode !== 'RUNNING_STEP') {
      reportSeparator();
      report('loading…');
      const ok = await reloadWorker();
      if (!ok) {
        executionMode = userTookControl ? 'MANUAL' : 'DEMO';
        return;
      }
    }
    executionMode = 'RUNNING_AUTO';
    codeChangedWarned = false;
    report(`auto-stepping every ${intervalMs}ms`);
    return;
  }

  reportSeparator();
  report('loading…');
  const ok = await reloadWorker();
  if (!ok) {
    executionMode = userTookControl ? 'MANUAL' : 'DEMO';
    return;
  }
  reflectNeutral();
  executionMode = 'RUNNING_CONTINUOUS';
  report('running…');
  pendingOp = 'run';
  try {
    const res = await runner.run({
      maxSteps: undefined,
      debug: debugMode,
      onPaused: (paused) => onPausedHandler(paused),
    });
    lastSnapshots = res.tapes;
    _buildMirrorMachine(res.tapes, alphabets);
    setAllFromMirror();
    halted = true;
    reflectNeutral();
    if (res.commands.length > 0) {
      appendBatch(
        res.commands.map((commands, i) =>
          commandsEntry(commands, { stepNumber: res.startStep + i + 1 }, CARET_COLORS),
        ),
      );
    }
    if (res.truncated) {
      report(`truncated at ${res.stepsApplied} steps (limit hit)`, 'warn');
    } else {
      report(`halted after ${res.stepsApplied} step(s)`, 'ok');
    }
    executionMode = 'HALTED';
  } catch (err) {
    failHalted(err);
  } finally {
    pendingOp = null;
  }
}
```

- [ ] **Step 2: Add `onPausedHandler`**

Add a new function above `doRun` (or anywhere within the script block):

```ts
function onPausedHandler(paused: import('../lib/types.ts').PausedResponse): void {
  // Replay buffered per-step commands so the trace leading to the break is visible.
  if (paused.commands.length > 0) {
    const startStep = paused.stepsApplied - paused.commands.length;
    appendBatch(
      paused.commands.map((commands, i) =>
        commandsEntry(commands, { stepNumber: startStep + i + 1 }, CARET_COLORS),
      ),
    );
  }
  // Snap mirror to break-time tapes (no animation).
  lastSnapshots = paused.tapes;
  _buildMirrorMachine(paused.tapes, alphabets);
  setAllFromMirror();
  // Format the break log entry. Engine's run() dispatches onDebugBreak
  // separately for before/after — exactly one is true at the wire.
  const kind = paused.debugBreak.before ? 'before' : 'after';
  const symbols = paused.currentSymbols.join(' ');
  report(`paused at ${paused.state || '(unnamed)'} [${kind}]: ${symbols}`, 'ok');
  executionMode = 'RUNNING_PAUSED_AT_BREAK';
}
```

- [ ] **Step 3: Update Step button to send `resume { step: true }` when paused**

Find `doStep()` (around line 354). Add a branch at the top:

```ts
async function doStep(): Promise<void> {
  // RUNNING_PAUSED_AT_BREAK → Step click means "advance one iteration in the
  // run, then re-pause". Send resume with step flag; worker will arm the
  // nextState.debug trick.
  if (executionMode === 'RUNNING_PAUSED_AT_BREAK') {
    runner.resume(true);
    // Phase will be set by the next `paused` (or `ran` if the synthesized
    // step happens to land on halt).
    return;
  }

  // ... existing body unchanged ...
}
```

- [ ] **Step 4: Update Stop button to terminate worker on paused-at-break**

Find `stopMachine()` (around line 316). Replace with:

```ts
function stopMachine(): void {
  if (executionMode === 'RUNNING_PAUSED_AT_BREAK') {
    // Pending run Promise will reject when we terminate; failHalted in the
    // caller's catch sets the rest. We pre-empt the message here.
    runner.terminate();
    workerLive = false;
  }
  executionMode = 'HALTED';
  report('stopped', 'warn');
}
```

- [ ] **Step 5: Verify**

Run: `npm run check && npm run lint && npm run build`
Expected: 0 errors. If TS complains about `import('../lib/types.ts').PausedResponse` — change to a top-level import:

```ts
import { type Alphabets, type Command, type Engine, type PausedResponse, type TapeSnapshot } from '../lib/types.ts';
```

(Update the existing `from '../lib/types.ts'` import line.)

- [ ] **Step 6: Commit**

```bash
git add src/components/MachineView.svelte
git commit -m "MachineView: paused-at-break handler + Continue/Step (#40)"
```

---

## Task 10: MachineView — log Take Control

**Files:**
- Modify: `src/components/MachineView.svelte`

- [ ] **Step 1: Add `report` call in `takeControl()`**

Find `takeControl()` (around line 465). Add a report line at the start:

```ts
function takeControl(): void {
  report('user took control', 'ok');
  userTookControl = true;
  executionMode = 'MANUAL';
  reflectNeutral();
}
```

- [ ] **Step 2: Verify**

Run: `npm run check`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/MachineView.svelte
git commit -m "MachineView: log 'user took control' (#40)"
```

---

## Task 11: Default snippets — "don't run the machine" comment

**Files:**
- Modify: `src/lib/defaultCode.ts`

- [ ] **Step 1: Update all 3 snippet headers**

In `src/lib/defaultCode.ts`, find each snippet's header comment block. For each (TURING_REPLACE_B around line 9-22, TURING_COPY_TWO_TAPES around line 45-59, POST_WALK_MARK around line 94-103), append a line to the comment block before the closing `*/`:

For `TURING_REPLACE_B`, change:
```
 * Return: { machine, initialState, tape }
 */
```

to:
```
 * Return: { machine, initialState, tape }
 *
 * Note: the demo runs the machine; do not call .run() or .runStepByStep() yourself.
 */
```

Apply the same line addition (with appropriate Return-shape preservation) to `TURING_COPY_TWO_TAPES` (`Return: { machine, initialState }`) and `POST_WALK_MARK` (`Return: { machine }`).

- [ ] **Step 2: Verify**

Run: `npm run check && npm run lint && npm run build`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/lib/defaultCode.ts
git commit -m "Default snippets: don't run the machine yourself (#40)"
```

---

## Task 12: README — wire shape update

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the wire-shape lines in the Architecture section**

In `README.md`, find the `requests:` and `responses:` lines inside the ASCII diagram block. Replace:

```
        requests:   build / step / run
        responses:  built / stepped / ran / error
```

with:

```
        requests:   build / step / run / resume
        responses:  built / stepped / ran / paused / error
```

Update the prose immediately after the diagram. Replace:

> **Crosses the boundary:** `TapeSnapshot[]` (on `built` / `ran` / `error`), per-step `Command[]` (movement + written symbol), tape alphabets — plain data only.

with:

> **Crosses the boundary:** `TapeSnapshot[]` (on `built` / `ran` / `error` / `paused`), per-step `Command[]` (movement + written symbol), tape alphabets, plus break metadata (state name, current symbols, `debugBreak` flags) on `paused` — plain data only.

- [ ] **Step 2: Verify**

Run: `npm run build`
Expected: succeeds (README isn't checked by svelte-check, but build sanity-checks).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "README: add resume/paused to the architecture diagram (#40)"
```

---

## Task 13: Smoke test — manual verification

**Files:** None (verification only).

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`

Open the printed URL in a browser (typically `http://localhost:5173/turing`).

- [ ] **Step 2: Smoke-test the Turing tab**

For each bundled Turing example (`Replace 'b' with '*'` and `Copy tape (multi-tape)`):

1. **Build / Run / no debug.** Click Build, then Run (debug unchecked). Expect halts cleanly. Log shows step entries + `halted after N step(s)`.
2. **Step / no debug.** Click Step several times. Expect single-step entries.
3. **With pause / no debug.** Tick "with pause", set interval to `300ms`, click Run. Expect auto-step. Click Step button (now labeled Pause) — auto-step pauses. Click Run again — resumes.
4. **Take Control.** Click Take Control. Expect log entry: `user took control`. Use the control panel to apply a command. Expect `applied` log entry.
5. **Build, then break test.** In the editor, modify the snippet to set `state.debug = { before: true }` on `initialState` before `return`. Tick "debug". Click Run. Expect:
   - Log shows initial step trace (or none if first iteration breaks immediately).
   - Log shows `paused at (unnamed) [before]: <symbol>`.
   - Run button label changes to Continue. Step / Stop visible.
6. **Continue.** Click Continue. Expect another `paused` (if state self-loops), or final halt.
7. **Step from break.** While paused, click Step. Expect one more step, then re-pause.
8. **Stop while paused.** While paused, click Stop. Expect log `stopped`, mode → HALTED.
9. **Build during paused.** While paused, click Build. Expect new build, mode → MANUAL.

- [ ] **Step 3: Smoke-test the Post tab**

Switch to `/post`. For the `Walk right; mark first blank` example:

1. Build / Run / no debug. Confirm halts.
2. Modify the snippet to add `imports.haltState.debug = { before: true };` before `return`. Tick "debug". Click Run. Expect a single `paused at <state>` entry on halt-entry.
3. Continue. Expect halt completion.

- [ ] **Step 4: Sanity-check persistence**

Refresh the page on each tab. Expect "debug" checkbox state to persist per tab.

- [ ] **Step 5: Run final type-check + lint + build**

Run: `npm run check && npm run lint && npm run build`
Expected: 0 errors / 0 warnings; build succeeds.

- [ ] **Step 6: No commit needed for smoke test (no code change).**

---

## Self-review checklist

After all tasks complete:

- [ ] `npm run check` clean
- [ ] `npm run lint` clean
- [ ] `npm run build` succeeds
- [ ] All bundled examples Build/Step/Run/Take-Control as before (regression check)
- [ ] Debug-mode unchecked → behaves exactly like pre-#40 Run
- [ ] Debug-mode checked + `state.debug` set → break fires, Continue/Step/Stop work
- [ ] Take Control logs entry
- [ ] README diagram includes `paused` and `resume`
