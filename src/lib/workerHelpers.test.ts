import { describe, it, expect } from 'vitest';
import * as turing from '@turing-machine-js/machine';
import {
  movementCode,
  commandsFromYield,
  readsFromYield,
  matchKindsFromYield,
  snapshotTapes,
  snapshotAlphabets,
  expectPhase,
  createProgressGate,
  type MachineYield,
  type TapeLike,
} from './workerHelpers';

// Helper: minimal stub for MachineYield.state — only id matters for tests
// that don't exercise the state graph; the `getSymbol` / `getNextState`
// methods are present so the type satisfies but they're not called from
// commandsFromYield / readsFromYield.
function stubState(id: number = 0): MachineYield['state'] {
  return {
    id,
    getSymbol: () => Symbol('test'),
    getNextState: () => ({ ref: { id: 0 } }),
  };
}

// Default per-tape `matchedTransition` for tests that don't exercise the
// wildcard read marker — every position renders as `'literal'`, matching
// the engine's behavior for a specific-symbol transition.
function stubMatched(tapeCount: number, id: string = '0.0'): MachineYield['matchedTransition'] {
  return {
    id,
    matchKinds: Array.from({ length: tapeCount }, () => 'literal' as const),
  };
}

describe('workerHelpers', () => {
  describe('movement-code', () => {
    it('R-movement-code-mappings: maps left/right/stay symbols to L/R/S', () => {
      expect(movementCode(turing.movements.left)).toBe('L');
      expect(movementCode(turing.movements.right)).toBe('R');
      expect(movementCode(turing.movements.stay)).toBe('S');
    });
  });

  describe('commands', () => {
    it('R-commands-keep: yields { symbol: null } when written equals current', () => {
      const yieldVal: MachineYield = {
        movements: [turing.movements.right],
        currentSymbols: ['a'],
        nextSymbols: ['a'],
        state: stubState(),
        matchedTransition: { id: '0.0', matchKinds: [] },
      };
      expect(commandsFromYield(yieldVal)).toEqual([{ movement: 'R', symbol: null }]);
    });

    it('R-commands-write: yields { symbol: written } when written differs from current', () => {
      const yieldVal: MachineYield = {
        movements: [turing.movements.left],
        currentSymbols: ['a'],
        nextSymbols: ['b'],
        state: stubState(),
        matchedTransition: { id: '0.0', matchKinds: [] },
      };
      expect(commandsFromYield(yieldVal)).toEqual([{ movement: 'L', symbol: 'b' }]);
    });

    it('R-commands-multi-tape: returns one command per tape with matching positions', () => {
      const yieldVal: MachineYield = {
        movements: [turing.movements.left, turing.movements.right, turing.movements.stay],
        currentSymbols: ['a', 'b', 'c'],
        nextSymbols: ['x', 'y', 'z'],
        state: stubState(),
        matchedTransition: { id: '0.0', matchKinds: [] },
      };
      expect(commandsFromYield(yieldVal)).toEqual([
        { movement: 'L', symbol: 'x' },
        { movement: 'R', symbol: 'y' },
        { movement: 'S', symbol: 'z' },
      ]);
    });

    it('R-commands-mixed: per-tape mix of keep and write resolves correctly', () => {
      const yieldVal: MachineYield = {
        movements: [turing.movements.right, turing.movements.stay, turing.movements.left],
        currentSymbols: ['a', 'b', 'c'],
        nextSymbols: ['a', 'B', 'c'], // tape 0 keeps, tape 1 writes 'B', tape 2 keeps
        state: stubState(),
        matchedTransition: { id: '0.0', matchKinds: [] },
      };
      expect(commandsFromYield(yieldVal)).toEqual([
        { movement: 'R', symbol: null },
        { movement: 'S', symbol: 'B' },
        { movement: 'L', symbol: null },
      ]);
    });
  });

  describe('reads', () => {
    it('R-reads-single-tape: returns the pre-step head symbol', () => {
      const yieldVal: MachineYield = {
        movements: [turing.movements.right],
        currentSymbols: ['a'],
        nextSymbols: ['b'],
        state: stubState(),
        matchedTransition: { id: '0.0', matchKinds: [] },
      };
      expect(readsFromYield(yieldVal)).toEqual(['a']);
    });

    it('R-reads-defensive-copy: mutating the returned array does not affect the yield', () => {
      const yieldVal: MachineYield = {
        movements: [turing.movements.stay],
        currentSymbols: ['a', 'b'],
        nextSymbols: ['a', 'b'],
        state: stubState(),
        matchedTransition: { id: '0.0', matchKinds: [] },
      };
      const reads = readsFromYield(yieldVal);
      reads.push('z');
      expect(yieldVal.currentSymbols).toEqual(['a', 'b']);
    });
  });

  describe('matchKinds', () => {
    it('R-matchKinds-passthrough: copies matchKinds from matchedTransition (per-tape parallel)', () => {
      const yieldVal: MachineYield = {
        movements: [turing.movements.right, turing.movements.stay],
        currentSymbols: ['a', 'b'],
        nextSymbols: ['a', 'b'],
        state: stubState(),
        matchedTransition: {
          id: '7.1',
          matchKinds: ['wildcard', 'literal'],
        },
      };
      expect(matchKindsFromYield(yieldVal)).toEqual(['wildcard', 'literal']);
    });

    it('R-matchKinds-defensive-copy: mutating returned array does not affect the yield', () => {
      const yieldVal: MachineYield = {
        movements: [turing.movements.right],
        currentSymbols: ['a'],
        nextSymbols: ['a'],
        state: stubState(),
        matchedTransition: stubMatched(1),
      };
      const kinds = matchKindsFromYield(yieldVal);
      kinds.push('wildcard');
      expect(yieldVal.matchedTransition.matchKinds).toEqual(['literal']);
    });
  });

  describe('snapshot', () => {
    it('R-snapshot-tapes-clones-symbols: returned symbols array is a defensive copy (not aliased)', () => {
      const tape: TapeLike = {
        symbols: ['a', 'b', 'c'],
        position: 1,
        alphabet: { symbols: [' ', 'a', 'b', 'c'] },
      };
      const snap = snapshotTapes([tape]);

      expect(snap).toHaveLength(1);
      expect(snap[0].symbols).toEqual(['a', 'b', 'c']);
      expect(snap[0].position).toBe(1);
      expect(snap[0].symbols).not.toBe(tape.symbols);

      // Mutating the snapshot must not affect the original.
      snap[0].symbols.push('d');
      expect(tape.symbols).toEqual(['a', 'b', 'c']);
    });

    it('R-snapshot-tapes-multi-tape: handles N tapes with correct positions', () => {
      const tapes: TapeLike[] = [
        { symbols: ['a'], position: 0, alphabet: { symbols: [' ', 'a'] } },
        { symbols: ['b', 'c'], position: 1, alphabet: { symbols: [' ', 'b', 'c'] } },
        { symbols: ['d', 'e', 'f'], position: 2, alphabet: { symbols: [' ', 'd', 'e', 'f'] } },
      ];
      const snap = snapshotTapes(tapes);
      expect(snap).toEqual([
        { symbols: ['a'], position: 0 },
        { symbols: ['b', 'c'], position: 1 },
        { symbols: ['d', 'e', 'f'], position: 2 },
      ]);
    });

    it('R-snapshot-alphabets-clones: returned string[] is a defensive copy', () => {
      const tape: TapeLike = {
        symbols: ['a'],
        position: 0,
        alphabet: { symbols: [' ', 'a', 'b'] },
      };
      const snap = snapshotAlphabets([tape]);

      expect(snap).toEqual([[' ', 'a', 'b']]);
      expect(snap[0]).not.toBe(tape.alphabet.symbols);

      snap[0].push('c');
      expect(tape.alphabet.symbols).toEqual([' ', 'a', 'b']);
    });

    it('R-snapshot-alphabets-multi-tape: handles N tapes', () => {
      const tapes: TapeLike[] = [
        { symbols: ['a'], position: 0, alphabet: { symbols: [' ', 'a'] } },
        { symbols: ['b'], position: 0, alphabet: { symbols: [' ', 'b', 'c'] } },
      ];
      expect(snapshotAlphabets(tapes)).toEqual([
        [' ', 'a'],
        [' ', 'b', 'c'],
      ]);
    });
  });

  describe('phase-guard', () => {
    it('R-phase-guard-allows: does not throw when current is in allowed list', () => {
      expect(() => expectPhase('built', ['idle', 'built'])).not.toThrow();
      expect(() => expectPhase('paused', ['paused'])).not.toThrow();
    });

    it('R-phase-guard-rejects: throws when current is not in allowed list', () => {
      expect(() => expectPhase('idle', ['built'])).toThrow();
      expect(() => expectPhase('running', ['idle', 'built'])).toThrow();
    });

    it('R-phase-guard-message-format: error message reads `worker phase X, expected Y|Z`', () => {
      expect(() => expectPhase('idle', ['built', 'paused']))
        .toThrow('worker phase idle, expected built|paused');
    });
  });

  describe('progress-gate', () => {
    it('R-progress-gate-holds-first-interval: stays closed until one full interval from creation', () => {
      let now = 1000;
      const gate = createProgressGate(250, () => now);
      expect(gate()).toBe(false);
      now = 1249;
      expect(gate()).toBe(false);
      now = 1250;
      expect(gate()).toBe(true);
    });

    it('R-progress-gate-rearms: after opening, closed again until another interval elapses', () => {
      let now = 0;
      const gate = createProgressGate(250, () => now);
      now = 300;
      expect(gate()).toBe(true);
      now = 549;
      expect(gate()).toBe(false);
      now = 550;
      expect(gate()).toBe(true);
    });
  });

});
