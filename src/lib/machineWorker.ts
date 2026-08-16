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
  readsFromYield,
  matchKindsFromYield,
  nextStateIdFromYield,
  snapshotTapes,
  snapshotAlphabets,
  expectPhase,
  createProgressGate,
  type MachineYield,
} from './workerHelpers';
import { computeImminentHalt } from './imminentHalt';

import { MAX_STEPS, MAX_TAPES, PROGRESS_INTERVAL_MS } from './caps.ts';
import type { Graph } from '@turing-machine-js/machine';
import {
  type Command,
  type Engine,
  type WorkerRequest,
  type WorkerResponse,
} from './types.ts';
import { mergeDebugKinds, scanCanonicalBreakpoints } from './breakpointCoordination.ts';

/* ───── dynamic-eval side: deliberately loose typing ─────
 *
 * The user's code is `new Function('imports', userCode)`. We pass the spread
 * namespace as `imports` and let user code do its own destructuring. Typing
 * these as `Record<string, unknown>` is the right shape — strong-typing the
 * namespace would fight the dynamic-eval boundary and force casts everywhere.
 * The strong types live at the worker postMessage boundary instead.
 */

// MachineYield (defined in workerHelpers) carries movements / currentSymbols /
// nextSymbols / state / matchedTransition. The pause / iter handlers want a
// couple of extra fields the engine ALSO emits but workerHelpers doesn't
// declare:
//   - `state.name` — used for log lines + debugger UI display.
//   - `pause` — present on DebugSession `pause` events (engine v7); carries
//     {side, cause}. Absent on `iter` events, so it's optional here —
//     onIterFn ignores it, onPauseFn reads it.
// Declared as a structural extension of MachineYield so a MachineYield value
// flows directly into a parameter of this type — no cast.
type OnPausePayload = Omit<MachineYield, 'state'> & {
  state: MachineYield['state'] & { name?: string };
  pause?: { side: 'before' | 'after'; cause: 'breakpoint' | 'step' | 'manual' };
};

type AnyMachine = {
  runStepByStep: (opts: { initialState: unknown }) => Generator<MachineYield, TerminalRunResult | void, void>;
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
 * blocking it would make most JS unwriteable. Airtight isolation would
 * need a ShadowRealm-based sandbox.
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
let generator: Generator<MachineYield, TerminalRunResult | void, void> | null = null;
let stepsApplied = 0;
let pendingCommand: MachineYield | null = null;
// Engine v7 Graph snapshot captured at build, retained so onPause can ask
// "is this state a wrapper?" and skip dispatch — wrappers are structural
// devices (call-stack push), not meaningful program points, so a breakpoint
// on a shared #debugRef pauses only at the bare.
let currentGraph: Graph | null = null;

/** Resolve the display name for an engine State, collapsing wrappers to
 *  their bare. Pause-line logs use the bare name for every iter so the
 *  same logical state reads consistently across the wrapper-entry iter
 *  (where m.state IS the wrapper, composite name `bare(override)`) and
 *  subsequent bare-entry iters. The wrapper distinction is still visible
 *  in the diagram (its own node + `==> call` arrow); in text logs it
 *  reads as noise. */
function resolveDisplayName(stateId: number, fallback: string): string {
  const node = currentGraph?.nodes[stateId];
  if (node?.isWrapper && node.bareStateId !== null && node.bareStateId !== undefined) {
    const bare = currentGraph?.nodes[node.bareStateId];
    if (bare?.name) return bare.name;
  }
  return fallback;
}

// Holds the resolver of the Promise awaited inside dispatchPause. Set when
// the worker is paused at a break; cleared on `resume`. Concurrent `run`
// requests are rejected by the phase machine before they reach this slot.
let resumeResolve: (() => void) | null = null;

// Structural view of both the engine `DebugSession` and `PostDebugSession`.
// The worker drives the engine's native pause/step controls
// directly rather than synthesizing pauses: Step → stepIn(), click-Pause →
// pause(), Continue → continue(). All pauses (breakpoint / step / manual) come
// back through the single `pause` event.
type SessionLike = {
  on: ((event: 'step' | 'pause' | 'iter',
       listener: (m: MachineYield) => void | Promise<void>) => SessionLike)
    & ((event: 'halt' | 'abort',
       listener: (r: TerminalRunResult) => void) => SessionLike);
  start: () => Promise<void>;
  continue: () => void;
  stepIn: () => void;
  stop: () => void;
  pause: () => void;
};

// Structural view of the engine's RunResult — the payload of the session's
// terminal 'halt' / 'abort' events AND the step generator's return value.
// `stack` is frozen-at-termination: empty for a natural halt, the pending
// continuation states (innermost first) for an abort.
type TerminalRunResult = {
  outcome: 'halted' | 'aborted';
  state: { id: number; name?: string };
  stack: readonly { id: number; name?: string }[];
  step: number;
};

// The active session for the current run, hoisted so the `pause` request
// handler (click-Pause) can call `activeSes.pause()` from outside the run
// loop. Set at run-start, cleared on reset / run-end.
let activeSes: SessionLike | null = null;

// What the paused run loop should do once main resolves the pause: a plain
// Continue, a single Step (engine stepIn), or Stop. Set by the `resume` /
// `stop` request handlers, read by the `pause` listener after dispatchPause
// returns.
let resumeAction: 'continue' | 'step' | 'stop' = 'continue';

// Per-run buffer of commands captured by onStep. Drained on `paused` (sent
// in the response), on `idle` per-iter (auto mode), and on `ran` (sent in
// the response). `runReadsBuffer` is the parallel array of pre-step head
// symbols — same length, same per-step index.
// `runMatchKindsBuffer` is the parallel array of per-tape match kinds
// (`'wildcard' | 'literal'`) sourced from
// `MachineState.matchedTransition.matchKinds` so
// the log can render `[*='X']` for wildcard reads — same length, same
// per-step index.
let runCommandBuffer: Command[][] = [];
let runReadsBuffer: string[][] = [];
let runMatchKindsBuffer: ('wildcard' | 'literal')[][] = [];
let runStartStep = 0;

// Engine State.id of the most recently yielded state, captured in onStep.
// At the moment a BEFORE-pause fires for iter K, this holds iter K-1's
// state.id — i.e. the source of the transition that just brought us into
// iter K's state. That's the FROM of the "just-fired" triple the demo
// highlights on the graph. Cleared on reset / run-
// start so the very first iter's before-pause sees null → main thread
// uses the synthetic `idle` sentinel as FROM.
let prevYieldedStateId: number | null = null;

// Runtime-mutable gate consulted inside onPause. Initialized from the
// `run` request's `debug` flag; toggled mid-run via the `setDebug` message
// so the user can flip the checkbox without restarting.
let debugEnabled = false;

// RUNNING_AUTO throttle: when `runIntervalMs !== null` the worker awaits a
// `setTimeout(intervalMs)` Promise inside onIter, sending `idle`/`busy` to
// bracket each await so the runner can suspend `WORKER_TIMEOUT_MS`. Updated
// at run-start (from the `run` request) and at every `resume` (from the
// `resume` request — withPause is re-read at Continue per spec §3).
let runIntervalMs: number | null = null;
let pendingTimeoutId: ReturnType<typeof setTimeout> | null = null;
let pendingTimeoutResolve: (() => void) | null = null;

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
  runReadsBuffer = [];
  runMatchKindsBuffer = [];
  prevYieldedStateId = null;
  runStartStep = 0;
  debugEnabled = false;
  runIntervalMs = null;
  pendingTimeoutId = null;
  pendingTimeoutResolve = null;
  activeSes = null;
  resumeAction = 'continue';
  currentGraph = null;
}

/** Cancel the in-flight throttle timer (if any) and resolve its Promise so
 * the onStep await unwinds immediately. No-op if the worker is not currently
 * idle in a throttle. */
function cancelThrottle(): void {
  if (pendingTimeoutId !== null) {
    _clearTimeout(pendingTimeoutId);
    pendingTimeoutId = null;
  }
  if (pendingTimeoutResolve !== null) {
    const r = pendingTimeoutResolve;
    pendingTimeoutResolve = null;
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

function step(): {
  commands: Command[] | null;
  reads: string[] | null;
  matchKinds: ('wildcard' | 'literal')[] | null;
  nextCommands: Command[] | null;
  currentStateId: number | null;
  nextStateId: number | null;
  halted: boolean;
  outcome: 'halted' | 'aborted' | null;
} {
  expectPhase(phase.kind, ['built']);
  const built = phase as Extract<WorkerPhase, { kind: 'built' }>;
  if (built.halted || !pendingCommand || !generator) {
    return {
      commands: null, reads: null, matchKinds: null, nextCommands: null,
      currentStateId: null, nextStateId: null, halted: true, outcome: null,
    };
  }
  const commands = commandsFromYield(pendingCommand);
  const reads = readsFromYield(pendingCommand);
  const matchKinds = matchKindsFromYield(pendingCommand);
  const r = generator.next();
  stepsApplied += 1;
  let halted: boolean;
  let outcome: 'halted' | 'aborted' | null = null;
  if (r.done) {
    halted = true;
    pendingCommand = null;
    // The step generator's return value is the engine RunResult — the only
    // signal distinguishing the classical halt from the abort sentinel.
    outcome = r.value?.outcome ?? 'halted';
  } else {
    halted = false;
    pendingCommand = r.value;
  }
  phase = { kind: 'built', halted };
  const nextCommands = pendingCommand ? commandsFromYield(pendingCommand) : null;
  // Highlight data. After the step, `pendingCommand` (if
  // not halted) is the NEXT yield — its `state` is the state about to fire
  // on the next Step click. That's our `from`; nextStateId is computed via
  // engine `getNextState(getSymbol(tapeBlock))`.
  const currentStateId = pendingCommand ? pendingCommand.state.id : null;
  const nextStateId = pendingCommand && machine?.tapeBlock
    ? nextStateIdFromYield(pendingCommand, machine.tapeBlock)
    : null;
  return { commands, reads, matchKinds, nextCommands, currentStateId, nextStateId, halted, outcome };
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
  /** Per-tape match kinds for the current iter (the one we're pausing
   *  before / after). Drives the wildcard marker on the pause-line's
   *  "for symbols: …" group; parallel to `currentSymbols`. */
  currentMatchKinds: ('wildcard' | 'literal')[];
  pause: { side?: 'before' | 'after'; cause: 'breakpoint' | 'step' | 'manual' };
  currentStateId: number | null;
  nextStateId: number | null;
  prevStateId: number | null;
  imminentHalt?: { kind: 'real' } | { kind: 'in-frame'; haltMarkerId: number };
}): Promise<void> {
  const commandsBatch = runCommandBuffer;
  const readsBatch = runReadsBuffer;
  const matchKindsBatch = runMatchKindsBuffer;
  runCommandBuffer = [];
  runReadsBuffer = [];
  runMatchKindsBuffer = [];
  phase = { kind: 'paused' };
  send({
    type: 'paused',
    tapes: snapshotTapes(tapes),
    commands: commandsBatch,
    reads: readsBatch,
    matchKinds: matchKindsBatch,
    currentStateId: info.currentStateId,
    nextStateId: info.nextStateId,
    prevStateId: info.prevStateId,
    stepsApplied,
    state: info.state,
    currentSymbols: info.currentSymbols,
    currentMatchKinds: info.currentMatchKinds,
    pause: info.pause,
    imminentHalt: info.imminentHalt,
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
): Promise<{
  truncated: boolean;
  startStep: number;
  outcome: 'halted' | 'aborted';
  finalStateName: string | null;
  finalStateId: number | null;
  backtrace: string[];
}> {
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
  runReadsBuffer = [];
  runMatchKindsBuffer = [];
  prevYieldedStateId = null;
  phase = { kind: 'running' };
  debugEnabled = debug;
  runIntervalMs = intervalMs;
  resumeAction = 'continue';

  let truncated = false;

  // onPause: dispatch the `paused` message and block on main's resume
  // decision. Fires for EVERY engine pause — breakpoint (state.debug match),
  // step (stepIn endpoint), and manual (external pause()). The `pause`
  // listener gates breakpoint-cause pauses behind `debugEnabled`; step/manual
  // always surface. After this resolves, the listener calls
  // stepIn()/continue()/stop() per `resumeAction`.
  const onPauseFn = async (m: OnPausePayload) => {
    // Engine invariant: every iter where the source state's `#debugRef`
    // matches fires before/after as configured — wrappers share the
    // bare's #debugRef, so a wrapper-entry iter (iter 1 of a wrapped
    // call) and the following bare-entry iter (iter 2 onwards) BOTH
    // legitimately fire. Both iters resolve to the bare's name via
    // `resolveDisplayName` so the log line is consistent across the
    // wrapper-entry boundary.
    const displayedName = resolveDisplayName(m.state.id, m.state.name ?? '');
    // Halt-imminent detection extracted to lib/imminentHalt — see that
    // module's JSDoc for the gating rules (after-only, halt-BP-only,
    // halt-bound-only). Keeping the logic pure lets the scenario harness
    // exercise it without a worker.
    const imminentHalt = computeImminentHalt({
      m,
      tapeBlock: machine?.tapeBlock,
      currentGraph,
      haltStateDebug: turing.haltState.debug === true,
    });
    await dispatchPause({
      state: displayedName,
      currentSymbols: [...m.currentSymbols],
      currentMatchKinds: [...m.matchedTransition.matchKinds],
      // Engine breakpoint pause — forward the descriptor as-is (always has a side).
      pause: m.pause ?? {cause: 'breakpoint'},
      currentStateId: m.state.id,
      nextStateId: machine?.tapeBlock
        ? nextStateIdFromYield(m as unknown as MachineYield, machine.tapeBlock)
        : null,
      prevStateId: prevYieldedStateId,
      imminentHalt,
    });
  };

  // onIter: engine fires this awaited callback at end of every iter. With
  // Step / click-Pause / breakpoints all driven through the engine's pause
  // controls, the only thing left here is the RUNNING_AUTO
  // throttle: drain the command buffer → `idle` (suspends the runner's
  // WORKER_TIMEOUT_MS) → setTimeout(intervalMs) → `busy`. Cancellable
  // mid-throttle via `cancelThrottle()` from the `pause` request handler.
  // Skipped while stepping (`resumeAction === 'step'`) so a Step click never
  // waits out the auto-run interval before its pause materializes.
  const onIterFn = async (m: OnPausePayload) => {
    if (resumeAction === 'step') return;

    if (runIntervalMs !== null && runIntervalMs > 0) {
      const drained = runCommandBuffer;
      const drainedReads = runReadsBuffer;
      const drainedMatchKinds = runMatchKindsBuffer;
      runCommandBuffer = [];
      runReadsBuffer = [];
      runMatchKindsBuffer = [];
      send({
        type: 'idle',
        commands: drained,
        reads: drainedReads,
        matchKinds: drainedMatchKinds,
        currentStateId: m.state.id,
        nextStateId: machine?.tapeBlock
          ? nextStateIdFromYield(m as unknown as MachineYield, machine.tapeBlock)
          : null,
        stepsApplied,
      });
      await new Promise<void>((resolve) => {
        pendingTimeoutResolve = resolve;
        pendingTimeoutId = _setTimeout(() => {
          pendingTimeoutId = null;
          pendingTimeoutResolve = null;
          resolve();
        }, runIntervalMs as number);
      });
      send({ type: 'busy' });
    }
  };

  // v7 adoption: drive the run through DebugSession instead
  // of `machine.run({onPause, onStep, onIter})`. The engine's v7 run() is
  // sync + callback-free; all observation moved into the session.
  //
  // PostMachine has its own debugRun() returning a PostDebugSession that
  // wraps the engine session with post-specific MachineState wrapping
  // (arrivalPath / candidatePaths) plus breakpoint-registry filtering.
  // TuringMachine consumes the engine session directly.
  const isPost = machine instanceof post.PostMachine;
  const session = isPost
    ? (machine as unknown as { debugRun: (o: { stepsLimit?: number }) => unknown })
        .debugRun({ stepsLimit: maxSteps })
    : new (turing as unknown as { DebugSession: new (m: unknown, o: unknown) => unknown })
        .DebugSession(machine, { initialState, stepsLimit: maxSteps });

  // Generic shape of both sessions. Local cast to a structural type so we
  // don't pull DebugSession + PostDebugSession concretely into the worker
  // boundary types.
  const ses = session as SessionLike;
  activeSes = ses;

  // Terminal RunResult capture: `start()` still resolves void, so the
  // outcome / final state / backtrace arrive only through the terminal
  // events (exactly one of 'halt' / 'abort' fires per run; neither fires
  // on a truncated 'Long execution' throw or an external stop()).
  let runResult: TerminalRunResult | null = null;
  // Post-engine wrapped yields carry the instruction-level arrival path;
  // the last one seen is the abort site's Post-level location. Turing
  // yields have no such field — stays null there.
  let lastPostPath: string | null = null;

  // Progress heartbeat: post the tape state + step count from inside the run
  // loop so the main thread has a last-known state to restore when this
  // worker is terminated without ever answering (watchdog timeout on a
  // continuous run, hand Stop). postMessage clones synchronously and the
  // main thread is free during the run, so heartbeats arrive even while the
  // loop never yields. Time-gated so a million-step run costs a handful of
  // snapshots, not one per step.
  const progressGate = createProgressGate(PROGRESS_INTERVAL_MS, Date.now);

  ses.on('step', (m: MachineYield) => {
    runCommandBuffer.push(commandsFromYield(m));
    runReadsBuffer.push(readsFromYield(m));
    runMatchKindsBuffer.push(matchKindsFromYield(m));
    if (isPost) {
      const ap = (m as { arrivalPath?: unknown }).arrivalPath;
      if (ap) {
        lastPostPath = (post as unknown as { formatPath: (p: unknown) => string }).formatPath(ap);
      }
    }
    // After this step, iter K's transition has effectively "fired"
    // (the runner advances state after step returns). Stash this state.id
    // so iter K+1's before-pause has the prior state available as the
    // FROM of the just-fired triple.
    prevYieldedStateId = m.state.id;
    stepsApplied += 1;
    if (progressGate()) {
      // The lean step yield carries no state name; the graph node's name is
      // the same source `toMermaid` labels use, wrapper-collapsed as usual.
      const nodeName = currentGraph?.nodes[m.state.id]?.name ?? '';
      const displayName = resolveDisplayName(m.state.id, nodeName);
      send({
        type: 'progress',
        tapes: snapshotTapes(tapes),
        stepsApplied,
        stateName: displayName !== '' ? displayName : null,
      });
    }
  });
  ses.on('halt', (r) => { runResult = r; });
  ses.on('abort', (r) => { runResult = r; });
  ses.on('pause', async (m) => {
    // The engine's pause payload carries `pause` (PausedMachineState); the
    // structural SessionLike listener types it as the leaner MachineYield, so
    // read it through the OnPausePayload view onPauseFn already consumes.
    const pm = m as OnPausePayload;
    // Gate breakpoint pauses behind the debug toggle; step/manual (the user's
    // own Step / click-Pause, driven via stepIn()/pause()) always surface.
    if (pm.pause?.cause === 'breakpoint' && !debugEnabled) {
      ses.continue();
      return;
    }
    // Dispatch `paused` and block until main resolves the resume decision.
    await onPauseFn(pm);
    // Resume per main's choice: another Step (stepIn), a Stop, or Continue.
    if (resumeAction === 'stop') ses.stop();
    else if (resumeAction === 'step') ses.stepIn();
    else ses.continue();
  });
  // iter is AWAITED by the engine — return the Promise so the RUNNING_AUTO
  // throttle's setTimeout inside onIterFn actually blocks the engine.
  ses.on('iter', (m) => onIterFn(m));

  // Step-from-start (run({step:true})): arm a before-iter-1 pause. stepIn()
  // sets the step mode; with no pause-resolver yet its release is a no-op, so
  // the first iter's before-side fires the `pause` event (cause 'step').
  if (step) ses.stepIn();

  try {
    await ses.start();
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
  // TS narrows `runResult` to null here (the assignments happen inside the
  // session listeners, invisible to control-flow analysis) — widen it back.
  const result = runResult as TerminalRunResult | null;
  const outcome = result?.outcome ?? 'halted';
  const finalStateName = result
    ? resolveDisplayName(result.state.id, result.state.name ?? '')
    : null;
  // Backtrace at abort: engine-level pending continuations for the Turing
  // page; the instruction-level arrival path of the abort site for the
  // Post page (its RunResult.stack holds synthesized continuation states
  // whose composite names read as noise in a text log).
  const backtrace = outcome !== 'aborted'
    ? []
    : isPost
      ? (lastPostPath !== null ? [lastPostPath] : [])
      : (result?.stack ?? []).map((s) => resolveDisplayName(s.id, s.name ?? ''));
  return {
    truncated,
    startStep: stepsApplied - runCommandBuffer.length,
    outcome,
    finalStateName,
    finalStateId: result?.state.id ?? null,
    backtrace,
  };
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
      // Compute the engine-v7 Graph snapshot once at Build.
      // JSON-serializable; safe across the worker boundary. Main thread feeds
      // this to `toMermaid(graph)` for SVG rendering and uses the per-edge
      // `GraphTransition.id`s for future highlight + breakpoint work.
      // Retained in `currentGraph` so onPause can ask `isWrapper?` and skip
      // wrapper-entry pauses (see onPauseFn in run()).
      currentGraph = turing.State.toGraph(
        initialState as turing.State,
        machine!.tapeBlock as unknown as turing.TapeBlock,
      ) as Graph;

      // Mirror code-set state.debug writes into the UI.
      // User code in the worker may have set state.debug programmatically
      // during `userFn`. Scan the state map for non-empty bits and bundle
      // them in the `built` response (NOT as separate unsolicited
      // `breakpointToggled` messages — those would arrive on the main
      // thread before `graph` is set AND would be double-toggled by the
      // UI-clicked-BP replay loop in MachineView's build handler).
      const codeSetBPs = scanCanonicalBreakpoints(
        turing.State.collectStates(
          initialState as turing.State,
          machine!.tapeBlock as unknown as turing.TapeBlock,
        ),
        currentGraph,
      );

      send({
        type: 'built',
        tapes: snapshotTapes(tapes),
        alphabets: snapshotAlphabets(tapes),
        halted: built.halted,
        graph: currentGraph,
        codeSetBreakpoints: codeSetBPs.length > 0 ? codeSetBPs : undefined,
      });
      return;
    }

    if (req.type === 'step') {
      const { commands, reads, matchKinds, nextCommands, currentStateId, nextStateId, halted, outcome } = step();
      send({
        type: 'stepped',
        halted,
        commands,
        reads,
        matchKinds,
        nextCommands,
        currentStateId,
        nextStateId,
        stepsApplied,
        outcome,
      });
      return;
    }

    if (req.type === 'run') {
      const { truncated, startStep, outcome, finalStateName, finalStateId, backtrace } = await run(
        req.maxSteps ?? MAX_STEPS,
        req.debug ?? false,
        req.step ?? false,
        req.intervalMs ?? null,
      );
      // After run completion, pendingCommand is null (halted). The "final
      // state" for highlight purposes IS halt — but we don't surface a
      // halt-node highlight in v1 (HALTED-mode highlight is a follow-up).
      send({
        type: 'ran',
        tapes: snapshotTapes(tapes),
        truncated,
        commands: runCommandBuffer,
        reads: runReadsBuffer,
        matchKinds: runMatchKindsBuffer,
        currentStateId: pendingCommand ? pendingCommand.state.id : null,
        startStep,
        stepsApplied,
        outcome,
        finalStateName,
        finalStateId,
        backtrace,
      });
      runCommandBuffer = [];
      runReadsBuffer = [];
      runMatchKindsBuffer = [];
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
      // `step` selects how the paused `pause` listener resumes: a single
      // engine stepIn() (pauses again before the next iter, cause 'step') or
      // a plain continue(). Read by the listener after dispatchPause returns.
      resumeAction = req.step ? 'step' : 'continue';
      r();
      return;
    }

    if (req.type === 'pause') {
      // Click-Pause → engine external pause(): the session pauses at the next
      // iter's before-side (cause 'manual') and fires the `pause` event.
      // cancelThrottle() unblocks any in-flight RUNNING_AUTO throttle wait so
      // the pause lands promptly instead of after the full interval. No-op
      // unless actively running (main guards via the runner too).
      if (phase.kind !== 'running') return;
      activeSes?.pause();
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

    if (req.type === 'toggleBreakpoint') {
      // UI right-click context menu toggles the
      // requested kind (`before` or `after`) on the State whose engine
      // GraphNode.id matches `stateId`. The OTHER kind's current bit is
      // preserved — toggling `after` while `before` is on must not lose
      // the `before` filter. Allowed in any phase except 'idle' (no
      // machine built yet); paused explicitly OK so the user can
      // set/clear a breakpoint mid-debug.
      if (!machine || !initialState) {
        send({
          type: 'error',
          message: 'toggleBreakpoint: no machine built (call Build first)',
        });
        return;
      }
      const stateMap = turing.State.collectStates(
        initialState as turing.State,
        machine.tapeBlock as unknown as turing.TapeBlock,
      );
      const entry = stateMap.get(req.stateId);
      if (!entry) {
        send({
          type: 'error',
          message: `toggleBreakpoint: no State for engine GraphNode.id ${req.stateId}`,
        });
        return;
      }
      // haltState: `debug` is a single boolean,
      // not a DebugConfig — the menu shows one "Pause" toggle for halt.
      // Branch out before reading per-side bits, since `boolean.before`
      // would be `undefined` and `mergeDebugKinds` would flip "on" every
      // click instead of toggling.
      if (entry.state === turing.haltState) {
        const enabled = turing.haltState.debug === true;
        const nextEnabled = !enabled;
        turing.haltState.debug = nextEnabled;
        send({
          type: 'breakpointToggled',
          stateId: req.stateId,
          kind: req.kind,
          value: nextEnabled ? 'on' : 'off',
        });
        return;
      }

      // Non-halt: read both bits, compute the merged result (see
      // `mergeDebugKinds` in `breakpointCoordination.ts` for the rules),
      // write via the SETTER. Engine-side `state.debug = { before, after }`
      // creates a fresh DebugConfig; Post's per-State lockdown intercepts
      // the setter and routes through `setBreakpoint` so its registry
      // stays in sync (a direct `state.debug.before = true` bypasses the
      // lockdown and the breakpoint never fires).
      //
      // For Post specifically, we MUST clear first (`state.debug = null`)
      // because Post's lockdown PUSHES onto its `#breakpoints` array
      // without replacing — without the clear, repeated toggles
      // accumulate stale entries. Turing's setter just creates a fresh
      // DebugConfig either way, so the extra null assignment is a no-op.
      const debug = entry.state.debug;
      const current = {
        before: debug.before === true,
        after: debug.after === true,
      };
      const { next, debugValue } = mergeDebugKinds(current, req.kind);
      entry.state.debug = null;
      if (debugValue !== null) {
        entry.state.debug = debugValue as turing.State['debug'];
      }
      send({
        type: 'breakpointToggled',
        stateId: req.stateId,
        kind: req.kind,
        value: next[req.kind] ? 'on' : 'off',
      });
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
