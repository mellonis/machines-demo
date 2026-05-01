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

import {
  MAX_STEPS,
  MAX_TAPES,
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
  return y.movements.map((mv, i) => {
    const movement = movementCode(mv);
    const written = y.nextSymbols[i];
    const before = y.currentSymbols[i];
    return { movement, symbol: written === before ? null : written };
  });
}

function snapshotTapes(): TapeSnapshot[] {
  return tapes.map((t) => ({
    symbols: [...t.symbols],
    position: t.position,
    blank: t.alphabet.blankSymbol,
  }));
}

function snapshotAlphabets(): string[][] {
  return tapes.map((t) => [...t.alphabet.symbols]);
}

function load(engine: Engine, code: string): void {
  reset();
  const imports: Record<string, unknown> =
    engine === 'post' ? { ...post } : { ...turing };

  const userFn = new Function('imports', code) as (i: Record<string, unknown>) => unknown;
  const result = userFn(imports);

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
  if (!generator) throw new Error('not loaded');
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
    send({ type: 'error', message: 'malformed worker message', stack: null });
    return;
  }

  const req = msg as WorkerRequest;
  try {
    if (req.type === 'load') {
      load(req.engine, req.code);
      send({
        type: 'loaded',
        tapes: snapshotTapes(),
        alphabets: snapshotAlphabets(),
        halted,
        stepsApplied,
        nextCommands: pendingCommand ? commandsFromYield(pendingCommand) : null,
      });
      return;
    }

    if (req.type === 'step') {
      if (!machine) throw new Error('not loaded');
      const { commands, nextCommands } = step();
      send({
        type: 'stepped',
        tapes: snapshotTapes(),
        halted,
        commands,
        nextCommands,
        stepsApplied,
      });
      return;
    }

    if (req.type === 'run') {
      if (!machine) throw new Error('not loaded');
      const { commands, truncated, startStep } = runToEnd(req.maxSteps ?? MAX_STEPS);
      send({
        type: 'ran',
        tapes: snapshotTapes(),
        halted,
        truncated,
        commands,
        startStep,
        stepsApplied,
      });
      return;
    }

    throw new Error(`unknown message type: ${(req as { type: string }).type}`);
  } catch (err) {
    send({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? (err.stack ?? null) : null,
    });
  }
};
