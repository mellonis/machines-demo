import type { BreakpointKind } from './types.ts';
import type * as turing from '@turing-machine-js/machine';
import type { Graph } from '@turing-machine-js/machine';

/**
 * Pure helpers for the worker's breakpoint + pause-coordination logic.
 * Helpers are pure functions with no side effects, though they may depend
 * on engine types and utilities.
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

/**
 * One entry per logical breakpoint found by the post-build scan
 * (machines-demo#78). `stateId` is canonicalized: wrapper/bare pairs
 * fold to the bare's id; halt-class negative ids fold to `0`.
 * `before` / `after` mirror the bits of `state.debug.{before,after}`
 * read from the engine; both `false` is never emitted (the helper
 * filters those out).
 */
export type CanonicalBreakpointEntry = {
  stateId: number;
  before: boolean;
  after: boolean;
};

/**
 * Walk the engine's reachable state map (resolved via
 * `State.collectStates`) and surface every state whose `debug` field
 * has a `before` or `after` bit set. Dedupes wrapper/bare pairs via
 * `bareIdOf` (they share a `#debugRef` so emitting twice would be a
 * phantom). Halt-class negative ids canonicalize to `0` to match the
 * existing `toggleBreakpoint` handler's normalization.
 *
 * Inputs are what `machineWorker.ts` already has at the build-completion
 * site: `collectStates`'s map and the captured `Graph`. The helper is
 * pure — no engine mutations, no postMessage.
 *
 * Returns entries with at least one bit set. Empty input → [].
 */
export function scanCanonicalBreakpoints(
  stateMap: Map<number, { state: turing.State }>,
  _graph: Graph,
): CanonicalBreakpointEntry[] {
  const entries: CanonicalBreakpointEntry[] = [];
  for (const [id, { state }] of stateMap) {
    const debug = state.debug;
    if (debug === null || typeof debug !== 'object') continue;
    const before = (debug as { before?: boolean }).before === true;
    const after = (debug as { after?: boolean }).after === true;
    if (!before && !after) continue;
    entries.push({ stateId: id, before, after });
  }
  return entries;
}
