import { describe, it, expect } from 'vitest';
import { deriveGraphHighlight } from './graphHighlightDerivation';
import type { Graph } from '@turing-machine-js/machine';

// Minimal graph: user state 1 (bare), user state 2 (wrapper of 1), halt 0.
// Shapes only what bareIdOf reads (isWrapper / bareStateId).
const GRAPH = {
  initialId: 2,
  alphabets: [],
  nodes: {
    0: { id: 0, name: 'halt', isWrapper: false, bareStateId: null },
    1: { id: 1, name: 'scanBits', isWrapper: false, bareStateId: null },
    2: { id: 2, name: 'scanBits(accept)', isWrapper: true, bareStateId: 1 },
  },
} as unknown as Graph;

const BASE = {
  graph: GRAPH,
  currentStateId: null,
  nextStateId: null,
  prevStateId: null,
  pauseBefore: false,
  terminalOutcome: null,
  finalStateId: null,
} as const;

describe('deriveGraphHighlight — terminal outcome', () => {
  it('G-derive-aborted-terminal: HALTED after an abort highlights final state → abort sentinel', () => {
    const h = deriveGraphHighlight({
      ...BASE,
      executionMode: 'HALTED',
      terminalOutcome: 'aborted',
      finalStateId: 1,
    });
    expect(h).toEqual({ fromId: 1, toId: -1, strong: 'to', paused: true });
  });

  it('G-derive-aborted-wrapper-canon: abort FROM side canonicalizes wrappers to their bare', () => {
    const h = deriveGraphHighlight({
      ...BASE,
      executionMode: 'HALTED',
      terminalOutcome: 'aborted',
      finalStateId: 2,
    });
    expect(h?.fromId).toBe(1);
    expect(h?.toId).toBe(-1);
  });

  it('G-derive-aborted-no-final-state: abort with unknown final state falls back to the idle FROM', () => {
    const h = deriveGraphHighlight({
      ...BASE,
      executionMode: 'HALTED',
      terminalOutcome: 'aborted',
      finalStateId: null,
    });
    expect(h).toEqual({ fromId: 'idle', toId: -1, strong: 'to', paused: true });
  });

  it('G-derive-halted-unchanged: HALTED after a classical halt keeps no highlight', () => {
    const h = deriveGraphHighlight({
      ...BASE,
      executionMode: 'HALTED',
      terminalOutcome: 'halted',
      finalStateId: 0,
    });
    expect(h).toBeNull();
  });

  it('G-derive-paused-unaffected: RUNNING_PAUSED derivation ignores the terminal fields', () => {
    const h = deriveGraphHighlight({
      ...BASE,
      executionMode: 'RUNNING_PAUSED',
      currentStateId: 1,
      nextStateId: 0,
      pauseBefore: false,
      terminalOutcome: 'aborted',
      finalStateId: 1,
    });
    expect(h).toEqual({ fromId: 1, toId: 0, strong: 'from', paused: true });
  });
});
