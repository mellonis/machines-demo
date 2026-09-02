// Main-thread wrapper for the toolchain worker. Same shape as
// lib/machineRunner.ts (injected worker factory, per-segment watchdog read
// from settings at each segment start, progress stash kept across terminate)
// with two differences: one simple request may be pending alongside a run
// (lint and format are served between pump slices), and the worker is kept
// across builds because module init is the expensive part. A fatal error
// (`docs/wasm.md (failure modes)`) kills the worker; the next request respawns.
import { getSetting } from '../settings.ts';
import type {
  BuiltResponse, Diagnostic, DriveMode, FinishedResponse, FormattedResponse, Lang, PausedResponse,
  ProgressResponse, Seed, SteppedResponse, TapeBlockTapeInput, ToolchainRequest, ToolchainResponse,
} from './types.ts';

export class ToolchainWorkerError extends Error {
  readonly fatal: boolean;
  constructor(message: string, fatal = false) { super(message); this.name = 'ToolchainWorkerError'; this.fatal = fatal; }
}

export class ToolchainTimeoutError extends ToolchainWorkerError {
  readonly progress: ProgressResponse | null;
  constructor(message: string, progress: ProgressResponse | null) { super(message); this.name = 'ToolchainTimeoutError'; this.progress = progress; }
}

export interface ToolchainWorkerLike {
  postMessage(msg: ToolchainRequest): void;
  terminate(): void;
  onmessage: ((e: MessageEvent<ToolchainResponse>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
}
export type ToolchainWorkerFactory = () => ToolchainWorkerLike;

export type RunHandlers = {
  onStepped?: (r: SteppedResponse) => void;
  onPaused?: (r: PausedResponse) => void;
  onProgress?: (r: ProgressResponse) => void;
};

type SimpleEntry = { msg: ToolchainRequest; resolve: (r: ToolchainResponse) => void; reject: (e: Error) => void };
type SimplePending = SimpleEntry & { timeoutId: ReturnType<typeof setTimeout> };
type RunPending = { resolve: (r: FinishedResponse) => void; reject: (e: Error) => void; timeoutId: ReturnType<typeof setTimeout> | null; handlers: RunHandlers };

const RUN_CHANNEL = new Set(['stepped', 'progress', 'paused', 'finished', 'idle', 'busy']);

export type StartOptions = Omit<Extract<ToolchainRequest, { type: 'start' }>, 'type' | 'limits'> & { limits?: { maxSteps?: number } };

export class ToolchainRunner {
  private worker: ToolchainWorkerLike | null = null;
  private simple: SimplePending | null = null;
  /** Simple requests waiting for the channel — FIFO. The lint `check` that
   *  rides along a continuous run can be in flight for a while, so a Build /
   *  Format / disassemble click landing in that window queues behind it
   *  instead of failing. */
  private simpleQueue: SimpleEntry[] = [];
  private run: RunPending | null = null;
  private lastRunProgress: ProgressResponse | null = null;
  onUncorrelatedError: ((message: string) => void) | null = null;
  onFatal: ((message: string) => void) | null = null;

  constructor(private readonly factory: ToolchainWorkerFactory) {}

  get lastProgress(): ProgressResponse | null { return this.lastRunProgress; }
  get runPending(): boolean { return this.run !== null; }

  private ensureWorker(): ToolchainWorkerLike {
    if (!this.worker) {
      this.worker = this.factory();
      this.worker.onmessage = (e) => this.onMessage(e.data);
      this.worker.onerror = (e) => {
        const message = `worker error: ${e.message ?? 'unknown'}`;
        this.onFatal?.(message);
        this.killAll(new ToolchainWorkerError(message, true));
      };
    }
    return this.worker;
  }

  /**
   * The single kill path. Whatever killed the worker — a watchdog on either
   * channel, a fatal module error, unmount — takes down *both* channels:
   * leaving one pending against a terminated worker strands the request
   * forever (and the queue behind it) until its own timer fires with a
   * misleading message. `runErr` lets the channel that timed out report the
   * real cause while the other reads "worker terminated".
   */
  private killAll(err: Error, runErr: Error = err): void {
    const simple = this.simple;
    const queued = this.simpleQueue;
    const run = this.run;
    this.simple = null;
    this.simpleQueue = [];
    this.run = null;
    if (simple) clearTimeout(simple.timeoutId);
    if (run?.timeoutId) clearTimeout(run.timeoutId);
    if (this.worker) { this.worker.terminate(); this.worker = null; }
    // Reject last, with the runner already back to a clean state, so a
    // handler that immediately posts a new request gets a fresh worker
    // instead of one this call is about to terminate.
    simple?.reject(err);
    for (const entry of queued) entry.reject(err);
    run?.reject(runErr);
  }

  private startRunTimer(): void {
    if (!this.run) return;
    if (this.run.timeoutId) clearTimeout(this.run.timeoutId);
    const timeoutMs = getSetting('workerTimeoutMs');
    this.run.timeoutId = setTimeout(() => {
      this.killAll(
        new ToolchainWorkerError('worker terminated'),
        new ToolchainTimeoutError(`timeout after ${timeoutMs}ms — worker terminated (likely infinite loop)`, this.lastRunProgress),
      );
    }, timeoutMs);
  }

  private stopRunTimer(): void {
    if (this.run?.timeoutId) { clearTimeout(this.run.timeoutId); this.run.timeoutId = null; }
  }

  private onMessage(data: ToolchainResponse): void {
    if (data.type === 'error') {
      const err = new ToolchainWorkerError(data.message, data.fatal === true);
      if (err.fatal) { this.onFatal?.(data.message); this.killAll(err); return; }
      if (this.simple) { this.settleSimple((p) => p.reject(err)); return; }
      if (this.run) { const p = this.run; this.run = null; if (p.timeoutId) clearTimeout(p.timeoutId); p.reject(err); return; }
      this.onUncorrelatedError?.(data.message);
      return;
    }
    if (RUN_CHANNEL.has(data.type)) {
      const p = this.run;
      if (!p) return;
      switch (data.type) {
        case 'stepped': this.stopRunTimer(); p.handlers.onStepped?.(data); return;
        case 'paused': this.stopRunTimer(); p.handlers.onPaused?.(data); return;
        case 'progress': this.lastRunProgress = data; p.handlers.onProgress?.(data); return;
        case 'idle': this.stopRunTimer(); return;
        case 'busy': this.startRunTimer(); return;
        case 'finished':
          this.run = null;
          this.lastRunProgress = null;
          if (p.timeoutId) clearTimeout(p.timeoutId);
          p.resolve(data);
          return;
      }
    }
    if (this.simple) this.settleSimple((p) => p.resolve(data));
  }

  private sendSimple(msg: ToolchainRequest): Promise<ToolchainResponse> {
    return new Promise((resolve, reject) => {
      this.simpleQueue.push({ msg, resolve, reject });
      this.pumpSimpleQueue();
    });
  }

  /** Posts the next queued simple request once the channel is free. The
   *  watchdog is armed here, at dequeue — arming it at enqueue would make a
   *  queued request inherit the wall-clock budget of the one ahead of it. */
  private pumpSimpleQueue(): void {
    if (this.simple || this.simpleQueue.length === 0) return;
    const entry = this.simpleQueue.shift()!;
    const w = this.ensureWorker();
    const timeoutMs = getSetting('workerTimeoutMs');
    const timeoutId = setTimeout(() => {
      this.killAll(
        new ToolchainTimeoutError(`timeout after ${timeoutMs}ms — worker terminated`, null),
        new ToolchainWorkerError('worker terminated'),
      );
    }, timeoutMs);
    this.simple = { ...entry, timeoutId };
    w.postMessage(entry.msg);
  }

  /** Settles the in-flight simple request and starts the next one. */
  private settleSimple(settle: (p: SimplePending) => void): void {
    const p = this.simple;
    if (!p) return;
    this.simple = null;
    clearTimeout(p.timeoutId);
    settle(p);
    this.pumpSimpleQueue();
  }

  private async expect<T extends ToolchainResponse['type']>(msg: ToolchainRequest, type: T): Promise<Extract<ToolchainResponse, { type: T }>> {
    const r = await this.sendSimple(msg);
    if (r.type !== type) throw new Error(`unexpected response: ${r.type}`);
    return r as Extract<ToolchainResponse, { type: T }>;
  }

  build(lang: Lang, code: string): Promise<BuiltResponse> { return this.expect({ type: 'build', lang, code }, 'built'); }
  async stdlib(lang: Lang): Promise<string> { return (await this.expect({ type: 'stdlib', lang }, 'stdlibText')).text; }
  async check(lang: Lang, code: string): Promise<Diagnostic[]> { return (await this.expect({ type: 'check', lang, code }, 'checked')).diagnostics; }
  format(lang: Lang, code: string): Promise<FormattedResponse> { return this.expect({ type: 'format', lang, code }, 'formatted'); }
  async disassemble(): Promise<string> { return (await this.expect({ type: 'disassemble' }, 'disassembled')).text; }
  async decodeTapeBlock(bytes: Uint8Array): Promise<Seed[]> { return (await this.expect({ type: 'decodeTapeBlock', bytes }, 'tapeBlockSeeds')).seeds; }
  async encodeTapeBlock(tapes: TapeBlockTapeInput[]): Promise<Uint8Array> { return (await this.expect({ type: 'encodeTapeBlock', tapes }, 'tapeBlockBytes')).bytes; }

  start(opts: StartOptions, handlers: RunHandlers = {}): Promise<FinishedResponse> {
    if (this.run) throw new Error('previous run still pending');
    const w = this.ensureWorker();
    const maxSteps = opts.limits?.maxSteps ?? getSetting('maxSteps');
    const limits = Number.isFinite(maxSteps) ? { maxSteps } : {};
    this.lastRunProgress = null;
    return new Promise((resolve, reject) => {
      this.run = { resolve, reject, timeoutId: null, handlers };
      this.startRunTimer();
      w.postMessage({ type: 'start', seeds: opts.seeds, limits, breakpoints: opts.breakpoints, mode: opts.mode, intervalMs: opts.intervalMs });
    });
  }

  /** No-op without a live run: these three are wired straight to click
   *  handlers, and the worker can be gone (a watchdog kill) by the time the
   *  user reaches the button. */
  resume(mode: DriveMode, intervalMs?: number): void {
    if (!this.run || !this.worker) return;
    this.startRunTimer();
    this.worker.postMessage({ type: 'resume', mode, intervalMs });
  }

  pause(): void { if (this.run && this.worker) this.worker.postMessage({ type: 'pause' }); }
  stop(): void { if (this.run && this.worker) { this.startRunTimer(); this.worker.postMessage({ type: 'stop' }); } }
  setBreakpoints(addrs: number[]): void { this.worker?.postMessage({ type: 'setBreakpoints', addrs }); }
  setDebug(on: boolean): void { this.worker?.postMessage({ type: 'setDebug', on }); }

  terminate(): void { this.killAll(new ToolchainWorkerError('runner terminated')); }
}
