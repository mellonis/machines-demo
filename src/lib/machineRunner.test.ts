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

    it('R-protocol-step: posts {type:"step"} and resolves with SteppedResponse', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      // Build first to spawn the worker.
      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false });
      await buildPromise;

      const stepPromise = runner.step();

      expect(current().last).toEqual({ type: 'step' });

      const steppedPayload = {
        type: 'stepped' as const,
        halted: false,
        commands: null,
        nextCommands: null,
        stepsApplied: 1,
      };
      current().respond(steppedPayload);

      await expect(stepPromise).resolves.toEqual(steppedPayload);
    });
  });
});
