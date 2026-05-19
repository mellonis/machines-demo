import * as turing from '@turing-machine-js/machine';
import type { Command, Movement, TapeSnapshot } from './types';

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

