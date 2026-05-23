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
 *
 * Note: the demo runs the machine; do not call .run() or .runStepByStep() yourself.
 */

const {
  Alphabet, State, Tape, TapeBlock, TuringMachine,
  haltState, ifOtherSymbol, movements,
} = imports;

const alphabet = new Alphabet(['␣', 'a', 'b', 'c', '*']);
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
 *
 * Note: the demo runs the machine; do not call .run() or .runStepByStep() yourself.
 */

const {
  Alphabet, State, Tape, TapeBlock, TuringMachine,
  haltState, ifOtherSymbol, movements,
} = imports;

const alphabet = new Alphabet(['␣', 'a', 'b']);
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
  [symbol(['␣', ifOtherSymbol])]: {
    command: [
      { movement: movements.stay },
      { movement: movements.stay },
    ],
    nextState: haltState,
  },
});

return { machine, initialState };
`;

const TURING_CALLABLE_SUBTREE = `// Task: walk right to the first blank cell, then mark it with '*'.
// Demonstrates a callable subtree via State.withOverriddenHaltState:
// 'walkToBlank' self-loops while reading a letter and halts at the first
// blank. Halting INSIDE a wrapped subroutine pops the engine's halt-stack
// and resumes at the wrapper's continuation ('writeMarker') instead of
// terminating the run.
//
// In the rendered state graph, the subroutine sits inside a dashed
// subgraph frame; the frame's border lights up while m.state is INSIDE
// it (during the self-loop iters), then unlights when execution returns
// to the after-call continuation.

/*
 * Available imports (named exports of @turing-machine-js/machine):
 *   Alphabet, State, Tape, TapeBlock, TuringMachine,
 *   haltState, ifOtherSymbol, movements, ...
 *
 * Return: { machine, initialState }
 */

const {
  Alphabet, State, Tape, TapeBlock, TuringMachine,
  haltState, ifOtherSymbol, movements,
} = imports;

const alphabet = new Alphabet([' ', 'a', 'b', '*']);
const tape = new Tape({ alphabet, symbols: ['a', 'b', 'a'] });
const tapeBlock = TapeBlock.fromTapes([tape]);
const machine = new TuringMachine({ tapeBlock });
const { symbol } = tapeBlock;

// Subroutine: walk right while reading a letter; halt at the first blank.
// (A 'halt' inside this subroutine = return to caller's continuation.)
// Note key order: specific patterns first, ifOtherSymbol last — State
// returns the first matching key, and ifOtherSymbol always matches.
const walkToBlank = new State({
  [symbol([alphabet.blankSymbol])]: {
    command: [{ movement: movements.stay }],
    nextState: haltState,
  },
  [ifOtherSymbol]: {
    command: [{ movement: movements.right }],
  },
}, 'walkToBlank');

// Continuation: write '*' under the head and halt for real.
const writeMarker = new State({
  [ifOtherSymbol]: {
    command: [{ symbol: '*', movement: movements.stay }],
    nextState: haltState,
  },
}, 'writeMarker');

// Entry: call walkToBlank, then resume with writeMarker.
const initialState = walkToBlank.withOverriddenHaltState(writeMarker);

return { machine, initialState };
`;

const POST_WALK_MARK = `// Task: walk right while marked; mark the first blank cell found.

/*
 * Available imports (named exports of @post-machine-js/machine):
 *   PostMachine, Tape, alphabet, blankSymbol, markSymbol,
 *   call, check, erase, left, mark, noop, right, stop, ...
 *
 * Return: { machine } — initialState and tape default from the machine.
 *
 * Note: the demo runs the machine; do not call .run() or .runStepByStep() yourself.
 */

const { PostMachine, Tape, check, mark, right, stop } = imports;

const machine = new PostMachine(
  {
    10: check(20, 30),
    20: right(10),
    30: mark,
    40: stop,
  },
  { blankSymbol: '␣', markSymbol: '•' },
);

machine.replaceTapeWith(new Tape({
  alphabet: machine.tape.alphabet,
  symbols: ['•', '•', '␣'],
}));

return { machine };
`;

const TURING_EXAMPLES: readonly Example[] = [
  { id: 'replace-b', title: "Replace 'b' with '*'", code: TURING_REPLACE_B },
  { id: 'copy-two-tapes', title: 'Copy tape (multi-tape)', code: TURING_COPY_TWO_TAPES },
  { id: 'callable-subtree', title: 'Callable subtree (withOverriddenHaltState)', code: TURING_CALLABLE_SUBTREE },
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
