import { describe, it, expect } from 'vitest';
import * as turing from '@turing-machine-js/machine';
import { movementCode, commandsFromYield, type MachineYield } from './workerHelpers';

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
});
