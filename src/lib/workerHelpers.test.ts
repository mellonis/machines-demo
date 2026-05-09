import { describe, it, expect } from 'vitest';
import * as turing from '@turing-machine-js/machine';
import {
  movementCode,
  commandsFromYield,
  snapshotTapes,
  snapshotAlphabets,
  expectPhase,
  armStepAfter,
  type MachineYield,
  type TapeLike,
  type DebugTarget,
} from './workerHelpers';

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
      };
      expect(commandsFromYield(yieldVal)).toEqual([{ movement: 'R', symbol: null }]);
    });

    it('R-commands-write: yields { symbol: written } when written differs from current', () => {
      const yieldVal: MachineYield = {
        movements: [turing.movements.left],
        currentSymbols: ['a'],
        nextSymbols: ['b'],
      };
      expect(commandsFromYield(yieldVal)).toEqual([{ movement: 'L', symbol: 'b' }]);
    });

    it('R-commands-multi-tape: returns one command per tape with matching positions', () => {
      const yieldVal: MachineYield = {
        movements: [turing.movements.left, turing.movements.right, turing.movements.stay],
        currentSymbols: ['a', 'b', 'c'],
        nextSymbols: ['x', 'y', 'z'],
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
      };
      expect(commandsFromYield(yieldVal)).toEqual([
        { movement: 'R', symbol: null },
        { movement: 'S', symbol: 'B' },
        { movement: 'L', symbol: null },
      ]);
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

  describe('step-arm', () => {
    it('R-step-arm-sets-after: assigns target.debug = { after: true } when original was null', () => {
      const target: DebugTarget = { debug: null };
      armStepAfter(target);
      expect(target.debug).toEqual({ after: true });
    });

    it('R-step-arm-preserves-before: keeps user-authored .before in the new debug config', () => {
      const target: DebugTarget = { debug: { before: true } };
      armStepAfter(target);
      expect(target.debug).toEqual({ after: true, before: true });
    });

    it('R-step-arm-restore-null: restore() reverts target.debug to original null', () => {
      const target: DebugTarget = { debug: null };
      const { restore } = armStepAfter(target);
      expect(target.debug).not.toBeNull();
      restore();
      expect(target.debug).toBeNull();
    });

    it('R-step-arm-restore-by-reference: restore() puts the exact original object reference back', () => {
      const original = { before: true, after: 'someFilter' as unknown };
      const target: DebugTarget = { debug: original };
      const { restore } = armStepAfter(target);
      // Helper assigned a NEW object containing { after: true, before: true }.
      expect(target.debug).not.toBe(original);
      restore();
      // Restore puts the SAME original reference back, not a copy.
      expect(target.debug).toBe(original);
    });
  });
});
