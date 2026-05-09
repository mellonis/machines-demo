import { describe, it, expect } from 'vitest';
import { MachineRunner } from './machineRunner';
import { makeFakeFactory } from './testUtils';

describe('MachineRunner', () => {
  describe('protocol shape', () => {
    it('R-protocol-build: posts {type:"build",engine,code} and resolves with BuiltResponse', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');

      expect(current().last).toEqual({
        type: 'build',
        engine: 'turing',
        code: '// user code',
      });

      const builtPayload = {
        type: 'built' as const,
        tapes: [],
        alphabets: [],
        halted: false,
      };
      current().respond(builtPayload);

      await expect(buildPromise).resolves.toEqual(builtPayload);
    });
  });
});
