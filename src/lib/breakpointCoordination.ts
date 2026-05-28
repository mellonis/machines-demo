import type { BreakpointKind } from './types.ts';

/**
 * Pure helpers for the worker's breakpoint + pause-coordination logic.
 *
 * The worker's `onPauseFn` / `onIterFn` / `toggleBreakpoint` handlers are
 * small state machines over a few flags (`pendingJoinedBareId`,
 * `dispatchedAfterThisIter`, `stepRequested`). Extracting the decisions
 * here keeps the worker thin and lets every transition be unit-tested
 * without booting a real Web Worker.
 *
 * See `docs/graph-highlight-and-breakpoints.md` for the rules each
 * function implements.
 */

/** Engine debug-filter shape for `state.debug = X`. `null` clears. */
export type DebugFilter = { before?: true; after?: true } | null;

/** Current bits read from `state.debug.{before,after} === true`. */
export type DebugBits = { before: boolean; after: boolean };

/**
 * Flip ONE kind on a state's current debug bits, returning the new bits
 * and the value to assign through `state.debug = ...`. Preserves the
 * OTHER kind so toggling `after` while `before` is on doesn't lose
 * `before`. When both kinds end up off, returns `null` (engine setter
 * resets the DebugConfig). See `docs/graph-highlight-and-breakpoints.md`
 * §15 for why Post additionally needs a clear-then-set sequence.
 */
export function mergeDebugKinds(
  current: DebugBits,
  kind: BreakpointKind,
): { next: DebugBits; debugValue: DebugFilter } {
  const next: DebugBits = {
    before: kind === 'before' ? !current.before : current.before,
    after: kind === 'after' ? !current.after : current.after,
  };
  if (!next.before && !next.after) {
    return { next, debugValue: null };
  }
  const debugValue: DebugFilter = {
    ...(next.before ? { before: true } : {}),
    ...(next.after ? { after: true } : {}),
  };
  return { next, debugValue };
}

// (Removed: `decideJoinedBare` and `decideOnIter`. `decideOnIter` drove the
// worker's synthetic step-boundary dispatch + the after-fire-Step suppression
// rule; both are gone now that Step / click-Pause are driven through the
// engine's `stepIn()` / `pause()` (engine #102) and surface via the single
// `pause` event. Step is now before-side, so it never collides with an
// after-side breakpoint and needs no dedup.)
