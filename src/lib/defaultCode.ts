import type { Engine } from './types.ts';

export type Example = {
  id: string;
  title: string;
  code: string;
  // Phase 1: showcase flag drives the Vite snippet recorder; description appears
  // as the panel caption; intervalMs overrides the playback default (800ms).
  showcase?: boolean;
  description?: string;
  // Rich learning-oriented prose shown beside the player in showcase panels.
  // Supports a tight markdown subset: paragraphs (blank-line separated),
  // bullet lists (lines starting with `- `), inline code (backticks).
  lessonNotes?: string;
  intervalMs?: number;
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

const TURING_TOGGLE_BITS = `// Task: toggle every bit on the tape (0 ↔ 1) until blank.

/*
 * Available imports (named exports of @turing-machine-js/machine):
 *   Alphabet, State, Tape, TapeBlock, TuringMachine,
 *   haltState, ifOtherSymbol, movements, ...
 *
 * Return: { machine, initialState, tape }
 *
 * Note: the demo runs the machine; do not call .run() or .runStepByStep() yourself.
 */

const {
  Alphabet, State, Tape, TapeBlock, TuringMachine,
  haltState, ifOtherSymbol, movements,
} = imports;

const alphabet = new Alphabet([' ', '0', '1']);
const tape = new Tape({ alphabet, symbols: ['0', '1', '1', '0', '1'] });
const tapeBlock = TapeBlock.fromTapes([tape]);
const machine = new TuringMachine({ tapeBlock });

// Two literal patterns flip each cell; ifOtherSymbol matches the blank
// and halts. The State returns the first matching key, so the literals
// listed before ifOtherSymbol win when they match.
const initialState = new State({
  [tapeBlock.symbol(['0'])]: {
    command: [{ symbol: '1', movement: movements.right }],
  },
  [tapeBlock.symbol(['1'])]: {
    command: [{ symbol: '0', movement: movements.right }],
  },
  [ifOtherSymbol]: {
    command: [{ movement: movements.stay }],
    nextState: haltState,
  },
});

return { machine, initialState, tape };
`;

const TURING_ABORT_VALIDATE = `// Task: validate that the tape holds only bits (0/1), scanning from inside
// a called subroutine; ABORT the whole run on the first unexpected symbol.
// Contrast with 'callable-subtree': a halt INSIDE the call returns to the
// caller's continuation, but abort punches straight through every pending
// call frame and terminates the run — the continuation is never reached.

/*
 * Available imports (named exports of @turing-machine-js/machine):
 *   Alphabet, State, Tape, TapeBlock, TuringMachine,
 *   haltState, abortState, ifOtherSymbol, movements, ...
 *
 * Return: { machine, initialState }
 */

const {
  Alphabet, State, Tape, TapeBlock, TuringMachine,
  haltState, abortState, ifOtherSymbol, movements,
} = imports;

const alphabet = new Alphabet([' ', '0', '1', 'x']);
const tape = new Tape({ alphabet, symbols: ['1', '0', 'x', '1'] });
const tapeBlock = TapeBlock.fromTapes([tape]);
const machine = new TuringMachine({ tapeBlock });
const { symbol } = tapeBlock;

// Subroutine: walk right over bits; RETURN (in-call halt) at the first
// blank; ABORT on anything else.
const scanBits = new State({
  [symbol(['0'])]: { command: [{ movement: movements.right }] },
  [symbol(['1'])]: { command: [{ movement: movements.right }] },
  [symbol([alphabet.blankSymbol])]: {
    command: [{ movement: movements.stay }],
    nextState: haltState,
  },
  [ifOtherSymbol]: {
    command: [{ movement: movements.stay }],
    nextState: abortState,
  },
}, 'scanBits');

// Continuation: only reached when the scan returns cleanly — with this
// tape (it contains an 'x') it never runs.
const accept = new State({
  [ifOtherSymbol]: {
    command: [{ movement: movements.stay }],
    nextState: haltState,
  },
}, 'accept');

const initialState = scanBits.withOverriddenHaltState(accept);

return { machine, initialState };
`;

const POST_MARK_AND_STEP = `// Task: mark the current cell, step right, mark again, step right. Halt.
// Pure-sequential program — no branching. The simplest interesting
// Post-machine pattern: mutate the tape, advance the head, repeat.

/*
 * Available imports (named exports of @post-machine-js/machine):
 *   PostMachine, Tape, alphabet, blankSymbol, markSymbol,
 *   call, check, erase, left, mark, noop, right, stop, ...
 *
 * Return: { machine } — initialState and tape default from the machine.
 */

const { PostMachine, Tape, mark, right, stop } = imports;

const machine = new PostMachine(
  {
    10: mark,
    20: right,
    30: mark,
    40: right,
    50: mark,
    60: stop,
  },
  { blankSymbol: '␣', markSymbol: '•' },
);

machine.replaceTapeWith(new Tape({
  alphabet: machine.tape.alphabet,
  symbols: ['␣', '␣', '␣'],
}));

return { machine };
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

const POST_CALL_SUBROUTINE = `// Task: walk to the first blank and mark it; step past; walk to the
// next blank and mark it. Halt.
// Demonstrates 'call' — a string-keyed subroutine reused from main.
// 'stop' inside the subroutine = return to caller's continuation.
// In the rendered graph, 'walkToBlank' sits inside a dashed subgraph
// frame; the frame's border lights up while execution is inside it.

/*
 * Available imports (named exports of @post-machine-js/machine):
 *   PostMachine, Tape, alphabet, blankSymbol, markSymbol,
 *   call, check, erase, left, mark, noop, right, stop, ...
 */

const { PostMachine, Tape, call, check, mark, right, stop } = imports;

const machine = new PostMachine({
  walkToBlank: {
    1: check(2, 3),  // marked? continue walking, else return
    2: right(1),     // walk right, loop
    3: stop,         // blank reached → return to caller
  },
  10: call('walkToBlank'),
  20: mark,
  30: right,         // step past the just-marked cell
  40: call('walkToBlank'),
  50: mark,
  60: stop,
}, { blankSymbol: '␣', markSymbol: '•' });

machine.replaceTapeWith(new Tape({
  alphabet: machine.tape.alphabet,
  symbols: ['•', '•', '␣', '•', '•', '␣', '␣'],
}));

return { machine };
`;

const POST_ABORT_GUARD = `// Task: expect a mark under the head, three times, stepping right between
// checks. The guard subroutine RETURNS ('stop') on a mark and ABORTS the
// entire run ('abort') on a blank. The third check lands on a blank.
// 'stop' inside a subroutine means return-to-caller (classical halt);
// 'abort' has no continuation — it terminates the run from any depth.

/*
 * Available imports (named exports of @post-machine-js/machine):
 *   PostMachine, Tape, alphabet, blankSymbol, markSymbol,
 *   abort, call, check, erase, left, mark, noop, right, stop, ...
 */

const { PostMachine, Tape, abort, call, check, right, stop } = imports;

const machine = new PostMachine({
  expectMark: {
    1: check(2, 3),  // marked? return; blank? abort the whole run
    2: stop,         // return to caller's continuation
    3: abort,        // abnormal termination — punches through the call
  },
  10: call('expectMark'),
  20: right,
  30: call('expectMark'),
  40: right,
  50: call('expectMark'),
  60: stop,          // never reached with this tape
}, { blankSymbol: '␣', markSymbol: '•' });

machine.replaceTapeWith(new Tape({
  alphabet: machine.tape.alphabet,
  symbols: ['•', '•', '␣'],
}));

return { machine };
`;

const TURING_BRAINFUCK_UTM = `// ─── Brainfuck UTM as a Turing machine ───────────────────────────────────────
// One fixed state graph (~20 states) that interprets ANY brainfuck source
// loaded on the program tape. Demonstrates a Universal Turing Machine.
//
// Architecture: 4 tapes in one TapeBlock
//   [0] program   bf source + 'H' sentinel; head = instruction pointer
//   [1] data      bf cells; head = data pointer
//   [2] output    cells written by '.'
//   [3] counter   unary stack of bracket-nesting levels (used by skip-bracket)
//
// Counter invariant: pointer is on the TOP of the stack ('*') or on a blank
// cell when the stack is empty. push = move-R then write '*'. pop = write
// ' ' then move-L.  Pop on empty would underflow — only happens on imbalanced
// bf sources, which we trust to be balanced.
//
// To run a different bf program: change PROGRAM_TEXT below and re-build.

const PROGRAM_TEXT = '++++++++[>++++[>++>+++>+++>+<<<<-]>+>+>->>+[<]<-]>>.>---.+++++++..+++.>>.<-.<.+++.------.--------.>>+.>++.';
// classic Hello World — prints "Hello World!\\n"

// ─── other programs to try ────────────────────────────────────────────────
// Swap any of these into PROGRAM_TEXT above and re-Build. All halt well within
// the demo's caps; step counts noted so you know what a Run/Step costs.
//   '++++++++[>++++++++<-]>+.'                            → "A"   (~329 steps)  tiny — good for stepping through fetch→exec
//   '[++++++++].'                                         → "·"   (~16 steps)   the bracket-SKIP path: loop guard is 0, so the
//                                                                              body is skipped via the counter (stack) tape
//   '++[>++[>+<-]<-]>>.'                                  → "₄"   (~117 steps)  nested loops → deeper pushes on the counter tape
//   '++++++++[>+++++++++<-]>.>++++++++[>+++++++++++++<-]>+.' → "Hi" (~795 steps)  sequencing two characters

const {
  Alphabet, State, Tape, TapeBlock, TuringMachine, Reference,
  haltState, ifOtherSymbol, movements,
} = imports;

const { left: L, right: R, stay: S } = movements;

// ─── data alphabet: byte (0..127) → printable glyph ────────────────────────
// Choosing glyphs so the data/output tapes are readable on the animated belt.
const N = 128;
const BYTE_TO_GLYPH = new Array(N);
BYTE_TO_GLYPH[0] = '·';                                  // zero / blank
for (let i = 1; i < 10; i++) BYTE_TO_GLYPH[i] = '₀₁₂₃₄₅₆₇₈₉'[i];
BYTE_TO_GLYPH[10] = '↵';                                 // \\n
for (let i = 11; i < 32; i++) BYTE_TO_GLYPH[i] = String.fromCharCode(0x24B6 + (i - 11));
for (let i = 32; i < 127; i++) BYTE_TO_GLYPH[i] = String.fromCharCode(i);  // printable ASCII as itself
BYTE_TO_GLYPH[127] = '⌫';
const DATA_ZERO = '·';

const PROG_ALPHA = new Alphabet([' ', '+', '-', '<', '>', '.', '[', ']', 'H']);
const DATA_ALPHA = new Alphabet(BYTE_TO_GLYPH);
const CNT_ALPHA  = new Alphabet([' ', '*']);

// ─── tapes ──────────────────────────────────────────────────────────────────
const t_prog = new Tape({ alphabet: PROG_ALPHA, symbols: [...PROGRAM_TEXT, 'H'], position: 0 });
const t_data = new Tape({ alphabet: DATA_ALPHA, symbols: Array(16).fill(DATA_ZERO), position: 0 });
const t_out  = new Tape({ alphabet: DATA_ALPHA, symbols: Array(32).fill(DATA_ZERO), position: 0 });
const t_cnt  = new Tape({ alphabet: CNT_ALPHA,  symbols: Array(64).fill(' '), position: 0 });
const tapeBlock = TapeBlock.fromTapes([t_prog, t_data, t_out, t_cnt]);
const machine = new TuringMachine({ tapeBlock });

// ─── per-tape command shorthands ────────────────────────────────────────────
const nop  = { movement: S };
const movR = { movement: R };
const movL = { movement: L };
const wr   = (sym, mv = S) => ({ symbol: sym, movement: mv });
const cmd  = (p, d, o, c) => [p, d, o, c];

// 4-tape symbol key. null entries become ifOtherSymbol (per-tape wildcard).
const key = (p, d, o, c) =>
  tapeBlock.symbol([p ?? ifOtherSymbol, d ?? ifOtherSymbol, o ?? ifOtherSymbol, c ?? ifOtherSymbol]);

// ─── refs for cyclic graph ──────────────────────────────────────────────────
const fetchRef   = new Reference();
const skipFwdRef = new Reference();
const skipBwdRef = new Reference();

// ─── execute '+' / '-' (table over data alphabet) ──────────────────────────
const execPlus = (() => {
  const def = {};
  for (let v = 0; v < N; v++) {
    const next = (v + 1) % N;
    def[key(null, BYTE_TO_GLYPH[v], null, null)] = {
      command: cmd(movR, wr(BYTE_TO_GLYPH[next]), nop, nop), nextState: fetchRef,
    };
  }
  return new State(def, 'execPlus');
})();

const execMinus = (() => {
  const def = {};
  for (let v = 0; v < N; v++) {
    const prev = (v - 1 + N) % N;
    def[key(null, BYTE_TO_GLYPH[v], null, null)] = {
      command: cmd(movR, wr(BYTE_TO_GLYPH[prev]), nop, nop), nextState: fetchRef,
    };
  }
  return new State(def, 'execMinus');
})();

// ─── execute '>' / '<' ──────────────────────────────────────────────────────
const execRight = new State({
  [ifOtherSymbol]: { command: cmd(movR, movR, nop, nop), nextState: fetchRef },
}, 'execRight');

const execLeft = new State({
  [ifOtherSymbol]: { command: cmd(movR, movL, nop, nop), nextState: fetchRef },
}, 'execLeft');

// ─── execute '.' (copy data cell to output tape, advance output) ───────────
const execDot = (() => {
  const def = {};
  for (let v = 0; v < N; v++) {
    def[key(null, BYTE_TO_GLYPH[v], null, null)] = {
      command: cmd(movR, nop, wr(BYTE_TO_GLYPH[v], R), nop), nextState: fetchRef,
    };
  }
  return new State(def, 'execDot');
})();

// ─── skip-forward (when '[' with data == 0) ─────────────────────────────────
// Scans the program tape rightward, maintaining a unary stack of nesting
// levels on the counter tape. Exits when the stack underflows past the
// matching ']'. Push/pop each take two states because TapeCommand is
// "write-then-move", and a correct push needs "move-then-write".
const skipFwdMainRef       = new Reference();
const skipFwdPushFinishRef = new Reference();
const skipFwdPopCheckRef   = new Reference();

const skipFwdMain = new State({
  [key('[', null, null, null)]: { command: cmd(movR, nop, nop, movR),       nextState: skipFwdPushFinishRef },
  [key(']', null, null, null)]: { command: cmd(movR, nop, nop, wr(' ', L)), nextState: skipFwdPopCheckRef },
  [ifOtherSymbol]:               { command: cmd(movR, nop, nop, nop),        nextState: skipFwdMainRef },
}, 'skipFwdMain');
skipFwdMainRef.bind(skipFwdMain);
skipFwdRef.bind(skipFwdMain);

const skipFwdPushFinish = new State({
  [ifOtherSymbol]: { command: cmd(nop, nop, nop, wr('*')), nextState: skipFwdMainRef },
}, 'skipFwdPushFinish');
skipFwdPushFinishRef.bind(skipFwdPushFinish);

const skipFwdPopCheck = new State({
  [key(null, null, null, ' ')]: { command: cmd(nop, nop, nop, nop), nextState: fetchRef },
  [key(null, null, null, '*')]: { command: cmd(nop, nop, nop, nop), nextState: skipFwdMainRef },
}, 'skipFwdPopCheck');
skipFwdPopCheckRef.bind(skipFwdPopCheck);

// ─── skip-backward (when ']' with data != 0) ────────────────────────────────
// Mirror image of skipFwd: program moves left, ']' pushes, '[' pops.
const skipBwdMainRef       = new Reference();
const skipBwdPushFinishRef = new Reference();
const skipBwdPopCheckRef   = new Reference();

const skipBwdMain = new State({
  [key(']', null, null, null)]: { command: cmd(movL, nop, nop, movR),       nextState: skipBwdPushFinishRef },
  [key('[', null, null, null)]: { command: cmd(movL, nop, nop, wr(' ', L)), nextState: skipBwdPopCheckRef },
  [ifOtherSymbol]:               { command: cmd(movL, nop, nop, nop),        nextState: skipBwdMainRef },
}, 'skipBwdMain');
skipBwdMainRef.bind(skipBwdMain);
skipBwdRef.bind(skipBwdMain);

const skipBwdPushFinish = new State({
  [ifOtherSymbol]: { command: cmd(nop, nop, nop, wr('*')), nextState: skipBwdMainRef },
}, 'skipBwdPushFinish');
skipBwdPushFinishRef.bind(skipBwdPushFinish);

// After a successful pop we stand one cell LEFT of the matching '['.
// Step program back to R so fetch sees '['.
const skipBwdPopCheck = new State({
  [key(null, null, null, ' ')]: { command: cmd(movR, nop, nop, nop), nextState: fetchRef },
  [key(null, null, null, '*')]: { command: cmd(nop, nop, nop, nop),  nextState: skipBwdMainRef },
}, 'skipBwdPopCheck');
skipBwdPopCheckRef.bind(skipBwdPopCheck);

// ─── execute '[' / ']' ─────────────────────────────────────────────────────
// data == 0 → start skip-forward with a single counter level pushed
// data != 0 → enter loop body (just IP++)
const execLBracketPushFinishRef = new Reference();
const execLBracket = new State({
  [key(null, DATA_ZERO, null, null)]: { command: cmd(movR, nop, nop, movR), nextState: execLBracketPushFinishRef },
  [ifOtherSymbol]:                     { command: cmd(movR, nop, nop, nop),  nextState: fetchRef },
}, 'execLBracket');

const execLBracketPushFinish = new State({
  [ifOtherSymbol]: { command: cmd(nop, nop, nop, wr('*')), nextState: skipFwdRef },
}, 'execLBracketPushFinish');
execLBracketPushFinishRef.bind(execLBracketPushFinish);

const execRBracketPushFinishRef = new Reference();
const execRBracket = new State({
  [key(null, DATA_ZERO, null, null)]: { command: cmd(movR, nop, nop, nop), nextState: fetchRef },
  [ifOtherSymbol]:                     { command: cmd(movL, nop, nop, movR), nextState: execRBracketPushFinishRef },
}, 'execRBracket');

const execRBracketPushFinish = new State({
  [ifOtherSymbol]: { command: cmd(nop, nop, nop, wr('*')), nextState: skipBwdRef },
}, 'execRBracketPushFinish');
execRBracketPushFinishRef.bind(execRBracketPushFinish);

// ─── fetch (the main CPU loop dispatch) ────────────────────────────────────
const initialState = new State({
  [key('+')]: { command: cmd(nop, nop, nop, nop), nextState: execPlus },
  [key('-')]: { command: cmd(nop, nop, nop, nop), nextState: execMinus },
  [key('>')]: { command: cmd(nop, nop, nop, nop), nextState: execRight },
  [key('<')]: { command: cmd(nop, nop, nop, nop), nextState: execLeft },
  [key('.')]: { command: cmd(nop, nop, nop, nop), nextState: execDot },
  [key('[')]: { command: cmd(nop, nop, nop, nop), nextState: execLBracket },
  [key(']')]: { command: cmd(nop, nop, nop, nop), nextState: execRBracket },
  [key('H')]: { command: cmd(nop, nop, nop, nop), nextState: haltState },
}, 'fetch');
fetchRef.bind(initialState);

return { machine, initialState };
`;

const TURING_EXAMPLES: readonly Example[] = [
  {
    id: 'replace-b',
    title: "Replace 'b' with '*'",
    code: TURING_REPLACE_B,
    showcase: true,
    description: "Replace each 'b' with '*'; halt at blank.",
    lessonNotes: `A single-pass rewrite. The head walks rightward across the tape; every \`b\` it sees becomes \`*\`, everything else is left alone. The first blank cell stops the program.

One state \`S\` does all the work. Its outgoing arcs are:

- on \`b\` — write \`*\`, move right, stay in \`S\`.
- on any other letter — keep the symbol, move right, stay in \`S\`.
- on blank — halt.

On the graph this reads as a single self-loop carrying the rewrite cases and one halt-bound arc. There is no branching — just a streaming pass.`,
  },
  {
    id: 'toggle-bits',
    title: 'Toggle bits (0 ↔ 1)',
    code: TURING_TOGGLE_BITS,
    showcase: true,
    description: 'Flip each bit (0↔1); halt at blank.',
    lessonNotes: `A binary NOT pass. Every \`0\` becomes \`1\` and every \`1\` becomes \`0\` until the head meets a blank.

The single state \`S\` has three arcs:

- on \`0\` — write \`1\`, move right, stay in \`S\`.
- on \`1\` — write \`0\`, move right, stay in \`S\`.
- on blank — halt.

Same shape as \`replace-b\` but with the rewrite split across two literal cases instead of one. Watch the tape cells flash as each bit toggles — the head never reads back, so every cell is touched exactly once.`,
  },
  {
    id: 'callable-subtree',
    title: 'Callable subtree (withOverriddenHaltState)',
    code: TURING_CALLABLE_SUBTREE,
    showcase: true,
    description: 'Subroutine: walk to blank, then mark; the subgraph frame highlights during the call.',
    lessonNotes: `A composed program: the main flow calls a reusable subroutine and then continues. The subroutine \`walkToBlank\` self-loops on letters until it meets a blank; the continuation \`writeMarker\` stamps \`*\` and halts for real.

The call is set up with \`State.withOverriddenHaltState\`. Halting INSIDE the subroutine is reinterpreted as "return to the wrapper's continuation" — the engine never actually halts on the first blank, it pops out to \`writeMarker\`, which marks and then halts at the top level.

What to look for on the graph:

- The dashed cluster around \`walkToBlank\` IS the callable subtree. Its border lights up while execution is inside the subroutine.
- The composite \`walkToBlank(writeMarker)\` node is the wrapper — the entry handle for the call. It lights up alongside the bare on the call-entry iter.
- The bold \`call\` arrow (wrapper → bare) is the call edge.
- The dotted \`return\` arrow leaves the cluster back out to \`writeMarker\` — that's the path the engine takes when the bare halts inside the subroutine.`,
  },
  {
    id: 'abort-validate',
    title: 'Abort on invalid input (abortState)',
    code: TURING_ABORT_VALIDATE,
    showcase: true,
    description: "Validate bits from a subroutine; abort punches through the call on 'x'.",
    lessonNotes: `An input validator built as a called subroutine — and the machine's OTHER terminal. \`scanBits\` walks rightward over \`0\`s and \`1\`s; a blank means "input is clean" and the run should continue; anything else means the input is malformed and the whole run must end NOW.

The two endings use two different sentinels:

- on blank — \`haltState\`. But \`scanBits\` runs INSIDE a call (\`withOverriddenHaltState\`), so this halt is reinterpreted as "return to the continuation \`accept\`" — the same mechanics as \`callable-subtree\`.
- on anything else — \`abortState\`. Abort is never reinterpreted: it punches through the pending call frame and terminates the run from any depth. \`accept\` is never reached with this tape (it holds an \`x\`).

What to look for on the graph:

- the dashed-red \`abort\` node is the second terminal, drawn apart from the halt ring.
- the arc into it leaves from INSIDE the subroutine cluster — no return arrow, no continuation: the run just ends.
- compare with the dotted \`return\` arrow the clean ending takes to \`accept\` — that path exists, this tape just never takes it.`,
  },
  { id: 'copy-two-tapes', title: 'Copy tape (multi-tape)', code: TURING_COPY_TWO_TAPES },
  { id: 'brainfuck-utm', title: 'Brainfuck UTM — a universal machine', code: TURING_BRAINFUCK_UTM },
];

const POST_EXAMPLES: readonly Example[] = [
  {
    id: 'mark-and-step',
    title: 'Mark, step, mark, step, mark',
    code: POST_MARK_AND_STEP,
    showcase: true,
    description: 'Mark, step right, repeat — pure sequential, no branches.',
    lessonNotes: `A straight-line Post program with no branching: \`mark\`, step right, \`mark\`, step right, \`mark\`. Three rewrites and the program halts.

Each numbered instruction in the program becomes a node on the graph; transitions are unconditional \`goto next\`. There are no \`check\` instructions, so no decisions — the entire flow is one chain from start to halt.

Compared to the Turing examples, the Post-instruction → state-graph mapping is laid bare here: one instruction, one node, one outgoing arc.`,
  },
  {
    id: 'walk-mark',
    title: 'Walk past marks; mark first blank',
    code: POST_WALK_MARK,
    showcase: true,
    description: 'Skip past marks; mark the first blank cell.',
    lessonNotes: `A scanning loop. The head walks rightward past any \`*\` already on the tape, then drops a \`*\` on the first blank cell it finds and halts.

The structure is one \`check\` (branch on "is this cell marked?") plus two short paths:

- marked → \`right\`, then jump back to the check — keep scanning.
- blank → \`mark\`, then halt — done.

On the graph, the cycle is the scanning loop; the halt-bound branch is the "found a blank" exit. This is the smallest Post program that exhibits a real loop.`,
  },
  {
    id: 'call-subroutine',
    title: 'Subroutine: walk-to-blank, called twice',
    code: POST_CALL_SUBROUTINE,
    showcase: true,
    description: 'Subroutine: walk to a blank and mark it; called twice from main.',
    lessonNotes: `A Post program that defines a reusable subroutine and CALLS it twice. The subroutine body is the same scanning loop as \`walk-mark\` above.

The main program is just two \`call\` instructions in sequence; the subroutine walks rightward over any existing marks and stamps \`*\` on the first blank, then trails into a halt. Each \`call\` from main:

- enters the subroutine (engine pushes the return address onto its call stack).
- runs the subroutine to its trailing halt.
- pops the call stack — execution returns to the instruction AFTER the call in main.

Between the two calls, the head sits on the cell just marked by the first call, so the second call resumes scanning rightward from there.

On the graph, the dashed cluster bundles the subroutine instructions — that's the callable subtree. Two separate \`call\` sites in main produce two separate wrapper-entries into the cluster, but the body inside is shared.`,
  },
  {
    id: 'abort-guard',
    title: 'Guard subroutine: stop vs abort',
    code: POST_ABORT_GUARD,
    showcase: true,
    description: 'Guard subroutine: stop = return, abort = kill the whole run.',
    lessonNotes: `A guard pattern contrasting the Post machine's two termination commands. Main expects a mark under the head three times, stepping right between checks; the \`expectMark\` subroutine enforces it.

- \`stop\` is the classical halt. Inside a subroutine it means "this scope is done" — execution RETURNS to the caller's continuation. The first two calls take this path.
- \`abort\` is the extension command for abnormal termination. It has no continuation at all: from any depth it ends the entire run. The third call lands on a blank and takes this path — instruction \`60\` never executes.

On a two-symbol machine there is no room for an in-band error marker without stealing tape vocabulary, so abort is the only out-of-band error channel: "this input is invalid" travels as an OUTCOME (\`aborted\` vs \`halted\`), not as a symbol written somewhere.

What to look for on the graph:

- \`expectMark\`'s cluster has TWO exits: the dotted \`return\` path (from \`2: stop\`) back to each caller's continuation, and the arc into the dashed-red \`abort\` terminal (from \`3: abort\`).
- the \`abort\` node sits outside every cluster — it belongs to the machine, not to any scope.`,
  },
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
