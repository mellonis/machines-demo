/// <reference lib="webworker" />

/**
 * Worker that drives the upstream `runStepByStep` generator.
 *
 * The generator's first yield is the command queued to be applied by the next
 * call to `step()`. Each subsequent `next()` applies the previously-yielded
 * command and yields the next one. We track that as `pendingCommand`.
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

type AnyMachine = {
  runStepByStep: (opts: { initialState: unknown }) => Generator<MachineYield, void, void>;
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

let machine: AnyMachine | null = null;
let initialState: unknown = null;
let tapes: AnyTape[] = [];
let generator: Generator<MachineYield, void, void> | null = null;
let halted = false;
let stepsApplied = 0;
let pendingCommand: MachineYield | null = null;

function reset(): void {
  machine = null;
  initialState = null;
  tapes = [];
  generator = null;
  halted = false;
  stepsApplied = 0;
  pendingCommand = null;
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
    halted = true;
    pendingCommand = null;
  } else {
    pendingCommand = first.value;
  }
}

function step(): { commands: Command[] | null; nextCommands: Command[] | null } {
  if (halted || !pendingCommand || !generator) {
    return { commands: null, nextCommands: null };
  }
  const commands = commandsFromYield(pendingCommand);
  const r = generator.next();
  stepsApplied += 1;
  if (r.done) {
    halted = true;
    pendingCommand = null;
  } else {
    pendingCommand = r.value;
  }
  const nextCommands = pendingCommand ? commandsFromYield(pendingCommand) : null;
  return { commands, nextCommands };
}

function runToEnd(maxSteps: number): { commands: Command[][]; truncated: boolean; startStep: number } {
  if (!generator) throw new Error('not built');
  const startStep = stepsApplied;
  const commands: Command[][] = [];
  let extra = 0;
  while (!halted && pendingCommand && extra < maxSteps) {
    commands.push(commandsFromYield(pendingCommand));
    const r = generator.next();
    stepsApplied += 1;
    extra += 1;
    if (r.done) {
      halted = true;
      pendingCommand = null;
      break;
    }
    pendingCommand = r.value;
  }
  return { commands, truncated: !halted && extra >= maxSteps, startStep };
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
  try {
    if (req.type === 'build') {
      build(req.engine, req.code);
      send({
        type: 'built',
        tapes: snapshotTapes(),
        alphabets: snapshotAlphabets(),
        halted,
      });
      return;
    }

    if (req.type === 'step') {
      if (!machine) throw new Error('not built');
      const { commands, nextCommands } = step();
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
      if (!machine) throw new Error('not built');
      const { commands, truncated, startStep } = runToEnd(req.maxSteps ?? MAX_STEPS);
      send({
        type: 'ran',
        tapes: snapshotTapes(),
        truncated,
        commands,
        startStep,
        stepsApplied,
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
      tapes: tapes.length > 0 ? snapshotTapes() : undefined,
    });
  }
};
