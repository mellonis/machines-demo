/// <reference lib="webworker" />

/**
 * Worker that drives the upstream machine via async `machine.run(...)`.
 *
 * Phase machine:
 *   idle → (build) → built → (run) → running → (paused) → paused → (resume) → running
 *                          → (step) → built (same, halted advances)
 *
 * A `paused` response is sent when `onPause` fires; the worker's `run()`
 * Promise stays pending until a `resume` request resolves the internal Promise.
 */

import * as turing from '@turing-machine-js/machine';
import * as post from '@post-machine-js/machine';
import {
  commandsFromYield,
  snapshotTapes,
  snapshotAlphabets,
  expectPhase,
  type MachineYield,
} from './workerHelpers';

import { MAX_STEPS, MAX_TAPES } from './caps.ts';
import {
  type Command,
  type Engine,
  type WorkerRequest,
  type WorkerResponse,
} from './types.ts';

/* ───── dynamic-eval side: deliberately loose typing ─────
 *
 * The user's code is `new Function('imports', userCode)`. We pass the spread
 * namespace as `imports` and let user code do its own destructuring. Typing
 * these as `Record<string, unknown>` is the right shape — strong-typing the
 * namespace would fight the dynamic-eval boundary and force casts everywhere.
 * The strong types live at the worker postMessage boundary instead.
 */

// onPause payload subset we read. Engine's full type carries more.
type OnPausePayload = {
  state: { name?: string };
  currentSymbols: string[];
  nextState: { debug: { before?: true; after?: true } | null };
  debugBreak?: { before?: true; after?: true };
};

type AnyMachine = {
  runStepByStep: (opts: { initialState: unknown }) => Generator<MachineYield, void, void>;
  run: (opts: {
    initialState?: unknown;
    stepsLimit?: number;
    onStep?: (m: MachineYield) => void;
    onPause?: (m: OnPausePayload) => void | Promise<void>;
    onIter?: (m: OnPausePayload) => void | Promise<void>;
  }) => Promise<void>;
  initialState?: unknown;
  tape?: AnyTape;
  tapeBlock?: { tapes?: AnyTape[] };
};

type AnyTape = {
  symbols: string[];
  position: number;
  alphabet: { symbols: string[]; blankSymbol: string };
};

/* ───── timer capture (must happen BEFORE the sandbox redefine) ─────
 *
 * The sandbox below redefines `globalThis.setTimeout` / `clearTimeout` as
 * throwing getters so user code can't schedule async work. The worker's own
 * RUNNING_AUTO throttle still needs them — capture references now, bind to
 * globalThis, so we have callable functions after the redefine. Anything in
 * this module that needs the real timers must use `_setTimeout` / `_clearTimeout`.
 */
const _setTimeout: typeof setTimeout = globalThis.setTimeout.bind(globalThis);
const _clearTimeout: typeof clearTimeout = globalThis.clearTimeout.bind(globalThis);

/* ───── sandbox: ban ambient capabilities user code shouldn't reach ─────
 *
 * The engine is synchronous and the worker boundary already isolates the
 * main thread, so network/timer/concurrency APIs have no legitimate use in
 * user code. Two layers, both best-effort:
 *
 *   1. Parameter shadow inside `build()` — bare references like `fetch(...)`
 *      resolve to the function parameter (a stub that throws an informative
 *      error) instead of the worker global.
 *   2. `globalThis` redefine, applied once at worker startup — catches
 *      `globalThis.fetch` / `self.fetch` and similar.
 *
 * Bypass paths exist in pure JS: `(new Function('return this'))()` (the
 * Function constructor evaluates in global scope, escaping the parameter
 * shadow), and `(0, eval)('globalThis')`. `Promise` stays available — the
 * engine is synchronous so `await` is a no-op for stepping anyway, but
 * blocking it would make most JS unwriteable. For airtight isolation see
 * issue #18 (ShadowRealm).
 */

const SANDBOX_BLOCKED_GLOBALS = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource',
  'BroadcastChannel', 'MessageChannel',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'queueMicrotask', 'requestIdleCallback', 'cancelIdleCallback',
  'Worker', 'importScripts',
] as const;

const sandboxStub = (name: string) => () => {
  throw new Error(`${name} is not available in this sandbox`);
};

for (const name of SANDBOX_BLOCKED_GLOBALS) {
  try {
    Object.defineProperty(globalThis, name, {
      get: sandboxStub(name),
      configurable: true,
    });
  } catch {
    // Some hosts may have non-configurable globals; the parameter shadow
    // in `build()` is the primary defense and still applies.
  }
}

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

// Holds the resolver of the Promise awaited inside dispatchPause. Set when
// the worker is paused at a break; cleared on `resume`. Concurrent `run`
// requests are rejected by the phase machine before they reach this slot.
let resumeResolve: (() => void) | null = null;

// Per-run buffer of commands captured by onStep. Drained on `paused` (sent
// in the response), on `idle` per-iter (auto mode), and on `ran` (sent in
// the response).
let runCommandBuffer: Command[][] = [];
let runStartStep = 0;

// Runtime-mutable gate consulted inside onPause. Initialized from the
// `run` request's `debug` flag; toggled mid-run via the `setDebug` message
// so the user can flip the checkbox without restarting.
let debugEnabled = false;

// "Pause at end of next iter." Set by the `run`/`resume` request handler
// from the `step` field, consumed in onIter. Replaces the v6.0–v6.3
// `armStepAfter` + `stepPending` mechanism: we no longer mutate
// `state.debug` on the engine's graph for our own coordination — onIter
// fires unconditionally per iter (engine v6.4+), so a flag check is
// enough.
let stepRequested = false;

// RUNNING_AUTO throttle: when `runIntervalMs !== null` the worker awaits a
// `setTimeout(intervalMs)` Promise inside onIter, sending `idle`/`busy` to
// bracket each await so the runner can suspend `WORKER_TIMEOUT_MS`. Updated
// at run-start (from the `run` request) and at every `resume` (from the
// `resume` request — withPause is re-read at Continue per spec §3).
let runIntervalMs: number | null = null;
let pendingTimerId: ReturnType<typeof setTimeout> | null = null;
let pendingTimerResolve: (() => void) | null = null;

// Click-pause: set by the `pause` request handler; consumed in onIter after
// the throttle await unwinds. The handler cancels the throttle timer so
// onIter doesn't sit waiting for the full intervalMs before checking.
let pauseRequested = false;

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
  debugEnabled = false;
  stepRequested = false;
  runIntervalMs = null;
  pendingTimerId = null;
  pendingTimerResolve = null;
  pauseRequested = false;
}

/** Cancel the in-flight throttle timer (if any) and resolve its Promise so
 * the onStep await unwinds immediately. No-op if the worker is not currently
 * idle in a throttle. */
function cancelThrottle(): void {
  if (pendingTimerId !== null) {
    _clearTimeout(pendingTimerId);
    pendingTimerId = null;
  }
  if (pendingTimerResolve !== null) {
    const r = pendingTimerResolve;
    pendingTimerResolve = null;
    r();
  }
}

function build(engine: Engine, code: string): void {
  reset();
  const imports: Record<string, unknown> =
    engine === 'post' ? { ...post } : { ...turing };

  const userFn = new Function('imports', ...SANDBOX_BLOCKED_GLOBALS, code) as (
    i: Record<string, unknown>,
    ...stubs: unknown[]
  ) => unknown;
  const result = userFn(imports, ...SANDBOX_BLOCKED_GLOBALS.map(sandboxStub));

  if (!result || typeof result !== 'object') {
    throw new Error('user code must return { machine, initialState?, tape? }');
  }

  const r = result as {
    machine?: AnyMachine;
    initialState?: unknown;
    tape?: AnyTape;
  };

  if (!r.machine) throw new Error('return value missing `machine`');
  machine = r.machine;

  initialState = r.initialState ?? machine.initialState ?? null;
  if (!initialState) {
    throw new Error('return value missing `initialState` and machine has no `initialState` getter');
  }

  // Tape derivation: a multi-tape `tapeBlock.tapes` wins over `r.tape`/`machine.tape`,
  // otherwise users adapting the single-tape default snippet to multi-tape would
  // see only tape 0 silently (the very regression the old single-tape assert
  // existed to prevent).
  const blockTapes = machine.tapeBlock?.tapes;
  if (blockTapes && blockTapes.length > 1) {
    tapes = [...blockTapes];
  } else if (r.tape) {
    tapes = [r.tape];
  } else if (machine.tape) {
    tapes = [machine.tape];
  } else if (blockTapes && blockTapes.length === 1) {
    tapes = [...blockTapes];
  } else {
    throw new Error('return value missing `tape` and could not derive one from the machine');
  }

  if (tapes.length > MAX_TAPES) {
    throw new Error(
      `this demo supports up to ${MAX_TAPES} tapes (got ${tapes.length})`,
    );
  }

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

function step(): { commands: Command[] | null; nextCommands: Command[] | null; halted: boolean } {
  expectPhase(phase.kind, ['built']);
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

/**
 * Send `paused`, await `resume`. Three call sites:
 *   (a) engine-fired user-authored breaks routed through `onPause`,
 *   (b) cold-start Step / step-from-paused: `stepRequested` flag triggers
 *       a synthetic call from `onIter` at end-of-iter,
 *   (c) click-pause from RUNNING_AUTO: `pauseRequested` flag triggers a
 *       synthetic call from `onIter` (possibly mid-throttle).
 *
 * No engine-graph mutation needed — `stepRequested` is what makes the
 * next iter's `onIter` pause again. The resume handler sets it from
 * `req.step` directly.
 */
async function dispatchPause(info: {
  state: string;
  currentSymbols: string[];
  debugBreak: { before?: true; after?: true };
}): Promise<void> {
  const commandsBatch = runCommandBuffer;
  runCommandBuffer = [];
  phase = { kind: 'paused' };
  send({
    type: 'paused',
    tapes: snapshotTapes(tapes),
    commands: commandsBatch,
    stepsApplied,
    state: info.state,
    currentSymbols: info.currentSymbols,
    debugBreak: info.debugBreak,
  });
  await new Promise<void>((resolve) => {
    resumeResolve = () => {
      resumeResolve = null;
      resolve();
    };
  });
  phase = { kind: 'running' };
}

async function run(
  maxSteps: number,
  debug: boolean,
  step: boolean,
  intervalMs: number | null,
): Promise<{ truncated: boolean; startStep: number }> {
  expectPhase(phase.kind, ['built']);
  const built = phase as Extract<WorkerPhase, { kind: 'built' }>;
  if (built.halted || !machine) throw new Error('cannot run: halted or not built');

  // Initial-yield handling: build() always primes pendingCommand. We discard
  // the engine's runStepByStep generator and start a fresh `run()` from the
  // current initial state — the engine handles its own iteration internally.
  // .return() triggers the generator's `finally` so it unlocks the tapeBlock;
  // without it, the new run()'s internal generator hits "Lock check failed".
  if (generator) {
    generator.return();
    generator = null;
  }
  pendingCommand = null;

  runStartStep = stepsApplied;
  runCommandBuffer = [];
  phase = { kind: 'running' };
  debugEnabled = debug;
  stepRequested = step;
  runIntervalMs = intervalMs;
  pauseRequested = false;

  let truncated = false;

  // onPause: engine fires this when a user-authored `state.debug[when]`
  // matches. The worker has nothing to "arm" here anymore — onIter is
  // where our Step/Pause coordination lives. We just surface (or
  // suppress) the user's break.
  const onPauseFn = async (m: OnPausePayload) => {
    if (!debugEnabled) return;
    await dispatchPause({
      state: m.state.name ?? '',
      currentSymbols: [...m.currentSymbols],
      debugBreak: { ...m.debugBreak },
    });
  };

  // onIter: engine v6.4.0+ fires this awaited callback at end of every
  // iter, AFTER both onPause dispatches on the same yield. Our per-iter
  // coordination lives here:
  //
  // - Throttle (RUNNING_AUTO): drain command buffer → idle (suspends
  //   runner's WORKER_TIMEOUT_MS) → setTimeout(intervalMs) → busy.
  //   Cancellable mid-throttle via `cancelThrottle()` from the pause
  //   handler.
  //
  // - Click-pause: `pauseRequested` is checked AFTER the throttle block
  //   so it also works in continuous mode (where there's no throttle to
  //   cancel — the flag is just consumed on the next iter). Currently
  //   the Pause button is hidden in RUNNING_CONTINUOUS, but the worker-
  //   side capability is wired for future use.
  //
  // - Step boundary: `stepRequested` is checked after pauseRequested. If
  //   set, dispatch a synthetic paused. `stepRequested` is set by the
  //   `run`/`resume` request handler from `req.step` — no engine-graph
  //   mutation needed.
  const onIterFn = async (m: OnPausePayload) => {
    if (runIntervalMs !== null && runIntervalMs > 0) {
      const drained = runCommandBuffer;
      runCommandBuffer = [];
      send({ type: 'idle', commands: drained, stepsApplied });
      await new Promise<void>((resolve) => {
        pendingTimerResolve = resolve;
        pendingTimerId = _setTimeout(() => {
          pendingTimerId = null;
          pendingTimerResolve = null;
          resolve();
        }, runIntervalMs as number);
      });
      send({ type: 'busy' });
    }

    if (pauseRequested) {
      pauseRequested = false;
      await dispatchPause({
        state: m.state.name ?? '',
        currentSymbols: [...m.currentSymbols],
        debugBreak: {},
      });
      return; // don't also fire stepRequested on the same iter
    }

    if (stepRequested) {
      stepRequested = false;
      await dispatchPause({
        state: m.state.name ?? '',
        currentSymbols: [...m.currentSymbols],
        debugBreak: {},
      });
    }
  };

  const runOpts: Parameters<AnyMachine['run']>[0] = {
    stepsLimit: maxSteps,
    onStep: (m: MachineYield) => {
      runCommandBuffer.push(commandsFromYield(m));
      stepsApplied += 1;
    },
    onPause: onPauseFn,
    onIter: onIterFn,
  };

  // TuringMachine.run() requires initialState; PostMachine.run() ignores
  // it (carries its own #initialState internally). Branch only here.
  if (!(machine instanceof post.PostMachine)) {
    runOpts.initialState = initialState;
  }

  try {
    await machine.run(runOpts);
  } catch (err) {
    // The engine throws 'Long execution' when stepsLimit is reached. Check the
    // step counter at catch time — more reliable than a flag set in onStep
    // (engine may throw before the flag-setting iteration's onStep runs).
    if (stepsApplied - runStartStep >= maxSteps) {
      truncated = true;
      // fall through, send `ran` with truncated: true
    } else {
      // Reset phase before rethrow so the catch in handleRequest sees a known
      // state. tapes still hold partial state (existing error path).
      phase = { kind: 'built', halted: false };
      throw err;
    }
  }

  phase = { kind: 'built', halted: true };
  return { truncated, startStep: stepsApplied - runCommandBuffer.length };
}

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
        tapes: snapshotTapes(tapes),
        alphabets: snapshotAlphabets(tapes),
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
      const { truncated, startStep } = await run(
        req.maxSteps ?? MAX_STEPS,
        req.debug ?? false,
        req.step ?? false,
        req.intervalMs ?? null,
      );
      send({
        type: 'ran',
        tapes: snapshotTapes(tapes),
        truncated,
        commands: runCommandBuffer,
        startStep,
        stepsApplied,
      });
      runCommandBuffer = [];
      return;
    }

    if (req.type === 'resume') {
      expectPhase(phase.kind, ['paused']);
      const r = resumeResolve;
      if (!r) throw new Error('resume: no pending Promise');
      // Update throttle policy from the current withPause at Continue time
      // (spec §3 — withPause is read at the click, not captured at run-start).
      // Explicit `undefined` keeps the existing policy (cold-start Step's
      // resume calls don't pass intervalMs).
      if (req.intervalMs !== undefined) runIntervalMs = req.intervalMs;
      // `step` controls whether onIter pauses again at the end of the next
      // iter — set the flag here (was previously inside dispatchPause via
      // armStepAfter; now a direct flag flip).
      stepRequested = req.step ?? false;
      r();
      return;
    }

    if (req.type === 'pause') {
      // Click-pause. The throttle Promise (if any) is the synchronization
      // point; cancelling it unblocks `onIter` which then sees
      // `pauseRequested` and dispatches the synthetic `paused`. In
      // continuous mode there's no throttle to cancel — the flag is just
      // consumed on the next iter. If the worker is already paused or
      // building, this is a no-op — main-thread guards it anyway via
      // the runner.
      if (phase.kind !== 'running') return;
      pauseRequested = true;
      cancelThrottle();
      return;
    }

    if (req.type === 'setDebug') {
      // Side-channel mutation; allowed in any phase (no expectPhase). When the
      // worker is currently paused at a break, this changes how *future*
      // breaks are handled — the user still has to Continue past the current
      // pause manually.
      debugEnabled = req.on;
      return;
    }

    throw new Error(`unknown message type: ${(req as { type: string }).type}`);
  } catch (err) {
    // Carry the current tape state when present — a step/run that errors
    // mid-flight has typically already applied N steps; sending the partial
    // state lets the main-thread mirror jump to it instead of stranding the
    // user on the loaded tape.
    send({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
      tapes: tapes.length > 0 ? snapshotTapes(tapes) : undefined,
    });
  }
}
