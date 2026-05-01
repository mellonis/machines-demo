import MachineWorker from './worker.ts?worker';
import {
  MAX_STEPS,
  WORKER_TIMEOUT_MS,
  type Engine,
  type LoadedResponse,
  type RanResponse,
  type SteppedResponse,
  type WorkerRequest,
  type WorkerResponse,
} from './types.ts';

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
    // B2: an in-flight request must be rejected before we tear down the worker,
    //     otherwise its timer fires later and corrupts state for the next request.
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
      p.reject(new Error(data.message));
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
    if (!this.worker) throw new Error('worker not spawned — call load() first');
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

  async load(code: string): Promise<LoadedResponse> {
    this.spawnWorker();
    const r = await this.send({ type: 'load', engine: this.engine, code });
    if (r.type !== 'loaded') throw new Error(`unexpected response: ${r.type}`);
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
