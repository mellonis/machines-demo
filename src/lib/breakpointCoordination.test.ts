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
});
