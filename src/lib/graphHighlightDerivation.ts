import { bareIdOf, type GraphHighlight } from '@turing-machine-js/visuals';
import type { Graph } from '@turing-machine-js/machine';

/** Inline mirror of MachineView's local `ExecutionMode` union. The
 *  derivation reads only three values; if MachineView adds modes that
 *  affect highlight, extend here AND there. (Could be promoted to a
 *  shared type in `types.ts` if any third consumer materializes.) */
export type ExecutionMode =
  | 'MANUAL'
  | 'RUNNING_AUTO'
  | 'RUNNING_CONTINUOUS'
  | 'RUNNING_PAUSED'
  | 'HALTED';

/**
 * Derive the `GraphHighlight` input to `applyHighlight` from MachineView's
 * mode + per-state-ids. Pure function — extracted from MachineView's
 * `$derived.by` block so the wrapper-canonicalization rule (and any
 * future rule) can be unit-tested without standing up the Svelte
 * component.
 *
 * Wrapper-canonicalization (FROM side only):
 * Whenever the source identity reported by the engine is a wrapper (a
 * State produced by `withOverriddenHaltState`), resolve it to its
 * bare's id via `bareIdOf` before forming the highlight. Rationale:
 *  - The wrapper is a structural device meaningful only at the call
 *    entry moment (TO side of iter 1's before-pause), where §10 lights
 *    the wrapper→bare call edge and §2 expands to the joined wrapper-
 *    bare pair. There, showing the wrapper IS the point.
 *  - On the FROM side ("we came from here"), the wrapper is engine-
 *    internal noise: iter 1's m.state IS the wrapper, but the call
 *    has already happened by iter 1's after-pause. Without
 *    canonicalization, the call arrow + wrapper node stay lit as a
 *    stale "we're still entering" cue.
 *  - Matches the log-line collapse (worker's `resolveDisplayName`):
 *    pause lines always say `"walkToBlank"`, never the composite —
 *    diagram should agree on the FROM side.
 *
 * Returns `null` when no highlight applies (modes that have no truth
 * value: MANUAL, RUNNING_CONTINUOUS, HALTED).
 */
export function deriveGraphHighlight(args: {
  graph: Graph | null;
  executionMode: ExecutionMode;
  currentStateId: number | null;
  nextStateId: number | null;
  prevStateId: number | null;
  pauseBefore: boolean;
}): GraphHighlight | null {
  if (!args.graph) return null;

  function fromCanon(id: number): number;
  function fromCanon(id: number | 'idle'): number | 'idle';
  function fromCanon(id: number | 'idle'): number | 'idle' {
    return typeof id === 'number' ? bareIdOf(id, args.graph!) : id;
  }

  if (args.executionMode === 'RUNNING_AUTO') {
    if (args.currentStateId === null) return null;
    return {
      fromId: fromCanon(args.currentStateId),
      toId: args.nextStateId,
      strong: 'from',
      paused: false,
    };
  }

  if (args.executionMode !== 'RUNNING_PAUSED' || args.currentStateId === null) {
    return null;
  }

  if (args.pauseBefore) {
    return {
      fromId: fromCanon(args.prevStateId ?? 'idle'),
      toId: args.currentStateId,
      strong: 'to',
      paused: true,
    };
  }

  return {
    fromId: fromCanon(args.currentStateId),
    toId: args.nextStateId,
    strong: 'from',
    paused: true,
  };
}
