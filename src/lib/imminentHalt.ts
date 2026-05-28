import type { TuringGraph } from './types.ts';

/**
 * Engine-pause-time decision: should this `after` pause be tagged as
 * halt-imminent? Pure function — given the engine's yielded `MachineState`
 * shape, the tape block, the graph snapshot, and the current `haltState.debug`
 * value, return the imminentHalt tag (or undefined for "not halt-imminent").
 *
 * Gating rules:
 * 1. Only fires on `after` pauses (#207's halt timing). Before-pauses cannot
 *    be halt-imminent under the new engine — halt fires on the after side.
 * 2. Only fires when `haltState.debug === true` — the user has armed the
 *    halt-BP. A regular per-state `state.debug.after` BP firing on an iter
 *    that *happens* to be halt-bound is NOT halt-imminent; it's a normal
 *    after-pause that the formatter renders with the regular wording.
 * 3. Only fires when the iter's about-to-fire transition resolves to
 *    haltState (`ref.id === 0`). Determined by re-resolving the engine's
 *    `getNextState` lookup on the source state + current head symbol.
 *
 * In-frame vs real determined by the source's graph `frameId`:
 *  - source state is inside a frame → in-frame halt (will pop back to the
 *    wrapper's continuation); halt marker id is `-frameId`.
 *  - source state is outside any frame → real halt (program-end).
 *
 * Returns `undefined` (no tag) when any gate fails OR when the lookup throws
 * (no matching transition — unhandled-symbol case).
 *
 * Pure: no I/O, no module-level state. The worker's onPauseFn passes its
 * inputs through; tests can call it directly with synthetic inputs.
 */
export function computeImminentHalt(args: {
  /** The engine's `pause`-event object. Reads:
   *   - `pause.side` (to gate on after-pause)
   *   - `state.id` (frame lookup)
   *   - `state.getSymbol(tapeBlock)` + `state.getNextState(sym).ref.id` (halt-bound check) */
  m: {
    state: {
      id: number;
      getSymbol: (tapeBlock: unknown) => symbol;
      getNextState: (sym: symbol) => { ref: { id: number } };
    };
    pause?: { side: 'before' | 'after' };
  };
  /** TapeBlock instance — passed to `state.getSymbol`. */
  tapeBlock: unknown;
  /** Engine `Graph` snapshot. Used to look up the source state's `frameId`
   *  to distinguish in-frame from real halt. */
  currentGraph: TuringGraph | null;
  /** Current value of `turing.haltState.debug` (boolean post-#207). The
   *  gate that prevents halt-imminent wording from firing on plain
   *  state-level after-pauses. */
  haltStateDebug: boolean;
}): { kind: 'real' } | { kind: 'in-frame'; haltMarkerId: number } | undefined {
  if (args.m.pause?.side !== 'after') return undefined;
  if (!args.haltStateDebug) return undefined;
  if (!args.tapeBlock) return undefined;

  try {
    const sym = args.m.state.getSymbol(args.tapeBlock);
    const nextRefId = args.m.state.getNextState(sym).ref.id;
    if (nextRefId !== 0) return undefined;

    const sourceNode = args.currentGraph?.nodes[args.m.state.id];
    const frameId = sourceNode?.frameId;
    return (frameId !== null && frameId !== undefined)
      ? { kind: 'in-frame', haltMarkerId: -frameId }
      : { kind: 'real' };
  } catch {
    // No matching transition (engine throws for unhandled symbols) —
    // not a clean halt-bound after; skip the imminent hint.
    return undefined;
  }
}
