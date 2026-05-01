import type { Engine } from './types.ts';

const TURING = `// Task: replace every 'b' on the tape with '*'.

/*
 * Available imports (named exports of @turing-machine-js/machine):
 *   Alphabet, State, Tape, TapeBlock, TuringMachine,
 *   haltState, ifOtherSymbol, movements, symbolCommands, ...
 *
 * Return: { machine, initialState, tape }
 */

const {
  Alphabet, State, Tape, TapeBlock, TuringMachine,
  haltState, ifOtherSymbol, movements,
} = imports;

const alphabet = new Alphabet([' ', 'a', 'b', 'c', '*']);
const tape = new Tape({ alphabet, symbols: ['a', 'b', 'c', 'b', 'a'] });
const tapeBlock = TapeBlock.fromTapes([tape]);
const machine = new TuringMachine({ tapeBlock });

const initialState = new State({
  [tapeBlock.symbol(['b'])]: {
    command: [{ symbol: '*', movement: movements.right }],
  },
  [tapeBlock.symbol([alphabet.blankSymbol])]: {
    command: [{ movement: movements.left }],
    nextState: haltState,
  },
  [ifOtherSymbol]: {
    command: [{ movement: movements.right }],
  },
});

return { machine, initialState, tape };
`;

const POST = `// Task: walk right while marked; mark the first blank cell found.

/*
 * Available imports (named exports of @post-machine-js/machine):
 *   PostMachine, Tape, alphabet, blankSymbol, markSymbol,
 *   call, check, erase, left, mark, noop, right, stop, ...
 *
 * Return: { machine } — initialState and tape default from the machine.
 */

const { PostMachine, Tape, check, mark, right, stop } = imports;

const machine = new PostMachine({
  10: check(20, 30),
  20: right(10),
  30: mark,
  40: stop,
});

machine.replaceTapeWith(new Tape({
  alphabet: machine.tape.alphabet,
  symbols: ['*', '*', ' '],
}));

return { machine };
`;

export function defaultCode(engine: Engine): string {
  return engine === 'post' ? POST : TURING;
}
