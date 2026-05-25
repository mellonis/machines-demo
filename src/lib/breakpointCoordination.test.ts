import { describe, it, expect } from 'vitest';
import {
  decideOnIter,
  mergeDebugKinds,
} from './breakpointCoordination.ts';

/**
 * Unit tests for the pure worker-side coordination helpers. Companion to
 * `docs/graph-highlight-and-breakpoints.md` — each `describe` block maps
 * to a section there:
 *
 *   §15  → mergeDebugKinds (per-kind toggle that preserves the other bit)
 *   §13a → decideOnIter (after-fire + Step suppression)
 *
 * (Removed: `decideJoinedBare` tests — the helper was deleted along with
 * the wrapper/bare-entry conflation rule it implemented. See the comment
 * in `breakpointCoordination.ts` for the rationale.)
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

describe('decideOnIter (§13a after-fire + Step suppression)', () => {
  it('dispatches synthetic when Step requested and no after-fire this iter', () => {
    expect(decideOnIter({ stepRequested: true, dispatchedAfterThisIter: false })).toEqual({
      dispatchStep: true,
      nextStepRequested: false,
      nextDispatchedAfter: false,
    });
  });

  it('skips synthetic but KEEPS stepRequested when after-fire dispatched this iter', () => {
    // The fix for the duplicate-pause bug: after-fire + Step → don't
    // double-dispatch at the same effective point, but propagate
    // stepRequested to the next iter so it pauses there.
    expect(decideOnIter({ stepRequested: true, dispatchedAfterThisIter: true })).toEqual({
      dispatchStep: false,
      nextStepRequested: true, // ← critical: must remain true
      nextDispatchedAfter: false,
    });
  });

  it('does nothing when no step requested', () => {
    expect(decideOnIter({ stepRequested: false, dispatchedAfterThisIter: false })).toEqual({
      dispatchStep: false,
      nextStepRequested: false,
      nextDispatchedAfter: false,
    });
  });

  it('clears the after-fire flag even when no step requested', () => {
    // Iter boundary always resets the flag — even if the user didn't
    // click Step, the next iter starts with a clean slate.
    expect(decideOnIter({ stepRequested: false, dispatchedAfterThisIter: true })).toEqual({
      dispatchStep: false,
      nextStepRequested: false,
      nextDispatchedAfter: false,
    });
  });

  it('regression scenario: BP-after-K + Step → suppress at K, advance to K+1', () => {
    // Iter K: BP after fires, dispatches. User clicks Step.
    // onIter for K runs with both flags set.
    const k = decideOnIter({ stepRequested: true, dispatchedAfterThisIter: true });
    expect(k).toEqual({
      dispatchStep: false,
      nextStepRequested: true,
      nextDispatchedAfter: false,
    });
    // Iter K+1: assume no BP fired (typical case). onIter runs with
    // stepRequested still true, flag false → dispatch synthetic.
    const k1 = decideOnIter({
      stepRequested: k.nextStepRequested,
      dispatchedAfterThisIter: k.nextDispatchedAfter,
    });
    expect(k1).toEqual({
      dispatchStep: true,
      nextStepRequested: false,
      nextDispatchedAfter: false,
    });
  });
});
