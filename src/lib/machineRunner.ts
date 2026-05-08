import MachineWorker from './machineWorker.ts?worker';
import { MAX_STEPS, WORKER_TIMEOUT_MS } from './caps.ts';
import {
  type BuiltResponse,
  type Engine,
  type PausedResponse,
  type RanResponse,
  type SteppedResponse,
  type TapeSnapshot,
  type WorkerRequest,
  type WorkerResponse,
} from './types.ts';

/**
 * Thrown when the worker rejected with `{ type: 'error' }`. Carries the
 * partial `tapes` snapshot from the worker (when present) so the main thread
 * can mirror the state where execution actually stuck — the alternative is
 * the user seeing the loaded tape with no record of the steps that ran.
 */
export class WorkerError extends Error {
  readonly tapes: TapeSnapshot[] | null;

  constructor(message: string, tapes: TapeSnapshot[] | null) {
    super(message);
    this.name = 'WorkerError';
    this.tapes = tapes;
  }
}

type SimplePending = {
  resolve: (data: WorkerResponse) => void;
  reject: (err: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

type RunPending = {
  resolveRan: (data: RanResponse) => void;
  reject: (err: Error) => void;
  timeoutId: ReturnType<typeof setTimeout> | null;
  onPaused: ((data: PausedResponse) => void) | null;
};

export class MachineRunner {
  readonly engine: Engine;
  private worker: Worker | null = null;
  private simplePending: SimplePending | null = null;
  private runPending: RunPending | null = null;

  constructor(engine: Engine) {
    this.engine = engine;
  }

  private rejectAll(err: Error): void {
    if (this.simplePending) {
      clearTimeout(this.simplePending.timeoutId);
      this.simplePending.reject(err);
      this.simplePending = null;
    }
    if (this.runPending) {
      if (this.runPending.timeoutId) clearTimeout(this.runPending.timeoutId);
      this.runPending.reject(err);
      this.runPending = null;
    }
  }

  private spawnWorker(): void {
    this.rejectAll(new Error('superseded by new worker'));
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.worker = new MachineWorker();
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.onMessage(e.data);
    this.worker.onerror = (e) => this.onWorkerError(e);
  }

  private startRunTimer(): void {
    if (!this.runPending) return;
    if (this.runPending.timeoutId) clearTimeout(this.runPending.timeoutId);
    this.runPending.timeoutId = setTimeout(() => {
      const p = this.runPending;
      this.runPending = null;
      if (this.worker) {
        this.worker.terminate();
        this.worker = null;
      }
      p?.reject(new Error(`timeout after ${WORKER_TIMEOUT_MS}ms — worker terminated (likely infinite loop)`));
    }, WORKER_TIMEOUT_MS);
  }

  private stopRunTimer(): void {
    if (!this.runPending) return;
    if (this.runPending.timeoutId) {
      clearTimeout(this.runPending.timeoutId);
      this.runPending.timeoutId = null;
    }
  }

  private onMessage(data: WorkerResponse): void {
    // `paused` is the only response that doesn't complete a Promise.
    if (data.type === 'paused') {
      if (!this.runPending) return;
      this.stopRunTimer();
      this.runPending.onPaused?.(data);
      return;
    }
    // ran / error complete the run; stepped / built complete a simple request.
    if (data.type === 'ran') {
      const p = this.runPending;
      this.runPending = null;
      if (!p) return;
      if (p.timeoutId) clearTimeout(p.timeoutId);
      p.resolveRan(data);
      return;
    }
    if (data.type === 'error') {
      const err = new WorkerError(data.message, data.tapes ?? null);
      if (this.runPending) {
        const p = this.runPending;
        this.runPending = null;
        if (p.timeoutId) clearTimeout(p.timeoutId);
        p.reject(err);
        return;
      }
      if (this.simplePending) {
        const p = this.simplePending;
        this.simplePending = null;
        clearTimeout(p.timeoutId);
        p.reject(err);
        return;
      }
      return;
    }
    // built / stepped
    if (this.simplePending) {
      const p = this.simplePending;
      this.simplePending = null;
      clearTimeout(p.timeoutId);
      p.resolve(data);
    }
  }

  private onWorkerError(e: ErrorEvent): void {
    this.rejectAll(new Error(`worker error: ${e.message ?? 'unknown'}`));
  }

  private sendSimple(msg: WorkerRequest): Promise<WorkerResponse> {
    if (!this.worker) throw new Error('worker not spawned — call build() first');
    if (this.simplePending || this.runPending) throw new Error('previous request still pending');

    return new Promise<WorkerResponse>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.simplePending = null;
        if (this.worker) {
          this.worker.terminate();
          this.worker = null;
        }
        reject(new Error(`timeout after ${WORKER_TIMEOUT_MS}ms — worker terminated (likely infinite loop)`));
      }, WORKER_TIMEOUT_MS);
      this.simplePending = { resolve, reject, timeoutId };
      this.worker!.postMessage(msg);
    });
  }

  async build(code: string): Promise<BuiltResponse> {
    this.spawnWorker();
    const r = await this.sendSimple({ type: 'build', engine: this.engine, code });
    if (r.type !== 'built') throw new Error(`unexpected response: ${r.type}`);
    return r;
  }

  async step(): Promise<SteppedResponse> {
    const r = await this.sendSimple({ type: 'step' });
    if (r.type !== 'stepped') throw new Error(`unexpected response: ${r.type}`);
    return r;
  }

  /**
   * Async run with optional break-pause support. Returns when the worker
   * sends `ran` (halt or stepsLimit). If `debug` is true and a break fires,
   * `onPaused` is called; the consumer must call `resume()` to continue.
   * The Promise stays pending across paused/resume cycles.
   */
  run(opts: {
    maxSteps?: number;
    debug?: boolean;
    onPaused?: (data: PausedResponse) => void;
  } = {}): Promise<RanResponse> {
    if (!this.worker) throw new Error('worker not spawned — call build() first');
    if (this.simplePending || this.runPending) throw new Error('previous request still pending');

    return new Promise<RanResponse>((resolveRan, reject) => {
      this.runPending = {
        resolveRan,
        reject,
        timeoutId: null,
        onPaused: opts.onPaused ?? null,
      };
      this.startRunTimer();
      this.worker!.postMessage({
        type: 'run',
        maxSteps: opts.maxSteps ?? MAX_STEPS,
        debug: opts.debug ?? false,
      });
    });
  }

  /** Send a `resume` to a paused worker. Reactivates the round-trip timer. */
  resume(step: boolean = false): void {
    if (!this.runPending) throw new Error('resume: no pending run');
    if (!this.worker) throw new Error('resume: worker terminated');
    this.startRunTimer();
    this.worker.postMessage({ type: 'resume', step });
  }

  /**
   * Flip the worker's debug-pause gate. Fire-and-forget. No-op if the worker
   * isn't spawned yet (the next `run()` will pass `debug` through the request).
   */
  setDebug(on: boolean): void {
    if (!this.worker) return;
    this.worker.postMessage({ type: 'setDebug', on });
  }

  terminate(): void {
    this.rejectAll(new Error('runner terminated'));
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
