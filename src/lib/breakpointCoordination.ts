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

// (Removed: `decideJoinedBare` + `JoinedBareDecision`. They implemented a
// "wrapper-entry pause + immediately-following bare entry = same call,
// skip the bare one" conflation. It violated the engine invariant
// "before/after armed → fires per iter at the state, regardless of
// wrapper nesting" — iter 2 of a wrapped call reads a different symbol
// from iter 1's wrapper-entry; suppressing it hid a real iter from the
// user. Now onPauseFn always dispatches; wrapper-entry shows the
// composite name `walkToBlank(writeMarker)`, bare iters show
// `walkToBlank` — the boundary is visible instead of conflated.)

/** Outcome of evaluating an `onIter` call for the step/after-fire suppression rule. */
export type IterDecision = {
  /** Whether to dispatch a synthetic step-boundary pause. */
  dispatchStep: boolean;
  /** New value of `stepRequested` after this iter. */
  nextStepRequested: boolean;
  /** New value of `dispatchedAfterThisIter` — always reset to false at iter boundary. */
  nextDispatchedAfter: false;
};

/**
 * Decide what `onIterFn` should do for the after-fire-Step suppression
 * rule (§13a in the doc). Pure function — no side effects.
 *
 * When an `onPause(after, K)` dispatched and the user clicks Step from
 * inside that pause, the engine's onIter for the SAME iter K fires next
 * — but it's at the same effective execution point as the after-fire,
 * so dispatching a synthetic step pause there would duplicate the
 * message. We skip the synthetic and KEEP `stepRequested` so the next
 * iter's onIter dispatches it naturally.
 */
export function decideOnIter(args: {
  stepRequested: boolean;
  dispatchedAfterThisIter: boolean;
}): IterDecision {
  if (args.stepRequested && args.dispatchedAfterThisIter) {
    // After-fire already paused at this point — skip synthetic, keep
    // stepRequested for the next iter.
    return { dispatchStep: false, nextStepRequested: true, nextDispatchedAfter: false };
  }
  if (args.stepRequested) {
    // Normal step boundary; dispatch and consume the flag.
    return { dispatchStep: true, nextStepRequested: false, nextDispatchedAfter: false };
  }
  // No step pending; the throttle / pauseRequested logic the caller runs
  // after this decision handles RUNNING_AUTO cadence + click-pause.
  return { dispatchStep: false, nextStepRequested: false, nextDispatchedAfter: false };
}
