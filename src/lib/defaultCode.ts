import type { Engine } from './types.ts';

export type Example = {
  id: string;
  title: string;
  code: string;
};

const TURING_REPLACE_B = `// Task: replace every 'b' on the tape with '*'.

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

const TURING_COPY_TWO_TAPES = `// Task: copy tape 0 ('abab') onto blank tape 1, both heads moving right.
// Demonstrates multi-tape: TapeBlock.fromTapes([t0, t1]).

/*
 * Available imports (named exports of @turing-machine-js/machine):
 *   Alphabet, State, Tape, TapeBlock, TuringMachine,
 *   haltState, ifOtherSymbol, movements, symbolCommands, ...
 *
 * Return: { machine, initialState }
 */

const {
  Alphabet, State, Tape, TapeBlock, TuringMachine,
  haltState, ifOtherSymbol, movements,
} = imports;

const alphabet = new Alphabet([' ', 'a', 'b']);
const t0 = new Tape({ alphabet, symbols: ['a', 'b', 'a', 'b'] });
const t1 = new Tape({ alphabet, symbols: [] });
const tapeBlock = TapeBlock.fromTapes([t0, t1]);
const machine = new TuringMachine({ tapeBlock });

const { symbol } = tapeBlock;

const initialState = new State({
  [symbol(['a', ifOtherSymbol])]: {
    command: [
      { symbol: 'a', movement: movements.right },
      { symbol: 'a', movement: movements.right },
    ],
  },
  [symbol(['b', ifOtherSymbol])]: {
    command: [
      { symbol: 'b', movement: movements.right },
      { symbol: 'b', movement: movements.right },
    ],
  },
  [symbol([' ', ifOtherSymbol])]: {
    command: [
      { movement: movements.stay },
      { movement: movements.stay },
    ],
    nextState: haltState,
  },
});

return { machine, initialState };
`;

const POST_WALK_MARK = `// Task: walk right while marked; mark the first blank cell found.

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

const TURING_EXAMPLES: readonly Example[] = [
  { id: 'replace-b', title: "Replace 'b' with '*'", code: TURING_REPLACE_B },
  { id: 'copy-two-tapes', title: 'Copy tape (multi-tape)', code: TURING_COPY_TWO_TAPES },
];

const POST_EXAMPLES: readonly Example[] = [
  { id: 'walk-mark', title: 'Walk right; mark first blank', code: POST_WALK_MARK },
];

export function examples(engine: Engine): readonly Example[] {
  return engine === 'post' ? POST_EXAMPLES : TURING_EXAMPLES;
}

export function findExample(engine: Engine, id: string): Example | undefined {
  return examples(engine).find((e) => e.id === id);
}

export function defaultExample(engine: Engine): Example {
  return examples(engine)[0];
}

export function defaultCode(engine: Engine): string {
  return defaultExample(engine).code;
}
