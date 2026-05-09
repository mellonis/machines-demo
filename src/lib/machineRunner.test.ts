import { describe, it, expect } from 'vitest';
import { MAX_STEPS } from './caps';
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

    it('R-protocol-run: posts {type:"run",maxSteps,debug,step} and resolves with RanResponse', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      // Build first.
      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false });
      await buildPromise;

      // Custom-arg run.
      const runPromise = runner.run({ maxSteps: 100, debug: true, step: false });

      expect(current().last).toEqual({
        type: 'run',
        maxSteps: 100,
        debug: true,
        step: false,
      });

      const ranPayload = {
        type: 'ran' as const,
        tapes: [],
        truncated: false,
        commands: [],
        startStep: 0,
        stepsApplied: 5,
      };
      current().respond(ranPayload);

      await expect(runPromise).resolves.toEqual(ranPayload);
    });

    it('R-protocol-run-defaults: posts MAX_STEPS, debug=false, step=false on bare run()', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false });
      await buildPromise;

      const runPromise = runner.run();

      expect(current().last).toEqual({
        type: 'run',
        maxSteps: MAX_STEPS,
        debug: false,
        step: false,
      });

      current().respond({
        type: 'ran',
        tapes: [],
        truncated: false,
        commands: [],
        startStep: 0,
        stepsApplied: 0,
      });

      await runPromise;
    });

    it('R-protocol-resume: posts {type:"resume",step} and does not resolve the run promise', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      // Build, then start a run with onPaused.
      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false });
      await buildPromise;

      let pausedSeen = false;
      const runPromise = runner.run({
        onPaused: () => {
          pausedSeen = true;
        },
      });

      // Worker pauses.
      current().respond({
        type: 'paused',
        tapes: [],
        commands: [],
        stepsApplied: 1,
        state: 'q1',
        currentSymbols: ['a'],
        debugBreak: { before: true },
      });
      expect(pausedSeen).toBe(true);

      // Now resume(step=true).
      runner.resume(true);

      expect(current().last).toEqual({ type: 'resume', step: true });

      // Run promise still pending — resolves only on `ran`/`error`.
      // Sanity check: settle a microtask, ensure no resolution yet.
      let runResolved = false;
      void runPromise.then(() => {
        runResolved = true;
      });
      await Promise.resolve();
      expect(runResolved).toBe(false);

      // Default resume() posts step:false.
      runner.resume();
      expect(current().last).toEqual({ type: 'resume', step: false });

      // Cleanly settle the pending run by responding with `ran`.
      current().respond({
        type: 'ran',
        tapes: [],
        truncated: false,
        commands: [],
        startStep: 0,
        stepsApplied: 1,
      });
      await runPromise;
    });

    it('R-protocol-set-debug: posts {type:"setDebug",on}', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      // Build first to spawn the worker (setDebug is a no-op without one).
      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false });
      await buildPromise;

      runner.setDebug(true);
      expect(current().last).toEqual({ type: 'setDebug', on: true });

      runner.setDebug(false);
      expect(current().last).toEqual({ type: 'setDebug', on: false });
    });

    it('R-protocol-set-debug-no-worker: setDebug before build is a silent no-op', () => {
      const { factory } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      // No build yet, so no worker. setDebug must not throw.
      expect(() => runner.setDebug(true)).not.toThrow();
    });

    it('R-protocol-paused-then-ran: run() invokes onPaused on paused, resolves on ran', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false });
      await buildPromise;

      const pausedPayloads: Parameters<NonNullable<Parameters<MachineRunner['run']>[0]>['onPaused']>[0][] = [];
      const runPromise = runner.run({
        debug: true,
        onPaused: (p) => {
          pausedPayloads.push(p);
        },
      });

      const pausedPayload = {
        type: 'paused' as const,
        tapes: [],
        commands: [],
        stepsApplied: 1,
        state: 'q1',
        currentSymbols: ['a'],
        debugBreak: { before: true },
      };
      current().respond(pausedPayload);

      // onPaused fired with the payload.
      expect(pausedPayloads).toHaveLength(1);
      expect(pausedPayloads[0]).toEqual(pausedPayload);

      // Run still pending.
      let runSettled = false;
      void runPromise.then(() => {
        runSettled = true;
      });
      await Promise.resolve();
      expect(runSettled).toBe(false);

      // Now finish the run.
      const ranPayload = {
        type: 'ran' as const,
        tapes: [],
        truncated: false,
        commands: [],
        startStep: 0,
        stepsApplied: 5,
      };
      current().respond(ranPayload);

      await expect(runPromise).resolves.toEqual(ranPayload);
    });

    it('S-step-paused-off / R-protocol-step-arming: run({step:true}) posts step=true', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false });
      await buildPromise;

      const runPromise = runner.run({ step: true, debug: false });

      expect(current().last).toMatchObject({
        type: 'run',
        step: true,
        debug: false,
      });

      // Wrap up cleanly so the pending run doesn't leak between tests.
      current().respond({
        type: 'ran',
        tapes: [],
        truncated: false,
        commands: [],
        startStep: 0,
        stepsApplied: 0,
      });
      await runPromise;
    });
  });
});
