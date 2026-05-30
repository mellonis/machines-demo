import { describe, expect, it } from 'vitest';
import { createSnippetsPlugin } from './snippets.ts';
import type { Example } from '../lib/defaultCode.ts';

// A minimal, self-contained Turing example that returns { machine, initialState, tape }
// — small enough to record fast, alphabet ordered with blank-first to match the
// codebase convention.
const TURING_SHOWCASE_CODE = `
const {
  Alphabet, State, Tape, TapeBlock, TuringMachine,
  haltState, ifOtherSymbol, movements,
} = imports;

const alphabet = new Alphabet([' ', 'a', 'b']);
const tape = new Tape({ alphabet, symbols: ['a', 'b', 'a'] });
const tapeBlock = TapeBlock.fromTapes([tape]);
const machine = new TuringMachine({ tapeBlock });

const initialState = new State({
  [tapeBlock.symbol(['b'])]: {
    command: [{ symbol: 'a', movement: movements.right }],
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

const POST_SHOWCASE_CODE = `
const { PostMachine, Tape, mark, right, stop } = imports;

const machine = new PostMachine(
  {
    10: right(20),
    20: mark,
    30: stop,
  },
  { blankSymbol: ' ', markSymbol: '*' },
);

machine.replaceTapeWith(new Tape({
  alphabet: machine.tape.alphabet,
  symbols: [' ', ' '],
}));

return { machine };
`;

const stubExamples = (engine: 'turing' | 'post'): readonly Example[] => {
  if (engine === 'turing') {
    return [
      {
        id: 'showcase-1',
        title: 'Turing showcase',
        code: TURING_SHOWCASE_CODE,
        showcase: true,
        description: 'desc',
      },
      { id: 'not-shown', title: 'Hidden', code: 'return { machine: null };' },
    ];
  }
  return [
    {
      id: 'showcase-1',
      title: 'Post showcase',
      code: POST_SHOWCASE_CODE,
      showcase: true,
      description: 'desc',
    },
  ];
};

describe('snippets vite plugin', () => {
  it('V-plugin-emits-virtual-module — resolves virtual:snippets', async () => {
    const plugin = createSnippetsPlugin({ examples: stubExamples });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resolved = await (plugin.resolveId as any).call({}, 'virtual:snippets');
    expect(resolved).toBe('\0virtual:snippets');
  });

  it('V-plugin-only-showcase — non-showcase examples are excluded', async () => {
    const plugin = createSnippetsPlugin({ examples: stubExamples });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = await (plugin.load as any).call({}, '\0virtual:snippets');
    expect(out).toMatch(/showcase-1/);
    expect(out).not.toMatch(/not-shown/);
  });

  it('V-plugin-snippet-shape — emitted artifacts match Snippet schema', async () => {
    const plugin = createSnippetsPlugin({ examples: stubExamples });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out: string = await (plugin.load as any).call({}, '\0virtual:snippets');
    const match = out.match(/^export default (.+);\s*$/);
    expect(match).toBeTruthy();
    const data = JSON.parse(match![1]);
    for (const engine of ['turing', 'post'] as const) {
      expect(Array.isArray(data[engine])).toBe(true);
      for (const snippet of data[engine]) {
        expect(snippet).toMatchObject({
          version: 1,
          engine,
          id: 'showcase-1',
          graph: expect.any(Object),
          alphabets: expect.any(Array),
          frames: expect.any(Array),
        });
        expect(snippet.frames.length).toBeGreaterThan(0);
      }
    }
  });

  it('V-plugin-error-on-runtime-throw — bad example fails the build', async () => {
    const examples = (engine: 'turing' | 'post'): readonly Example[] =>
      engine === 'turing'
        ? [{ id: 'broken', title: 'X', code: 'throw new Error("nope")', showcase: true }]
        : [];
    const plugin = createSnippetsPlugin({ examples });
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (plugin.load as any).call({}, '\0virtual:snippets'),
    ).rejects.toThrow(/broken/);
  });
});
