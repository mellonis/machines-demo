import MachineWorker from './machineWorker.ts?worker';
import { MAX_STEPS, WORKER_TIMEOUT_MS } from './caps.ts';
import {
  type BuiltResponse,
  type Engine,
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

type Pending = {
  resolve: (data: WorkerResponse) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class MachineRunner {
  readonly engine: Engine;
  private worker: Worker | null = null;
  private pending: Pending | null = null;

  constructor(engine: Engine) {
    this.engine = engine;
  }

  private rejectPending(err: Error): void {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending.reject(err);
    this.pending = null;
  }

  private spawnWorker(): void {
    // Reject any in-flight request before tearing down the worker. Without
    // this, the pending request's timeout would survive the worker swap and
    // fire later — clearing `this.pending` and rejecting whatever new request
    // had taken its slot.
    this.rejectPending(new Error('superseded by new worker'));
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.worker = new MachineWorker();
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.onMessage(e.data);
    this.worker.onerror = (e) => this.onWorkerError(e);
  }

  private onMessage(data: WorkerResponse): void {
    if (!this.pending) return;
    const p = this.pending;
    this.pending = null;
    clearTimeout(p.timer);
    if (data.type === 'error') {
      p.reject(new WorkerError(data.message, data.tapes ?? null));
    } else {
      p.resolve(data);
    }
  }

  private onWorkerError(e: ErrorEvent): void {
    if (!this.pending) return;
    const p = this.pending;
    this.pending = null;
    clearTimeout(p.timer);
    p.reject(new Error(`worker error: ${e.message ?? 'unknown'}`));
  }

  private send(msg: WorkerRequest, timeoutMs: number = WORKER_TIMEOUT_MS): Promise<WorkerResponse> {
    if (!this.worker) throw new Error('worker not spawned — call build() first');
    if (this.pending) throw new Error('previous request still pending');

    return new Promise<WorkerResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        if (this.worker) {
          this.worker.terminate();
          this.worker = null;
        }
        reject(new Error(`timeout after ${timeoutMs}ms — worker terminated (likely infinite loop)`));
      }, timeoutMs);
      this.pending = { resolve, reject, timer };
      this.worker!.postMessage(msg);
    });
  }

  async build(code: string): Promise<BuiltResponse> {
    this.spawnWorker();
    const r = await this.send({ type: 'build', engine: this.engine, code });
    if (r.type !== 'built') throw new Error(`unexpected response: ${r.type}`);
    return r;
  }

  async step(): Promise<SteppedResponse> {
    const r = await this.send({ type: 'step' });
    if (r.type !== 'stepped') throw new Error(`unexpected response: ${r.type}`);
    return r;
  }

  async run(maxSteps: number = MAX_STEPS): Promise<RanResponse> {
    const r = await this.send({ type: 'run', maxSteps });
    if (r.type !== 'ran') throw new Error(`unexpected response: ${r.type}`);
    return r;
  }

  terminate(): void {
    this.rejectPending(new Error('runner terminated'));
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
