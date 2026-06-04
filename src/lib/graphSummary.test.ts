import { describe, expect, it } from 'vitest';
import { summariseGraph } from './graphSummary';

// Minimal Graph fixture builder — mirrors `@turing-machine-js/machine`'s
// `Graph` shape (see `utilities/graph.d.ts`). String fields use the
// engine's pre-decoded edge-label vocabulary so the summariser's input
// shape matches what `toGraph` actually emits at runtime.
function makeGraph(nodes: Record<number, unknown>): never {
  return {
    initialId: Object.keys(nodes).map(Number)[0] ?? 0,
    alphabets: [[' ', 'a', 'b']],
    nodes,
  } as never;
}

describe('summariseGraph', () => {
  it('R-summary-counts: counts regular states and groups halt markers', () => {
    const g = makeGraph({
      1: {
        id: 1, name: 'q0', isHalt: false, isHaltMarker: false, isWrapper: false,
        bareStateId: null, frameId: null, overriddenHaltStateId: null, tags: [],
        transitions: [],
      },
      2: {
        id: 2, name: 'q1', isHalt: false, isHaltMarker: false, isWrapper: false,
        bareStateId: null, frameId: null, overriddenHaltStateId: null, tags: [],
        transitions: [],
      },
      [-1]: {
        id: -1, name: 'halt', isHalt: false, isHaltMarker: true, isWrapper: false,
        bareStateId: null, frameId: null, overriddenHaltStateId: null, tags: [],
        transitions: [],
      },
    });
    const summary = summariseGraph(g);
    expect(summary.stateCount).toBe(2);
    expect(summary.haltCount).toBe(1);
    expect(summary.states.map((s) => s.name)).toEqual(['q0', 'q1']);
  });

  it('R-summary-literal: decodes literal read + literal write + move', () => {
    const g = makeGraph({
      1: {
        id: 1, name: 'q0', isHalt: false, isHaltMarker: false, isWrapper: false,
        bareStateId: null, frameId: null, overriddenHaltStateId: null, tags: [],
        transitions: [
          {
            id: '1.0',
            pattern: "'a'",
            command: [{ symbol: "'b'", movement: 'R' }],
            nextStateId: 2,
          },
        ],
      },
      2: {
        id: 2, name: 'q1', isHalt: false, isHaltMarker: false, isWrapper: false,
        bareStateId: null, frameId: null, overriddenHaltStateId: null, tags: [],
        transitions: [],
      },
    });
    const [q0] = summariseGraph(g).states;
    expect(q0.transitions[0].readsPhrase).toBe("'a'");
    expect(q0.transitions[0].commandsPhrase).toBe("writes 'b', moves right");
    expect(q0.transitions[0].targetName).toBe('q1');
  });

  it('R-summary-wildcard-and-blank-and-keep: read shortcuts and write sentinels', () => {
    const g = makeGraph({
      1: {
        id: 1, name: 'q0', isHalt: false, isHaltMarker: false, isWrapper: false,
        bareStateId: null, frameId: null, overriddenHaltStateId: null, tags: [],
        transitions: [
          { id: '1.0', pattern: '*', command: [{ symbol: 'K', movement: 'S' }], nextStateId: 1 },
          { id: '1.1', pattern: 'B', command: [{ symbol: 'E', movement: 'L' }], nextStateId: 1 },
          { id: '1.2', pattern: "*='c'", command: [{ symbol: "K='c'", movement: 'R' }], nextStateId: 1 },
        ],
      },
    });
    const [q0] = summariseGraph(g).states;
    expect(q0.transitions[0].readsPhrase).toBe('any symbol');
    expect(q0.transitions[0].commandsPhrase).toBe('keeps current symbol, stays');
    expect(q0.transitions[1].readsPhrase).toBe('blank');
    expect(q0.transitions[1].commandsPhrase).toBe('erases, moves left');
    expect(q0.transitions[2].readsPhrase).toBe("any symbol (matched 'c')");
    expect(q0.transitions[2].commandsPhrase).toBe("keeps current symbol ('c'), moves right");
  });

  it('R-summary-target-halt: halt target rendered as "halt"', () => {
    const g = makeGraph({
      1: {
        id: 1, name: 'q0', isHalt: false, isHaltMarker: false, isWrapper: false,
        bareStateId: null, frameId: null, overriddenHaltStateId: null, tags: [],
        transitions: [
          { id: '1.0', pattern: "'a'", command: [{ symbol: 'K', movement: 'S' }], nextStateId: -1 },
        ],
      },
      [-1]: {
        id: -1, name: 'halt', isHalt: false, isHaltMarker: true, isWrapper: false,
        bareStateId: null, frameId: null, overriddenHaltStateId: null, tags: [],
        transitions: [],
      },
    });
    const [q0] = summariseGraph(g).states;
    expect(q0.transitions[0].targetName).toBe('halt');
  });

  it('R-summary-multi-tape: per-tape labels in reads + commands', () => {
    const g = makeGraph({
      1: {
        id: 1, name: 'q0', isHalt: false, isHaltMarker: false, isWrapper: false,
        bareStateId: null, frameId: null, overriddenHaltStateId: null, tags: [],
        transitions: [
          {
            id: '1.0',
            pattern: "'a','b'",
            command: [
              { symbol: "'b'", movement: 'R' },
              { symbol: "'a'", movement: 'L' },
            ],
            nextStateId: 1,
          },
        ],
      },
    });
    const [q0] = summariseGraph(g).states;
    expect(q0.transitions[0].readsPhrase).toBe("'a' on tape 1, 'b' on tape 2");
    expect(q0.transitions[0].commandsPhrase).toBe("tape 1: writes 'b', moves right; tape 2: writes 'a', moves left");
  });
});
