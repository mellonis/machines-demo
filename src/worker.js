import * as turing from '@turing-machine-js/machine';
import * as post from '@post-machine-js/machine';

let machine = null;
let initialState = null;
let tape = null;
let generator = null;
let halted = false;
let stepsApplied = 0;
let pendingCommand = null;

function movementCode(movement) {
  if (movement === turing.movements.left) return 'L';
  if (movement === turing.movements.right) return 'R';
  return 'S';
}

function commandFromYield(yielded) {
  if (!yielded) return null;
  const movement = movementCode(yielded.movements[0]);
  const written = yielded.nextSymbols[0];
  const before = yielded.currentSymbols[0];
  return { movement, symbol: written === before ? null : written };
}

function snapshotTape() {
  if (!tape) return null;
  return {
    symbols: tape.symbols,
    position: tape.position,
    blank: tape.alphabet.blankSymbol,
  };
}

function snapshotAlphabet() {
  if (!tape) return null;
  return tape.alphabet.symbols;
}

function reset() {
  machine = null;
  initialState = null;
  tape = null;
  generator = null;
  halted = false;
  stepsApplied = 0;
  pendingCommand = null;
}

function load(mode, code) {
  reset();
  const imports = mode === 'post' ? { ...post } : { ...turing };
  const userFn = new Function('imports', code);
  const result = userFn(imports);

  if (!result || typeof result !== 'object') {
    throw new Error('user code must return { machine, initialState?, tape? }');
  }

  machine = result.machine;
  if (!machine) throw new Error('return value missing `machine`');

  initialState = result.initialState ?? machine.initialState ?? null;
  if (!initialState) throw new Error('return value missing `initialState` and machine has no `initialState` getter');

  tape = result.tape ?? machine.tape ?? machine.tapeBlock?.tapes?.[0] ?? null;
  if (!tape) throw new Error('return value missing `tape` and could not derive one from the machine');

  // Prime the generator: the first yield is the command queued to be applied
  // by the next call to step(). Each subsequent next() applies the previously
  // yielded command and yields the next one.
  generator = machine.runStepByStep({ initialState });
  const first = generator.next();
  if (first.done) {
    halted = true;
    pendingCommand = null;
  } else {
    pendingCommand = first.value;
  }
}

function step() {
  if (halted || !pendingCommand) {
    return { halted: true, applied: false, command: null, nextCommand: null };
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
  return { halted, applied: true, command, nextCommand };
}

function runToEnd(maxSteps = 100000) {
  const startSteps = stepsApplied;
  const commands = [];
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
    } else {
      pendingCommand = r.value;
    }
  }
  return { halted, ranSteps: extra, truncated: !halted && extra >= maxSteps, commands, startSteps };
}

self.onmessage = (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'load') {
      load(msg.mode, msg.code);
      self.postMessage({
        type: 'loaded',
        tape: snapshotTape(),
        alphabet: snapshotAlphabet(),
        halted,
        stepsApplied,
        nextCommand: pendingCommand ? commandFromYield(pendingCommand) : null,
      });
      return;
    }

    if (msg.type === 'step') {
      if (!machine) throw new Error('not loaded');
      const r = step();
      self.postMessage({
        type: 'stepped',
        tape: snapshotTape(),
        halted: r.halted,
        applied: r.applied,
        command: r.command,
        nextCommand: r.nextCommand,
        stepsApplied,
      });
      return;
    }

    if (msg.type === 'run') {
      if (!machine) throw new Error('not loaded');
      const r = runToEnd(msg.maxSteps);
      self.postMessage({
        type: 'ran',
        tape: snapshotTape(),
        halted: r.halted,
        ranSteps: r.ranSteps,
        truncated: r.truncated,
        commands: r.commands,
        startSteps: r.startSteps,
        stepsApplied,
      });
      return;
    }

    throw new Error(`unknown message type: ${msg.type}`);
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err?.message ?? String(err),
      stack: err?.stack ?? null,
    });
  }
};
