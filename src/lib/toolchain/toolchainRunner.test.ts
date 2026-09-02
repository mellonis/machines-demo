// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolchainRunner, ToolchainTimeoutError, ToolchainWorkerError } from './toolchainRunner.ts';
import { makeFakeToolchainFactory } from './toolchainTestUtils.ts';
import { setSetting } from '../settings.ts';
import type { FinishedResponse, TapeSnapshot } from './types.ts';

const snap = (cells: number[], head = 0): TapeSnapshot => ({ band: 0, name: 'tape', glyphs: [' ', '*'], origin: 0, cells: new Uint8Array(cells), head });
const finished = (cells: number[]): FinishedResponse => ({
  type: 'finished',
  result: { outcome: { kind: 'stopped' }, stats: { steps: 1, coreTacts: 1, stallTacts: 0, totalTacts: 1 }, ip: 0, stack: [] },
  snapshots: [snap(cells)],
});

describe('ToolchainRunner', () => {
  beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); });
  afterEach(() => { vi.useRealTimers(); });

  it('T-runner-build: build posts the request and resolves on built', async () => {
    const { factory, current } = makeFakeToolchainFactory();
    const r = new ToolchainRunner(factory);
    const p = r.build('pmc', 'main() {}');
    expect(current().last).toEqual({ type: 'build', lang: 'pmc', code: 'main() {}' });
    current().respond({ type: 'built', ok: false, diagnostics: [] });
    await expect(p).resolves.toEqual({ type: 'built', ok: false, diagnostics: [] });
  });

  it('T-runner-worker-kept: a second build reuses the same worker (no module re-init)', async () => {
    const { factory, current, all } = makeFakeToolchainFactory();
    const r = new ToolchainRunner(factory);
    const p1 = r.build('pmc', 'a'); current().respond({ type: 'built', ok: false, diagnostics: [] }); await p1;
    const p2 = r.build('pmc', 'b'); current().respond({ type: 'built', ok: false, diagnostics: [] }); await p2;
    expect(all()).toHaveLength(1);
  });

  it('T-runner-simple-during-run: check is answered while a run is pending', async () => {
    const { factory, current } = makeFakeToolchainFactory();
    const r = new ToolchainRunner(factory);
    const run = r.start({ seeds: [], breakpoints: [], mode: 'continuous' });
    const chk = r.check('pmc', 'x');
    current().respond({ type: 'checked', diagnostics: [] });
    await expect(chk).resolves.toEqual([]);
    current().respond(finished([1]));
    await expect(run).resolves.toMatchObject({ type: 'finished' });
  });

  it('T-runner-simple-queue: a second simple request waits for the first, then is posted; both resolve in order', async () => {
    const { factory, current } = makeFakeToolchainFactory();
    const r = new ToolchainRunner(factory);
    const order: string[] = [];
    const first = r.check('pmc', 'a').then(() => order.push('first'));
    const second = r.format('pmc', 'b').then(() => order.push('second'));
    // Only the first is on the wire; the format waits its turn.
    expect(current().postedMessages).toEqual([{ type: 'check', lang: 'pmc', code: 'a' }]);
    current().respond({ type: 'checked', diagnostics: [] });
    await first;
    expect(current().last).toEqual({ type: 'format', lang: 'pmc', code: 'b' });
    current().respond({ type: 'formatted', ok: true, text: 'b' });
    await second;
    expect(order).toEqual(['first', 'second']);
  });

  it('T-runner-queue-killed: a fatal error rejects the in-flight and the queued request', async () => {
    const { factory, current } = makeFakeToolchainFactory();
    const r = new ToolchainRunner(factory);
    const inFlight = r.check('pmc', 'a');
    const queued = r.build('pmc', 'b');
    current().respond({ type: 'error', message: 'module trap', fatal: true });
    await expect(inFlight).rejects.toBeInstanceOf(ToolchainWorkerError);
    await expect(queued).rejects.toThrow(/module trap/);
  });

  it('T-runner-maxsteps-from-settings: start fills limits from the setting; Infinity omits it', async () => {
    const { factory, current } = makeFakeToolchainFactory();
    const r = new ToolchainRunner(factory);
    void r.start({ seeds: [], breakpoints: [], mode: 'step' });
    expect(current().last).toMatchObject({ type: 'start', limits: { maxSteps: 100_000 } });
    current().respond(finished([]));
    setSetting('maxSteps', Infinity);
    void r.start({ seeds: [], breakpoints: [], mode: 'step' });
    expect(current().last).toMatchObject({ type: 'start', limits: {} });
  });

  it('T-runner-timer-suspend-on-paused: the watchdog stops on paused and restarts on resume', async () => {
    const { factory, current } = makeFakeToolchainFactory();
    const r = new ToolchainRunner(factory);
    const run = r.start({ seeds: [], breakpoints: [], mode: 'continuous' });
    current().respond({ type: 'paused', cause: 'manual', ip: 0, snapshots: [], stats: { steps: 0, coreTacts: 0, stallTacts: 0, totalTacts: 0 } });
    vi.advanceTimersByTime(60_000);
    expect(current().terminated).toBe(false);
    r.resume('continuous');
    vi.advanceTimersByTime(5_000);
    expect(current().terminated).toBe(true);
    await expect(run).rejects.toBeInstanceOf(ToolchainTimeoutError);
  });

  it('T-runner-idle-busy: idle stops the watchdog, busy restarts it', () => {
    const { factory, current } = makeFakeToolchainFactory();
    const r = new ToolchainRunner(factory);
    void r.start({ seeds: [], breakpoints: [], mode: 'auto', intervalMs: 30_000 }).catch(() => {});
    current().respond({ type: 'idle' });
    vi.advanceTimersByTime(30_000);
    expect(current().terminated).toBe(false);
    current().respond({ type: 'busy' });
    vi.advanceTimersByTime(5_000);
    expect(current().terminated).toBe(true);
  });

  it('T-runner-progress-stash: lastProgress survives a timeout kill and rides on the error', async () => {
    const { factory, current } = makeFakeToolchainFactory();
    const r = new ToolchainRunner(factory);
    const run = r.start({ seeds: [], breakpoints: [], mode: 'continuous' });
    current().respond({ type: 'progress', snapshots: [snap([1, 1])], steps: 7, ip: 3 });
    vi.advanceTimersByTime(5_000);
    const err = await run.catch((e) => e);
    expect(err).toBeInstanceOf(ToolchainTimeoutError);
    expect((err as ToolchainTimeoutError).progress?.steps).toBe(7);
    expect(r.lastProgress?.steps).toBe(7);
  });

  it('T-runner-error-routes: error rejects the simple pending first, then the run, else uncorrelated', async () => {
    const { factory, current } = makeFakeToolchainFactory();
    const r = new ToolchainRunner(factory);
    const seen: string[] = [];
    r.onUncorrelatedError = (m) => seen.push(m);
    const run = r.start({ seeds: [], breakpoints: [], mode: 'continuous' });
    const chk = r.check('pmc', 'x');
    current().respond({ type: 'error', message: 'lint boom' });
    await expect(chk).rejects.toBeInstanceOf(ToolchainWorkerError);
    current().respond({ type: 'error', message: 'run boom' });
    await expect(run).rejects.toThrow('run boom');
    current().respond({ type: 'error', message: 'stray' });
    expect(seen).toEqual(['stray']);
  });

  it('T-runner-fatal-respawn: a fatal error terminates the worker, calls onFatal, and the next request spawns a new one', async () => {
    const { factory, current, all } = makeFakeToolchainFactory();
    const r = new ToolchainRunner(factory);
    const fatal: string[] = [];
    r.onFatal = (m) => fatal.push(m);
    const p = r.build('pmc', 'x');
    current().respond({ type: 'error', message: 'unreachable', fatal: true });
    await expect(p).rejects.toMatchObject({ fatal: true });
    expect(all()[0].terminated).toBe(true);
    expect(fatal).toEqual(['unreachable']);
    void r.build('pmc', 'y');
    expect(all()).toHaveLength(2);
  });

  it('T-runner-handlers: stepped / paused / progress reach their handlers; finished resolves', async () => {
    const { factory, current } = makeFakeToolchainFactory();
    const r = new ToolchainRunner(factory);
    const onStepped = vi.fn(); const onPaused = vi.fn(); const onProgress = vi.fn();
    const run = r.start({ seeds: [], breakpoints: [], mode: 'auto', intervalMs: 100 }, { onStepped, onPaused, onProgress });
    current().respond({ type: 'stepped', snapshots: [], ip: 1, stats: { steps: 1, coreTacts: 0, stallTacts: 0, totalTacts: 0 }, retired: true });
    current().respond({ type: 'progress', snapshots: [], steps: 1, ip: 1 });
    current().respond({ type: 'paused', cause: 'brk', ip: 2, snapshots: [], stats: { steps: 2, coreTacts: 0, stallTacts: 0, totalTacts: 0 } });
    expect(onStepped).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onPaused).toHaveBeenCalledTimes(1);
    r.resume('step');
    expect(current().last).toEqual({ type: 'resume', mode: 'step', intervalMs: undefined });
    current().respond(finished([]));
    await expect(run).resolves.toMatchObject({ type: 'finished' });
    expect(r.runPending).toBe(false);
  });

  it('T-runner-run-timeout-clears-simple: a run timeout also rejects the in-flight and queued simple requests', async () => {
    const { factory, current } = makeFakeToolchainFactory();
    const r = new ToolchainRunner(factory);
    const run = r.start({ seeds: [], breakpoints: [], mode: 'continuous' });
    // The lint `check` rides along mid-run, so its own watchdog is armed
    // later than the run's and would not fire on this tick — only the run
    // timeout can clean it up.
    vi.advanceTimersByTime(2_000);
    const inFlight = r.check('pmc', 'a');
    const queued = r.build('pmc', 'b');
    vi.advanceTimersByTime(3_000);
    await expect(run).rejects.toBeInstanceOf(ToolchainTimeoutError);
    await expect(inFlight).rejects.toBeInstanceOf(ToolchainWorkerError);
    await expect(queued).rejects.toThrow(/worker terminated/);
    // Nothing left behind: the next request gets a fresh worker straight away
    // instead of queueing behind an orphan that can never settle.
    void r.build('pmc', 'c').catch(() => {});
    expect(current().last).toEqual({ type: 'build', lang: 'pmc', code: 'c' });
  });

  it('T-runner-simple-timeout-clears-run: a simple timeout while the run is paused rejects the pending run too', async () => {
    const { factory, current } = makeFakeToolchainFactory();
    const r = new ToolchainRunner(factory);
    const run = r.start({ seeds: [], breakpoints: [], mode: 'continuous' });
    // A pause stops the run watchdog, so only the simple channel's timer is armed.
    current().respond({ type: 'paused', cause: 'manual', ip: 0, snapshots: [], stats: { steps: 0, coreTacts: 0, stallTacts: 0, totalTacts: 0 } });
    const chk = r.check('pmc', 'a');
    vi.advanceTimersByTime(5_000);
    await expect(chk).rejects.toBeInstanceOf(ToolchainTimeoutError);
    await expect(run).rejects.toThrow(/worker terminated/);
    expect(r.runPending).toBe(false);
    expect(current().terminated).toBe(true);
  });

  it('T-runner-onerror-fatal: a native worker error reports onFatal, rejects everything, and the next request respawns', async () => {
    const { factory, current, all } = makeFakeToolchainFactory();
    const r = new ToolchainRunner(factory);
    const fatal: string[] = [];
    r.onFatal = (m) => fatal.push(m);
    const run = r.start({ seeds: [], breakpoints: [], mode: 'continuous' });
    const inFlight = r.check('pmc', 'a');
    const queued = r.build('pmc', 'b');
    current().onerror?.({ message: 'boom' } as ErrorEvent);
    expect(fatal).toEqual(['worker error: boom']);
    await expect(run).rejects.toThrow(/worker error: boom/);
    await expect(inFlight).rejects.toThrow(/worker error: boom/);
    await expect(queued).rejects.toThrow(/worker error: boom/);
    expect(all()[0].terminated).toBe(true);
    void r.build('pmc', 'c').catch(() => {});
    expect(all()).toHaveLength(2);
  });

  it('T-runner-resume-without-run: resume / pause / stop with no run are silent no-ops', () => {
    const { factory } = makeFakeToolchainFactory();
    const r = new ToolchainRunner(factory);
    expect(() => r.resume('continuous')).not.toThrow();
    expect(() => r.pause()).not.toThrow();
    expect(() => r.stop()).not.toThrow();
  });

  it('T-runner-reject-overlap: a second start while one is pending throws', () => {
    const { factory } = makeFakeToolchainFactory();
    const r = new ToolchainRunner(factory);
    void r.start({ seeds: [], breakpoints: [], mode: 'step' }).catch(() => {});
    expect(() => r.start({ seeds: [], breakpoints: [], mode: 'step' })).toThrow(/pending/);
  });
});
