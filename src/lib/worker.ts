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
let tape: AnyTape | null = null;
let generator: Generator<MachineYield, void, void> | null = null;
let halted = false;
let stepsApplied = 0;
let pendingCommand: MachineYield | null = null;

function reset(): void {
  machine = null;
  initialState = null;
  tape = null;
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

function commandFromYield(y: MachineYield): Command {
  // B3: single-tape only. Multi-tape display is tracked as a feature request.
  if (y.movements.length !== 1) {
    throw new Error(
      `multi-tape machines (got ${y.movements.length} tapes) are not yet supported by this demo`,
    );
  }
  const movement = movementCode(y.movements[0]);
  const written = y.nextSymbols[0];
  const before = y.currentSymbols[0];
  return { movement, symbol: written === before ? null : written };
}

function snapshotTape(): TapeSnapshot {
  if (!tape) throw new Error('no tape loaded');
  return {
    symbols: [...tape.symbols],
    position: tape.position,
    blank: tape.alphabet.blankSymbol,
  };
}

function snapshotAlphabet(): string[] {
  if (!tape) throw new Error('no tape loaded');
  return [...tape.alphabet.symbols];
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

  tape = r.tape ?? machine.tape ?? machine.tapeBlock?.tapes?.[0] ?? null;
  if (!tape) {
    throw new Error('return value missing `tape` and could not derive one from the machine');
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

function step(): { command: Command | null; nextCommand: Command | null } {
  if (halted || !pendingCommand || !generator) {
    return { command: null, nextCommand: null };
  }
  const command = commandFromYield(pendingCommand);
  const r = generator.next();
  stepsApplied += 1;
  if (r.done) {
    halted = true;
    pendingCommand = null;
  } else {
    pendingCommand = r.value;
  }
  const nextCommand = pendingCommand ? commandFromYield(pendingCommand) : null;
  return { command, nextCommand };
}

function runToEnd(maxSteps: number): { commands: Command[]; truncated: boolean; startStep: number } {
  if (!generator) throw new Error('not loaded');
  const startStep = stepsApplied;
  const commands: Command[] = [];
  let extra = 0;
  while (!halted && pendingCommand && extra < maxSteps) {
    commands.push(commandFromYield(pendingCommand));
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
        tape: snapshotTape(),
        alphabet: snapshotAlphabet(),
        halted,
        stepsApplied,
        nextCommand: pendingCommand ? commandFromYield(pendingCommand) : null,
      });
      return;
    }

    if (req.type === 'step') {
      if (!machine) throw new Error('not loaded');
      const { command, nextCommand } = step();
      send({
        type: 'stepped',
        tape: snapshotTape(),
        halted,
        command,
        nextCommand,
        stepsApplied,
      });
      return;
    }

    if (req.type === 'run') {
      if (!machine) throw new Error('not loaded');
      const { commands, truncated, startStep } = runToEnd(req.maxSteps ?? MAX_STEPS);
      send({
        type: 'ran',
        tape: snapshotTape(),
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
