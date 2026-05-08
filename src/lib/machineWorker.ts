/// <reference lib="webworker" />

/**
 * Worker that drives the upstream machine via async `machine.run(...)`.
 *
 * Phase machine:
 *   idle → (build) → built → (run) → running → (paused) → paused → (resume) → running
 *                          → (step) → built (same, halted advances)
 *
 * A `paused` response is sent when `onDebugBreak` fires; the worker's `run()`
 * Promise stays pending until a `resume` request resolves the internal Promise.
 */

import * as turing from '@turing-machine-js/machine';
import * as post from '@post-machine-js/machine';

import { MAX_STEPS, MAX_TAPES } from './caps.ts';
import {
  type Command,
  type Engine,
  type Movement,
  type TapeSnapshot,
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

// onDebugBreak payload subset we read. Engine's full type carries more.
type DebugBreakPayload = {
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
    onDebugBreak?: (m: DebugBreakPayload) => void | Promise<void>;
    __onDebugBreak?: (m: DebugBreakPayload) => void | Promise<void>;
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

type MachineYield = {
  movements: symbol[];
  currentSymbols: string[];
  nextSymbols: string[];
};

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

// Holds the resolver of the Promise awaited inside onDebugBreak. Set when
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

// Runtime-mutable gate consulted inside onDebugBreak. Initialized from the
// `run` request's `debug` flag; toggled mid-run via the `setDebug` message
// so the user can flip the checkbox without restarting.
let debugEnabled = false;

// Step semantics: with debug off, Step pauses at the next "after" break
// event (= one iteration's command applied), matching the legacy step-by-
// step mental model. Before-fires are skipped. With debug on, Step pauses
// at every break (debug toggle dominates).
let stepPending = false;

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
}

function expectPhase(...allowed: WorkerPhase['kind'][]): void {
  if (!allowed.includes(phase.kind)) {
    throw new Error(
      `worker phase ${phase.kind}, expected ${allowed.join('|')}`,
    );
  }
}

function movementCode(m: symbol): Movement {
  if (m === turing.movements.left) return 'L';
  if (m === turing.movements.right) return 'R';
  return 'S';
}

function commandsFromYield(y: MachineYield): Command[] {
  // `mv` is a JS Symbol primitive (the upstream library encodes movements as
  // unique Symbols — `turing.movements.left/right/stay`). Kept short here to
  // avoid shadowing the surrounding string-typed `movement` (the wire-format
  // 'L' | 'R' | 'S' code).
  return y.movements.map((mv, i) => {
    const movement = movementCode(mv);
    const written = y.nextSymbols[i];
    const before = y.currentSymbols[i];
    return { movement, symbol: written === before ? null : written };
  });
}

function snapshotTapes(): TapeSnapshot[] {
  // Sent on `loaded` (initial state), `ran` (post-run state — halted or
  // truncated), and `error` (partial state when a step / run threw mid-flight,
  // e.g. no edge in the state graph for the current symbol). Full tape — no
  // trim — so the main-thread mirror starts from the user's exact tape and
  // the user can navigate beyond the initial window without blanks appearing
  // where original symbols should be. We don't mutate `t.viewportWidth`
  // either; user tapes stay at the library default.
  return tapes.map((t) => ({
    symbols: [...t.symbols],
    position: t.position,
  }));
}

function snapshotAlphabets(): string[][] {
  return tapes.map((t) => [...t.alphabet.symbols]);
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

async function run(
  maxSteps: number,
  debug: boolean,
  step: boolean,
): Promise<{ truncated: boolean; startStep: number }> {
  expectPhase('built');
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

  // Cold-start Step: arm the initial state's .after = true so iter 1's
  // after-fire pauses (the legacy step-by-step boundary — pause once iter
  // 1's command has been applied). Always .after, regardless of debug
  // toggle: the toggle gates whether user-authored breaks pause, not where
  // the Step boundary lands. We preserve the user's .before (read via the
  // DebugConfig getter — spread skips it) so a user-authored before-break
  // still fires naturally on iter 1; we never inject one ourselves, since
  // that would surface as an unauthored pre-iter pause.
  if (step && initialState) {
    const target = initialState as { debug: { before?: unknown; after?: unknown } | null };
    const original = target.debug;
    const newDebug: { before?: unknown; after?: unknown } = { after: true };
    if (original?.before !== undefined) newDebug.before = original.before;
    target.debug = newDebug;
    pendingRestore = () => { target.debug = original; };
    stepPending = true;
  }

  let truncated = false;

  // Always provide the hook so the runtime-toggle (setDebug) can flip behavior
  // mid-run. The hook self-gates on `debugEnabled` and resolves immediately
  // when off — engine continues without pausing — UNLESS the user just
  // clicked Step, in which case the next break always pauses.
  const onDebugBreakFn = async (m: DebugBreakPayload) => {
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
          debugBreak: { ...m.debugBreak },
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
      };

  // PostMachine.run() uses `__onDebugBreak` and does not accept `initialState`
  // (uses its own #initialState). TuringMachine.run() uses `onDebugBreak` and
  // requires `initialState`. Branch on the presence of `__onDebugBreak` in the
  // machine's `run` signature to route correctly.
  const runOpts: Parameters<AnyMachine['run']>[0] = {
    stepsLimit: maxSteps,
    onStep: (m: MachineYield) => {
      runCommandBuffer.push(commandsFromYield(m));
      stepsApplied += 1;
    },
  };

  if (machine instanceof post.PostMachine) {
    // PostMachine.run() uses `__onDebugBreak` and ignores `initialState`
    // (it carries its own #initialState internally).
    runOpts.__onDebugBreak = onDebugBreakFn;
  } else {
    // TuringMachine.run() uses `onDebugBreak` and requires `initialState`.
    runOpts.initialState = initialState;
    runOpts.onDebugBreak = onDebugBreakFn;
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
      const { truncated, startStep } = await run(
        req.maxSteps ?? MAX_STEPS,
        req.debug ?? false,
        req.step ?? false,
      );
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
      tapes: tapes.length > 0 ? snapshotTapes() : undefined,
    });
  }
}
