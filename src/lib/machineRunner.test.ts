import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MAX_STEPS, WORKER_TIMEOUT_MS } from './caps';
import { MachineRunner, WorkerError } from './machineRunner';
import { type PausedResponse } from './types';
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
        graph: { initialId: 0, alphabets: [], nodes: {} },
      };
      current().respond(builtPayload);

      await expect(buildPromise).resolves.toEqual(builtPayload);
    });

    it('R-protocol-step: posts {type:"step"} and resolves with SteppedResponse', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      // Build first to spawn the worker.
      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false, graph: { initialId: 0, alphabets: [], nodes: {} } });
      await buildPromise;

      const stepPromise = runner.step();

      expect(current().last).toEqual({ type: 'step' });

      const steppedPayload = {
        type: 'stepped' as const,
        halted: false,
        commands: null,
        reads: null,
        nextCommands: null,
        currentStateId: null,
        nextStateId: null,
        prevStateId: null,
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
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false, graph: { initialId: 0, alphabets: [], nodes: {} } });
      await buildPromise;

      // Custom-arg run.
      const runPromise = runner.run({ maxSteps: 100, debug: true, step: false });

      expect(current().last).toEqual({
        type: 'run',
        maxSteps: 100,
        debug: true,
        step: false,
        intervalMs: null,
      });

      const ranPayload = {
        type: 'ran' as const,
        tapes: [],
        truncated: false,
        commands: [],
        reads: [],
        currentStateId: null,
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
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false, graph: { initialId: 0, alphabets: [], nodes: {} } });
      await buildPromise;

      const runPromise = runner.run();

      expect(current().last).toEqual({
        type: 'run',
        maxSteps: MAX_STEPS,
        debug: false,
        step: false,
        intervalMs: null,
      });

      current().respond({
        type: 'ran',
        tapes: [],
        truncated: false,
        commands: [],
        reads: [],
        currentStateId: null,
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
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false, graph: { initialId: 0, alphabets: [], nodes: {} } });
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
        reads: [],
        stepsApplied: 1,
        state: 'q1',
        currentSymbols: ['a'],
        debugBreak: { before: true as const },
        currentStateId: null,
        nextStateId: null,
        prevStateId: null,
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
        reads: [],
        currentStateId: null,
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
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false, graph: { initialId: 0, alphabets: [], nodes: {} } });
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
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false, graph: { initialId: 0, alphabets: [], nodes: {} } });
      await buildPromise;

      const pausedPayloads: PausedResponse[] = [];
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
        reads: [],
        stepsApplied: 1,
        state: 'q1',
        currentSymbols: ['a'],
        debugBreak: { before: true as const },
        currentStateId: null,
        nextStateId: null,
        prevStateId: null,
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
        reads: [],
        currentStateId: null,
        startStep: 0,
        stepsApplied: 5,
      };
      current().respond(ranPayload);

      await expect(runPromise).resolves.toEqual(ranPayload);
    });

    it('R-run-intervalms-passthrough: run({intervalMs}) posts the value on the run request', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false, graph: { initialId: 0, alphabets: [], nodes: {} } });
      await buildPromise;

      const runPromise = runner.run({ intervalMs: 250 });
      expect(current().last).toMatchObject({ type: 'run', intervalMs: 250 });

      // Settle so the test doesn't leak a pending run.
      current().respond({
        type: 'ran',
        tapes: [],
        truncated: false,
        commands: [],
        reads: [],
        currentStateId: null,
        startStep: 0,
        stepsApplied: 0,
      });
      await runPromise;
    });

    it('R-resume-intervalms-on: resume(step, intervalMs) posts intervalMs', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false, graph: { initialId: 0, alphabets: [], nodes: {} } });
      await buildPromise;

      const runPromise = runner.run({ debug: true, onPaused: () => {} });
      current().respond({
        type: 'paused',
        tapes: [],
        commands: [],
        reads: [],
        stepsApplied: 1,
        state: 'q1',
        currentSymbols: ['a'],
        debugBreak: { before: true as const },
        currentStateId: null,
        nextStateId: null,
        prevStateId: null,
      });

      runner.resume(false, 500);
      expect(current().last).toEqual({ type: 'resume', step: false, intervalMs: 500 });

      runner.resume(true, null);
      expect(current().last).toEqual({ type: 'resume', step: true, intervalMs: null });

      current().respond({
        type: 'ran',
        tapes: [],
        truncated: false,
        commands: [],
        reads: [],
        currentStateId: null,
        startStep: 0,
        stepsApplied: 1,
      });
      await runPromise;
    });

    it('R-resume-intervalms-omitted: resume(step) without intervalMs leaves field off', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false, graph: { initialId: 0, alphabets: [], nodes: {} } });
      await buildPromise;

      const runPromise = runner.run({ debug: true, onPaused: () => {} });
      current().respond({
        type: 'paused',
        tapes: [],
        commands: [],
        reads: [],
        stepsApplied: 1,
        state: 'q1',
        currentSymbols: ['a'],
        debugBreak: { before: true as const },
        currentStateId: null,
        nextStateId: null,
        prevStateId: null,
      });

      runner.resume(true);
      // Default resume() must not carry intervalMs — the worker reads the
      // missing field as "keep the previous policy", and tests downstream
      // depend on that exact wire shape.
      expect(current().last).toEqual({ type: 'resume', step: true });

      current().respond({
        type: 'ran',
        tapes: [],
        truncated: false,
        commands: [],
        reads: [],
        currentStateId: null,
        startStep: 0,
        stepsApplied: 1,
      });
      await runPromise;
    });

    it('R-pause-protocol: pause() posts {type:"pause"} mid-run', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false, graph: { initialId: 0, alphabets: [], nodes: {} } });
      await buildPromise;

      const runPromise = runner.run({ intervalMs: 250 });
      runner.pause();
      expect(current().last).toEqual({ type: 'pause' });

      // pause doesn't complete the run; settle via ran for cleanup.
      current().respond({
        type: 'ran',
        tapes: [],
        truncated: false,
        commands: [],
        reads: [],
        currentStateId: null,
        startStep: 0,
        stepsApplied: 1,
      });
      await runPromise;
    });

    it('R-pause-no-run: pause() with no pending run throws', () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false, graph: { initialId: 0, alphabets: [], nodes: {} } });
      void buildPromise;

      expect(() => runner.pause()).toThrow('pause: no pending run');
    });

    it('R-iter-callback: idle forwards to onIter and does not complete the run', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false, graph: { initialId: 0, alphabets: [], nodes: {} } });
      await buildPromise;

      const iters: { stepsApplied: number; len: number }[] = [];
      const runPromise = runner.run({
        intervalMs: 250,
        onIter: (d) => iters.push({ stepsApplied: d.stepsApplied, len: d.commands.length }),
      });

      current().respond({
        type: 'idle',
        commands: [[{ movement: 'R', symbol: null }]],
        reads: [['_']],
        currentStateId: null,
        nextStateId: null,
        stepsApplied: 1,
      });
      current().respond({ type: 'busy' });
      current().respond({
        type: 'idle',
        commands: [[{ movement: 'L', symbol: null }]],
        reads: [['_']],
        currentStateId: null,
        nextStateId: null,
        stepsApplied: 2,
      });
      current().respond({ type: 'busy' });

      expect(iters).toEqual([
        { stepsApplied: 1, len: 1 },
        { stepsApplied: 2, len: 1 },
      ]);

      // Run still pending — only ran/error complete it.
      let resolved = false;
      void runPromise.then(() => { resolved = true; });
      await Promise.resolve();
      expect(resolved).toBe(false);

      current().respond({
        type: 'ran',
        tapes: [],
        truncated: false,
        commands: [],
        reads: [],
        currentStateId: null,
        startStep: 2,
        stepsApplied: 2,
      });
      await runPromise;
    });

    it('S-step-paused-off / R-protocol-step-arming: run({step:true}) posts step=true', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false, graph: { initialId: 0, alphabets: [], nodes: {} } });
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
        reads: [],
        currentStateId: null,
        startStep: 0,
        stepsApplied: 0,
      });
      await runPromise;
    });
  });

  describe('timer', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('R-timer-build-timeout: build with no response rejects with timeout error and terminates worker', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      // Attach assertion before advancing the clock so the rejection is
      // handled the moment setTimeout fires (avoids PromiseRejectionHandledWarning).
      const assertion = expect(buildPromise).rejects.toThrow(
        `timeout after ${WORKER_TIMEOUT_MS}ms — worker terminated (likely infinite loop)`,
      );
      await vi.advanceTimersByTimeAsync(WORKER_TIMEOUT_MS);
      await assertion;
      expect(current().terminated).toBe(true);
    });

    it('R-timer-step-timeout: step with no response rejects with timeout error and terminates worker', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false, graph: { initialId: 0, alphabets: [], nodes: {} } });
      await buildPromise;

      const stepPromise = runner.step();
      // Attach assertion before advancing the clock so the rejection is handled immediately.
      const assertion = expect(stepPromise).rejects.toThrow(/timeout after/);
      await vi.advanceTimersByTimeAsync(WORKER_TIMEOUT_MS);
      await assertion;
      expect(current().terminated).toBe(true);
    });

    it('R-timer-run-timeout-no-paused: run with no paused/ran rejects with timeout error and terminates worker', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false, graph: { initialId: 0, alphabets: [], nodes: {} } });
      await buildPromise;

      const runPromise = runner.run({ debug: true, onPaused: () => {} });
      // Attach assertion before advancing the clock so the rejection is handled immediately.
      const assertion = expect(runPromise).rejects.toThrow(/timeout after/);
      await vi.advanceTimersByTimeAsync(WORKER_TIMEOUT_MS);
      await assertion;
      expect(current().terminated).toBe(true);
    });

    it('R-timer-suspend-on-paused: paused clears the timer; advancing past WORKER_TIMEOUT_MS does not reject', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false, graph: { initialId: 0, alphabets: [], nodes: {} } });
      await buildPromise;

      const runPromise = runner.run({ debug: true, onPaused: () => {} });
      current().respond({
        type: 'paused',
        tapes: [],
        commands: [],
        reads: [],
        stepsApplied: 1,
        state: 'q1',
        currentSymbols: ['a'],
        debugBreak: { before: true as const },
        currentStateId: null,
        nextStateId: null,
        prevStateId: null,
      });

      // Advance time well past the timeout — paused should have cleared it.
      await vi.advanceTimersByTimeAsync(WORKER_TIMEOUT_MS * 2);

      // Run should still be pending.
      let runSettled = false;
      void runPromise.then(
        () => { runSettled = true; },
        () => { runSettled = true; },
      );
      await Promise.resolve();
      expect(runSettled).toBe(false);

      // Settle cleanly so the test doesn't leak a pending Promise.
      current().respond({
        type: 'ran',
        tapes: [],
        truncated: false,
        commands: [],
        reads: [],
        currentStateId: null,
        startStep: 0,
        stepsApplied: 1,
      });
      await runPromise;
    });

    it('R-timer-restart-on-resume: resume re-arms the timer; advancing past WORKER_TIMEOUT_MS rejects', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false, graph: { initialId: 0, alphabets: [], nodes: {} } });
      await buildPromise;

      const runPromise = runner.run({ debug: true, onPaused: () => {} });
      current().respond({
        type: 'paused',
        tapes: [],
        commands: [],
        reads: [],
        stepsApplied: 1,
        state: 'q1',
        currentSymbols: ['a'],
        debugBreak: { before: true as const },
        currentStateId: null,
        nextStateId: null,
        prevStateId: null,
      });

      runner.resume(false);
      // Attach assertion before advancing the clock so the rejection is handled immediately.
      const assertion = expect(runPromise).rejects.toThrow(/timeout after/);
      await vi.advanceTimersByTimeAsync(WORKER_TIMEOUT_MS);
      await assertion;
    });

    it('R-timer-suspend-on-idle: idle clears the timer; advancing past WORKER_TIMEOUT_MS does not reject', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false, graph: { initialId: 0, alphabets: [], nodes: {} } });
      await buildPromise;

      const runPromise = runner.run({ intervalMs: 60_000, onIter: () => {} });
      // Worker is now in a throttle window — emit idle so the runner suspends.
      current().respond({
        type: 'idle',
        commands: [[{ movement: 'R', symbol: null }]],
        reads: [['_']],
        currentStateId: null,
        nextStateId: null,
        stepsApplied: 1,
      });

      // Advance past WORKER_TIMEOUT_MS — should NOT reject (we're idle).
      await vi.advanceTimersByTimeAsync(WORKER_TIMEOUT_MS * 2);

      let runSettled = false;
      void runPromise.then(
        () => { runSettled = true; },
        () => { runSettled = true; },
      );
      await Promise.resolve();
      expect(runSettled).toBe(false);

      // Settle cleanly.
      current().respond({
        type: 'ran',
        tapes: [],
        truncated: false,
        commands: [],
        reads: [],
        currentStateId: null,
        startStep: 1,
        stepsApplied: 1,
      });
      await runPromise;
    });

    it('R-timer-restart-on-busy: busy re-arms the timer; advancing past WORKER_TIMEOUT_MS rejects', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false, graph: { initialId: 0, alphabets: [], nodes: {} } });
      await buildPromise;

      const runPromise = runner.run({ intervalMs: 60_000, onIter: () => {} });
      current().respond({
        type: 'idle',
        commands: [[{ movement: 'R', symbol: null }]],
        reads: [['_']],
        currentStateId: null,
        nextStateId: null,
        stepsApplied: 1,
      });
      current().respond({ type: 'busy' });

      // Timer restarted — advancing past WORKER_TIMEOUT_MS should reject.
      const assertion = expect(runPromise).rejects.toThrow(/timeout after/);
      await vi.advanceTimersByTimeAsync(WORKER_TIMEOUT_MS);
      await assertion;
    });

    it('R-timer-cleared-on-ran: ran response clears the timer; subsequent time advance has no effect', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false, graph: { initialId: 0, alphabets: [], nodes: {} } });
      await buildPromise;

      const runPromise = runner.run();
      current().respond({
        type: 'ran',
        tapes: [],
        truncated: false,
        commands: [],
        reads: [],
        currentStateId: null,
        startStep: 0,
        stepsApplied: 0,
      });
      await runPromise;

      // Advance time past WORKER_TIMEOUT_MS — should be a no-op since the timer was cleared on ran.
      await vi.advanceTimersByTimeAsync(WORKER_TIMEOUT_MS * 2);

      // If the timer had still been alive, it would have called terminate().
      expect(current().terminated).toBe(false);
    });
  });

  describe('pending', () => {
    it('R-pending-simple-overlap: build then step before built rejects step', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      await expect(runner.step()).rejects.toThrow('previous request still pending');

      // Settle the build.
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false, graph: { initialId: 0, alphabets: [], nodes: {} } });
      await buildPromise;
    });

    it('R-pending-run-overlap: run then run synchronously throws', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false, graph: { initialId: 0, alphabets: [], nodes: {} } });
      await buildPromise;

      const runPromise = runner.run();

      // run() is NOT async — overlap throws synchronously.
      expect(() => runner.run()).toThrow('previous request still pending');

      // Settle the first run.
      current().respond({
        type: 'ran',
        tapes: [],
        truncated: false,
        commands: [],
        reads: [],
        currentStateId: null,
        startStep: 0,
        stepsApplied: 0,
      });
      await runPromise;
    });

    it('R-pending-simple-during-run: step during pending run rejects step', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false, graph: { initialId: 0, alphabets: [], nodes: {} } });
      await buildPromise;

      const runPromise = runner.run();
      await expect(runner.step()).rejects.toThrow('previous request still pending');

      // Settle.
      current().respond({
        type: 'ran',
        tapes: [],
        truncated: false,
        commands: [],
        reads: [],
        currentStateId: null,
        startStep: 0,
        stepsApplied: 0,
      });
      await runPromise;
    });

    it('R-pending-rebuild-rejects-pending: second build rejects the first with "superseded by new worker"', async () => {
      const { factory, all } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const firstBuild = runner.build('// first');
      expect(all()).toHaveLength(1);

      const secondBuild = runner.build('// second');
      expect(all()).toHaveLength(2);

      await expect(firstBuild).rejects.toThrow('superseded by new worker');
      expect(all()[0].terminated).toBe(true);

      // Second build proceeds normally.
      all()[1].respond({ type: 'built', tapes: [], alphabets: [], halted: false, graph: { initialId: 0, alphabets: [], nodes: {} } });
      await secondBuild;
    });

    it('R-pending-terminate-rejects-all: terminate rejects pending run; then rejects pending build on a fresh build', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      // Pending run case.
      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false, graph: { initialId: 0, alphabets: [], nodes: {} } });
      await buildPromise;

      const runPromise = runner.run();
      runner.terminate();

      await expect(runPromise).rejects.toThrow('runner terminated');
      expect(current().terminated).toBe(true);

      // Pending build case (fresh build via spawnWorker, then terminate before built response).
      const buildAgain = runner.build('// user code');
      runner.terminate();

      await expect(buildAgain).rejects.toThrow('runner terminated');
    });
  });

  describe('error', () => {
    it('R-error-wraps-as-worker-error: error response with tapes wraps as WorkerError', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      const tapes = [{ symbols: ['a', 'b'], position: 0 }];
      current().respond({ type: 'error', message: 'parse error', tapes });

      let caught: unknown;
      try {
        await buildPromise;
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(WorkerError);
      expect((caught as WorkerError).message).toBe('parse error');
      expect((caught as WorkerError).tapes).toEqual(tapes);
    });

    it('R-error-tapes-default-null: error response without tapes field → tapes is null (not undefined)', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      current().respond({ type: 'error', message: 'no edge for symbol' });

      let caught: unknown;
      try {
        await buildPromise;
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(WorkerError);
      expect((caught as WorkerError).tapes).toBeNull();
    });

    it('R-error-during-step: error response during pending step rejects step with WorkerError', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false, graph: { initialId: 0, alphabets: [], nodes: {} } });
      await buildPromise;

      const stepPromise = runner.step();
      current().respond({ type: 'error', message: 'mid-step error' });

      await expect(stepPromise).rejects.toBeInstanceOf(WorkerError);
    });

    it('R-error-during-run: error response during pending run rejects run with WorkerError; worker not terminated', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false, graph: { initialId: 0, alphabets: [], nodes: {} } });
      await buildPromise;

      const runPromise = runner.run();
      current().respond({ type: 'error', message: 'mid-run error' });

      await expect(runPromise).rejects.toBeInstanceOf(WorkerError);
      expect(current().terminated).toBe(false);
    });

    it('R-error-onerror-event: worker.onerror fires; pending request rejects with plain Error and "worker error:" prefix', async () => {
      const { factory, current } = makeFakeFactory();
      const runner = new MachineRunner('turing', factory);

      const buildPromise = runner.build('// user code');
      current().respond({ type: 'built', tapes: [], alphabets: [], halted: false, graph: { initialId: 0, alphabets: [], nodes: {} } });
      await buildPromise;

      const stepPromise = runner.step();
      current().errorEvent('worker crashed');

      let caught: unknown;
      try {
        await stepPromise;
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBeInstanceOf(WorkerError);
      expect((caught as Error).message).toMatch(/^worker error: worker crashed/);
    });
  });
});
