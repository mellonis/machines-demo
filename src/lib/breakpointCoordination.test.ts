import { describe, it, expect } from 'vitest';
import { mergeDebugKinds } from './breakpointCoordination.ts';

/**
 * Unit tests for the pure worker-side coordination helpers. Companion to
 * `docs/graph-highlight-and-breakpoints.md`:
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
