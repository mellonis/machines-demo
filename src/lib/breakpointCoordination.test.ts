import { describe, it, expect } from 'vitest';
import * as turing from '@turing-machine-js/machine';
import { mergeDebugKinds, scanCanonicalBreakpoints } from './breakpointCoordination.ts';
import type { Graph } from '@turing-machine-js/machine';

/**
 * Unit tests for the pure worker-side coordination helpers. Companion to
 * the highlight + breakpoints rules doc (now in `@turing-machine-js/visuals`):
 * https://github.com/mellonis/turing-machine-js/blob/v7/packages/visuals/docs/graph-highlight-and-breakpoints.md
 *
 *   §15  → mergeDebugKinds (per-kind toggle that preserves the other bit)
 *
 * (Removed: `decideJoinedBare` + `decideOnIter` tests — both helpers were
 * deleted. `decideOnIter` drove the synthetic step-boundary dispatch, which
 * is gone now that Step / click-Pause run through the engine's stepIn() /
 * pause() (engine #102). See the comment in `breakpointCoordination.ts`.)
 */

describe('mergeDebugKinds (§15 per-kind toggle)', () => {
  // Cover all 2 × 2 × 2 = 8 transitions: (before, after, kind).
  it('off,off + before → before on; debugValue { before:true }', () => {
    expect(mergeDebugKinds({ before: false, after: false }, 'before')).toEqual({
      next: { before: true, after: false },
      debugValue: { before: true },
    });
  });

  it('off,off + after → after on; debugValue { after:true }', () => {
    expect(mergeDebugKinds({ before: false, after: false }, 'after')).toEqual({
      next: { before: false, after: true },
      debugValue: { after: true },
    });
  });

  it('on,off + before → both off; debugValue null (clears DebugConfig)', () => {
    expect(mergeDebugKinds({ before: true, after: false }, 'before')).toEqual({
      next: { before: false, after: false },
      debugValue: null,
    });
  });

  it('on,off + after → both on; debugValue { before:true, after:true }', () => {
    expect(mergeDebugKinds({ before: true, after: false }, 'after')).toEqual({
      next: { before: true, after: true },
      debugValue: { before: true, after: true },
    });
  });

  it('off,on + before → both on (preserves after)', () => {
    expect(mergeDebugKinds({ before: false, after: true }, 'before')).toEqual({
      next: { before: true, after: true },
      debugValue: { before: true, after: true },
    });
  });

  it('off,on + after → both off; null', () => {
    expect(mergeDebugKinds({ before: false, after: true }, 'after')).toEqual({
      next: { before: false, after: false },
      debugValue: null,
    });
  });

  it('on,on + before → only after remains (toggling one preserves the other)', () => {
    expect(mergeDebugKinds({ before: true, after: true }, 'before')).toEqual({
      next: { before: false, after: true },
      debugValue: { after: true },
    });
  });

  it('on,on + after → only before remains', () => {
    expect(mergeDebugKinds({ before: true, after: true }, 'after')).toEqual({
      next: { before: true, after: false },
      debugValue: { before: true },
    });
  });
});

describe('scanCanonicalBreakpoints (machines-demo#78)', () => {
  it('returns [] for an empty state map', () => {
    const stateMap = new Map();
    const graph: Graph = { initialId: 0, alphabets: [[' ']], nodes: {} } as Graph;
    expect(scanCanonicalBreakpoints(stateMap, graph)).toEqual([]);
  });

  it('R-scan-before: single state with before bit → one entry', () => {
    const alphabet = new turing.Alphabet([' ', 'a']);
    const tapeBlock = turing.TapeBlock.fromAlphabets([alphabet]);
    const state = new turing.State(
      {
        [tapeBlock.symbol([' '])]: { nextState: turing.haltState },
      },
      's0',
    );
    state.debug = { before: true };
    const stateMap = turing.State.collectStates(state, tapeBlock);
    const graph = turing.State.toGraph(state, tapeBlock);
    const entries = scanCanonicalBreakpoints(stateMap, graph);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ stateId: entries[0].stateId, before: true, after: false });
    expect(entries[0].stateId).toBeGreaterThanOrEqual(0); // non-halt
  });

  it('R-scan-after: single state with after bit → one entry', () => {
    const alphabet = new turing.Alphabet([' ', 'a']);
    const tapeBlock = turing.TapeBlock.fromAlphabets([alphabet]);
    const state = new turing.State(
      {
        [tapeBlock.symbol([' '])]: { nextState: turing.haltState },
      },
      's0',
    );
    state.debug = { after: true };
    const stateMap = turing.State.collectStates(state, tapeBlock);
    const graph = turing.State.toGraph(state, tapeBlock);
    const entries = scanCanonicalBreakpoints(stateMap, graph);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ before: false, after: true });
  });

  it('R-scan-both: single state with both bits → one entry, both true', () => {
    const alphabet = new turing.Alphabet([' ', 'a']);
    const tapeBlock = turing.TapeBlock.fromAlphabets([alphabet]);
    const state = new turing.State(
      {
        [tapeBlock.symbol([' '])]: { nextState: turing.haltState },
      },
      's0',
    );
    state.debug = { before: true, after: true };
    const stateMap = turing.State.collectStates(state, tapeBlock);
    const graph = turing.State.toGraph(state, tapeBlock);
    const entries = scanCanonicalBreakpoints(stateMap, graph);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ before: true, after: true });
  });

  it('R-scan-multi: multi-state with mixed bits → entry per state', () => {
    const alphabet = new turing.Alphabet([' ', 'a', 'b']);
    const tapeBlock = turing.TapeBlock.fromAlphabets([alphabet]);
    const s2 = new turing.State(
      {
        [tapeBlock.symbol([' '])]: { nextState: turing.haltState },
      },
      's2',
    );
    const s1 = new turing.State(
      {
        [tapeBlock.symbol([' '])]: { nextState: s2 },
      },
      's1',
    );
    const s0 = new turing.State(
      {
        [tapeBlock.symbol([' '])]: { nextState: s1 },
      },
      's0',
    );
    s0.debug = { before: true };
    s2.debug = { after: true };
    const stateMap = turing.State.collectStates(s0, tapeBlock);
    const graph = turing.State.toGraph(s0, tapeBlock);
    const entries = scanCanonicalBreakpoints(stateMap, graph);
    expect(entries).toHaveLength(2);
    const bits = entries.map((e) => ({ before: e.before, after: e.after })).sort((a, b) =>
      a.before === b.before ? Number(a.after) - Number(b.after) : Number(a.before) - Number(b.before)
    );
    expect(bits).toEqual([{ before: false, after: true }, { before: true, after: false }]);
  });

  it('R-scan-no-debug: states with debug=null → []', () => {
    const alphabet = new turing.Alphabet([' ', 'a']);
    const tapeBlock = turing.TapeBlock.fromAlphabets([alphabet]);
    const state = new turing.State(
      {
        [tapeBlock.symbol([' '])]: { nextState: turing.haltState },
      },
      's0',
    );
    const stateMap = turing.State.collectStates(state, tapeBlock);
    const graph = turing.State.toGraph(state, tapeBlock);
    expect(scanCanonicalBreakpoints(stateMap, graph)).toEqual([]);
  });

  it('R-scan-wrapper-dedup: wrapper + bare share debugRef → one entry on bare', () => {
    const alphabet = new turing.Alphabet([' ', 'a']);
    const tapeBlock = turing.TapeBlock.fromAlphabets([alphabet]);
    const bare = new turing.State(
      {
        [tapeBlock.symbol([' '])]: { nextState: turing.haltState },
      },
      'foo',
    );
    const continuation = new turing.State(
      {
        [tapeBlock.symbol([' '])]: { nextState: turing.haltState },
      },
      'cont',
    );
    const wrapper = bare.withOverriddenHaltState(continuation);
    // Setting debug on the wrapper propagates to the bare via #debugRef.
    wrapper.debug = { before: true };
    const stateMap = turing.State.collectStates(wrapper, tapeBlock);
    const graph = turing.State.toGraph(wrapper, tapeBlock);
    const entries = scanCanonicalBreakpoints(stateMap, graph);
    // Even though both wrapper and bare appear in the state map, the
    // canonical entry sits on the bare's id (bareIdOf folds wrapper → bare).
    expect(entries).toHaveLength(1);
    expect(entries[0].before).toBe(true);
  });

  it('R-scan-halt-canonical: haltState.debug → entry with stateId 0', () => {
    const alphabet = new turing.Alphabet([' ', 'a']);
    const tapeBlock = turing.TapeBlock.fromAlphabets([alphabet]);
    const state = new turing.State(
      {
        [tapeBlock.symbol([' '])]: { nextState: turing.haltState },
      },
      's0',
    );
    // Save + restore haltState.debug so this test doesn't leak global state.
    const previous = turing.haltState.debug;
    try {
      turing.haltState.debug = true;
      const stateMap = turing.State.collectStates(state, tapeBlock);
      const graph = turing.State.toGraph(state, tapeBlock);
      const entries = scanCanonicalBreakpoints(stateMap, graph);
      expect(entries).toHaveLength(1);
      expect(entries[0].stateId).toBe(0);
      // haltState debug is a single boolean → we surface it as `before: true`
      // by convention (matches the existing UI which shows one "Pause" toggle).
      expect(entries[0].before).toBe(true);
    } finally {
      turing.haltState.debug = previous;
    }
  });
});
