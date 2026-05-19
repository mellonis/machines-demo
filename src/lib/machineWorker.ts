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
  armStepAfter,
  type MachineYield,
  type DebugTarget,
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
    __onPause?: (m: OnPausePayload) => void | Promise<void>;
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

// Holds the resolver of the Promise awaited inside onPause. Set when
// the worker is paused at a break; cleared on `resume`. Concurrent `run`
// requests are rejected by the phase machine before they reach this slot.
let resumeResolve: ((action: { step: boolean }) => void) | null = null;

// Step trick: when the user clicks Step, arm the iteration-we're-stepping-
// through's state.debug.after = true so the engine fires an after-break in
// the next iteration's body and we pause there. pendingRestore undoes the
// mutation before the user observes the new break.
let pendingRestore: (() => void) | null = null;

// Per-run buffer of commands captured by onStep. Drained on `paused` (sent
// in the response) and on `ran` (sent in the response).
let runCommandBuffer: Command[][] = [];
let runStartStep = 0;

// Runtime-mutable gate consulted inside onPause. Initialized from the
// `run` request's `debug` flag; toggled mid-run via the `setDebug` message
// so the user can flip the checkbox without restarting.
let debugEnabled = false;

// Step semantics: with debug off, Step pauses at the next "after" break
// event (= one iteration's command applied), matching the legacy step-by-
// step mental model. Before-fires are skipped. With debug on, Step pauses
// at every break (debug toggle dominates).
let stepPending = false;

// RUNNING_AUTO throttle: when `runIntervalMs !== null` the worker awaits a
// `setTimeout(intervalMs)` Promise inside onStep, sending `idle`/`busy` to
// bracket each await so the runner can suspend `WORKER_TIMEOUT_MS`. Updated
// at run-start (from the `run` request) and at every `resume` (from the
// `resume` request — withPause is re-read at Continue per spec §3).
let runIntervalMs: number | null = null;
let pendingTimerId: ReturnType<typeof setTimeout> | null = null;
let pendingTimerResolve: (() => void) | null = null;

// Click-pause: set by the `pause` request handler; consumed in onStep after
// the throttle await unwinds. The handler cancels the throttle timer so the
// onStep doesn't sit waiting for the full intervalMs before checking.
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
  pendingRestore = null;
  runCommandBuffer = [];
  runStartStep = 0;
  debugEnabled = false;
  stepPending = false;
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
 * Send `paused`, await `resume`. Shared by:
 *   (a) the engine-fired user-authored breaks routed through `onPause`,
 *   (b) cold-start Step's armed `.after` (same path as (a)),
 *   (c) click-pause from RUNNING_AUTO: a synthetic call from inside `onStep`
 *       with `debugBreak = {}`.
 *
 * All three call sites have an `m` (MachineState) in scope and pass it as
 * `rearmFrom`, so Step-from-paused uniformly re-arms the next state's `.after`
 * regardless of how the pause originated. Click-pause's `m.debugBreak` is
 * empty, which routes its Step through the `nextState`-based arm path (same
 * as an `.after` engine break).
 */
async function dispatchPause(info: {
  state: string;
  currentSymbols: string[];
  debugBreak: { before?: true; after?: true };
  rearmFrom: OnPausePayload;
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
  const action = await new Promise<{ step: boolean }>((resolve) => {
    resumeResolve = (a) => {
      resumeResolve = null;
      resolve(a);
    };
  });
  phase = { kind: 'running' };
  if (action.step) {
    stepPending = true;
    // For a `before` break: m IS the iteration we want to step through.
    // For an `after` break (m substituted to prevYield) and for click-pause
    // (empty debugBreak): the next iter's state lives at m.nextState.
    // armStepAfter handles the .before preservation and returns a restore
    // function.
    const target = (
      info.rearmFrom.debugBreak?.before
        ? info.rearmFrom.state
        : info.rearmFrom.nextState
    ) as DebugTarget;
    const { restore } = armStepAfter(target);
    pendingRestore = restore;
  }
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
  stepPending = false;
  runIntervalMs = intervalMs;
  pauseRequested = false;

  // Cold-start Step: arm the initial state's .after = true so iter 1's
  // after-fire pauses (the legacy step-by-step boundary — pause once iter
  // 1's command has been applied). Always .after, regardless of debug
  // toggle: the toggle gates whether user-authored breaks pause, not where
  // the Step boundary lands. We preserve the user's .before (read via the
  // DebugConfig getter — spread skips it) so a user-authored before-break
  // still fires naturally on iter 1; we never inject one ourselves, since
  // that would surface as an unauthored pre-iter pause.
  if (step && initialState) {
    const { restore } = armStepAfter(initialState as DebugTarget);
    pendingRestore = restore;
    stepPending = true;
  }

  let truncated = false;

  // Always provide the hook so the runtime-toggle (setDebug) can flip behavior
  // mid-run. The hook self-gates on `debugEnabled` and resolves immediately
  // when off — engine continues without pausing — UNLESS the user just
  // clicked Step, in which case the next break always pauses.
  const onPauseFn = async (m: OnPausePayload) => {
        // Restore the synthesized one-shot before the user observes the break.
        // (Done unconditionally — clean up even when debug is currently off,
        // so a Step-armed mutation doesn't leak past a debug toggle.)
        if (pendingRestore) {
          pendingRestore();
          pendingRestore = null;
        }
        if (debugEnabled) {
          // Debug on: pause at every break.
          stepPending = false;
        } else {
          // Debug off: Step pauses only at after-fires (= one iteration's
          // command applied). Before-fires are skipped — they signal the
          // start of an iteration, not its result.
          if (!stepPending || !m.debugBreak?.after) return;
          stepPending = false;
        }
        await dispatchPause({
          state: m.state.name ?? '',
          currentSymbols: [...m.currentSymbols],
          debugBreak: { ...m.debugBreak },
          rearmFrom: m,
        });
      };

  // PostMachine.run() uses `__onPause` and does not accept `initialState`
  // (uses its own #initialState). TuringMachine.run() uses `onPause` and
  // requires `initialState`. Branch on the machine class to route correctly.
  const runOpts: Parameters<AnyMachine['run']>[0] = {
    stepsLimit: maxSteps,
    onStep: async (m: MachineYield) => {
      runCommandBuffer.push(commandsFromYield(m));
      stepsApplied += 1;

      // Throttle: idle/busy bracket lets the runner suspend WORKER_TIMEOUT_MS
      // while the worker is just waiting for the next setTimeout to fire. The
      // idle message also drains the per-iter command buffer so the main
      // thread can animate the belt and log each iter at the cadence — the
      // RUNNING_CONTINUOUS path (no throttle) skips this and just buffers up
      // through to `ran`. The throttle Promise is also the only way click-
      // pause can interrupt a running auto-step — the pause handler clears
      // the timer and resolves it.
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

      // Click-pause: dispatch a synthetic `paused` (debugBreak={}) at the
      // same boundary as the throttle. After the user clicks Continue, the
      // engine proceeds to the next iter; if intervalMs is still non-null, the
      // throttle resumes on subsequent iters.
      if (pauseRequested) {
        pauseRequested = false;
        // Engine passes a full MachineState to onStep (superset of MachineYield —
        // includes state, nextState, debugBreak). We narrow to MachineYield
        // for buffering's sake; widen locally here for state.name + rearmFrom.
        const ms = m as unknown as OnPausePayload;
        await dispatchPause({
          state: ms.state.name ?? '',
          currentSymbols: [...m.currentSymbols],
          debugBreak: {},
          // Step-from-click-pause uses the same boundary as Step-from-engine-
          // break: arm `m.nextState.debug.after` so the next iter pauses at
          // its after-fire. dispatchPause's existing armStepAfter path handles
          // it via the `else` of the `before`-branch (no debugBreak.before set
          // on a click-pause, so it picks `nextState`).
          rearmFrom: ms,
        });
      }
    },
  };

  if (machine instanceof post.PostMachine) {
    // PostMachine.run() uses `__onPause` and ignores `initialState`
    // (it carries its own #initialState internally).
    runOpts.__onPause = onPauseFn;
  } else {
    // TuringMachine.run() uses `onPause` and requires `initialState`.
    runOpts.initialState = initialState;
    runOpts.onPause = onPauseFn;
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
      r({ step: req.step ?? false });
      return;
    }

    if (req.type === 'pause') {
      // Click-pause from RUNNING_AUTO. The throttle Promise (if any) is the
      // synchronization point; cancelling it unblocks onStep which then sees
      // `pauseRequested` and dispatches the synthetic `paused` from inside
      // its own scope (where it can read `m.currentSymbols`). If the worker
      // is already paused or building, this is a no-op — main-thread guards
      // it anyway via the runner.
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
