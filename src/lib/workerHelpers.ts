import * as turing from '@turing-machine-js/machine';
import type { TapeSnapshot } from '@turing-machine-js/visuals';
import type { Command, Movement } from './types';

// --- Movement / command derivation ---

/** Maps a turing.movements.{left,right,stay} symbol to wire format 'L'|'R'|'S'. */
export function movementCode(m: symbol): Movement {
  if (m === turing.movements.left) return 'L';
  if (m === turing.movements.right) return 'R';
  return 'S';
}

export type MachineYield = {
  movements: symbol[];
  currentSymbols: string[];
  nextSymbols: string[];
  /** Engine State object. Only `id` plus the `getSymbol`/`getNextState`
   *  methods are read on the demo side, used to drive `from + edge + to`
   *  graph highlight. */
  state: {
    id: number;
    getSymbol: (tapeBlock: unknown) => symbol;
    getNextState: (sym: symbol) => { ref: { id: number } };
  };
  /** Engine per-iter `matchedTransition`. Drives the
   *  `[*='X']` wildcard read marker in the log when the firing alternative
   *  matched via `ifOtherSymbol` at a tape position. */
  matchedTransition: {
    id: string;
    matchKinds: ('wildcard' | 'literal')[];
  };
};

/** Per-tape Command derivation. `symbol === null` means "no write" (resolved
 *  symbol matched the existing one). */
export function commandsFromYield(y: MachineYield): Command[] {
  return y.movements.map((mv, i) => {
    const movement = movementCode(mv);
    const written = y.nextSymbols[i];
    const before = y.currentSymbols[i];
    return { movement, symbol: written === before ? null : written };
  });
}

/** Per-tape read symbols at the heads BEFORE the yielded step applied.
 *  Parallel to `commandsFromYield`; defensive-copies so the caller can
 *  mutate without aliasing the engine's array. */
export function readsFromYield(y: MachineYield): string[] {
  return [...y.currentSymbols];
}

/** Per-tape match kind for the firing alternative at each head position
 *  (`'wildcard'` iff the engine matched via `ifOtherSymbol` at that position,
 *  `'literal'` otherwise). Parallel to `readsFromYield` and
 *  `commandsFromYield`; defensive-copies so the caller can mutate the
 *  array without aliasing the engine's. Sourced from
 *  `MachineState.matchedTransition.matchKinds` — drives the `[*='X']`
 *  wildcard read marker in the log. */
export function matchKindsFromYield(y: MachineYield): ('wildcard' | 'literal')[] {
  return [...y.matchedTransition.matchKinds];
}

/** Engine State.id of the next state the yielded transition will land on.
 *  Computed via `state.getNextState(state.getSymbol(tapeBlock)).ref.id` —
 *  the same lookup the engine performs internally each iter, just executed
 *  on demand here so the demo can drive the `from → to` graph
 *  highlight. Returns `null` if the lookup throws (defensive). */
export function nextStateIdFromYield(y: MachineYield, tapeBlock: unknown): number | null {
  try {
    const sym = y.state.getSymbol(tapeBlock);
    return y.state.getNextState(sym).ref.id;
  } catch {
    return null;
  }
}

// --- Tape / alphabet snapshots ---

export type TapeLike = {
  symbols: string[];
  position: number;
  alphabet: { symbols: string[] };
};

/** Defensive-copies each tape's symbols + position into a wire-format snapshot. */
export function snapshotTapes(tapes: readonly TapeLike[]): TapeSnapshot[] {
  return tapes.map((t) => ({
    symbols: [...t.symbols],
    position: t.position,
  }));
}

/** Defensive-copies each tape's alphabet symbols. */
export function snapshotAlphabets(tapes: readonly TapeLike[]): string[][] {
  return tapes.map((t) => [...t.alphabet.symbols]);
}

// --- Phase guard ---

export type WorkerPhaseKind = 'idle' | 'built' | 'running' | 'paused';

/** Throws if `currentKind` is not in `allowed`. Defense-in-depth against
 *  out-of-order requests (e.g. step before build). */
export function expectPhase(currentKind: WorkerPhaseKind, allowed: WorkerPhaseKind[]): void {
  if (!allowed.includes(currentKind)) {
    throw new Error(`worker phase ${currentKind}, expected ${allowed.join('|')}`);
  }
}

// --- Progress heartbeat gate ---

/** Time-gate for the run loop's `progress` heartbeats: returns a predicate
 *  that opens once per `intervalMs` of `now()` time, starting one full
 *  interval after creation (run-start tape state is already on screen from
 *  the build, so an immediate heartbeat would be redundant). Injected clock
 *  keeps it pure for tests; the worker passes `Date.now`. */
export function createProgressGate(intervalMs: number, now: () => number): () => boolean {
  let lastSentAt = now();
  return () => {
    const t = now();
    if (t - lastSentAt < intervalMs) return false;
    lastSentAt = t;
    return true;
  };
}

