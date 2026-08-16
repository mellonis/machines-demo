import { getSetting } from './settings.ts';
import {
  type BreakpointKind,
  type BreakpointToggledResponse,
  type BuiltResponse,
  type Engine,
  type IdleResponse,
  type PausedResponse,
  type RanResponse,
  type SteppedResponse,
  type WorkerRequest,
  type WorkerResponse,
} from './types.ts';
import type { TapeSnapshot } from '@turing-machine-js/visuals';

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

export interface MachineWorkerLike {
  postMessage(msg: WorkerRequest): void;
  terminate(): void;
  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
}

export type WorkerFactory = () => MachineWorkerLike;

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
  onIter: ((data: IdleResponse) => void) | null;
};

export class MachineRunner {
  readonly engine: Engine;
  private worker: MachineWorkerLike | null = null;
  private workerFactory: WorkerFactory;
  private simplePending: SimplePending | null = null;
  private runPending: RunPending | null = null;
  /**
   * Caller-set callback that fires whenever the worker echoes a
   * `breakpointToggled` response. The toggle
   * request itself is fire-and-forget on the runner side; the UI updates
   * its indicator state on receipt of this echo rather than awaiting a
   * Promise, because toggles can land mid-run (parallel to the run loop)
   * and shouldn't share the simple-pending or run-pending tracking lanes.
   */
  onBreakpointToggled: ((data: BreakpointToggledResponse) => void) | null = null;

  /**
   * Caller-set callback fired when the worker emits an `error` with no
   * pending operation to reject (fire-and-forget paths like
   * `toggleBreakpoint`, `setDebug`, `pause`). Without this, those
   * errors silently disappear at the runner — exactly what happened
   * with the haltState lockdown throw, which made the BP toggle look
   * dead from the UI's perspective. Set by MachineView to surface
   * them in the log panel.
   */
  onUncorrelatedError: ((message: string) => void) | null = null;

  constructor(engine: Engine, workerFactory: WorkerFactory) {
    this.engine = engine;
    this.workerFactory = workerFactory;
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
    this.worker = this.workerFactory();
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.onMessage(e.data);
    this.worker.onerror = (e) => this.onWorkerError(e);
  }

  private startRunTimer(): void {
    if (!this.runPending) return;
    if (this.runPending.timeoutId) clearTimeout(this.runPending.timeoutId);
    // Read at schedule time so a settings change applies from the next
    // request segment onward.
    const timeoutMs = getSetting('workerTimeoutMs');
    this.runPending.timeoutId = setTimeout(() => {
      const p = this.runPending;
      this.runPending = null;
      if (this.worker) {
        this.worker.terminate();
        this.worker = null;
      }
      p?.reject(new Error(`timeout after ${timeoutMs}ms — worker terminated (likely infinite loop)`));
    }, timeoutMs);
  }

  private stopRunTimer(): void {
    if (!this.runPending) return;
    if (this.runPending.timeoutId) {
      clearTimeout(this.runPending.timeoutId);
      this.runPending.timeoutId = null;
    }
  }

  private onMessage(data: WorkerResponse): void {
    // `paused` / `idle` / `busy` are run-channel notifications that don't
    // complete the run Promise. `paused` parks the run pending a `resume`;
    // `idle` / `busy` bracket each per-step throttle so the timer doesn't
    // fire while the worker is just waiting in setTimeout (intervals well
    // above WORKER_TIMEOUT_MS are a normal user choice).
    if (data.type === 'paused') {
      if (!this.runPending) return;
      this.stopRunTimer();
      this.runPending.onPaused?.(data);
      return;
    }
    if (data.type === 'idle') {
      if (!this.runPending) return;
      this.stopRunTimer();
      this.runPending.onIter?.(data);
      return;
    }
    if (data.type === 'busy') {
      if (!this.runPending) return;
      this.startRunTimer();
      return;
    }
    if (data.type === 'breakpointToggled') {
      // Side-channel echo — doesn't complete any pending Promise, just
      // signals the UI to update its indicator state. May arrive at any
      // point: between simple requests, mid-run, or while paused.
      this.onBreakpointToggled?.(data);
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
      // No pending op to reject — fire-and-forget requests
      // (toggleBreakpoint, setDebug, pause) land here when they throw
      // worker-side. Surface to the consumer so they aren't silent.
      this.onUncorrelatedError?.(data.message);
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
      const timeoutMs = getSetting('workerTimeoutMs');
      const timeoutId = setTimeout(() => {
        this.simplePending = null;
        if (this.worker) {
          this.worker.terminate();
          this.worker = null;
        }
        reject(new Error(`timeout after ${timeoutMs}ms — worker terminated (likely infinite loop)`));
      }, timeoutMs);
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
    /** When true the worker arms the initial state's `debug.after` so the run
     * pauses at iter 1's step-boundary — the cold-start path used by Step. */
    step?: boolean;
    /** Per-iteration throttle inside the worker's `onStep`. `null`/omitted =
     * continuous (no throttle); a positive number = ms between iters. The
     * worker brackets each throttle with `idle`/`busy` so the per-segment
     * timer suspends while the worker is just waiting. */
    intervalMs?: number | null;
    onPaused?: (data: PausedResponse) => void;
    /** Per-iter notification (RUNNING_AUTO throttle only — emitted on every
     * `idle` message). Carries the just-applied iter's commands so the main
     * thread can animate the belt, log the entry, and reflect on the panel
     * at the cadence. Not called in continuous runs (no `idle` sent). */
    onIter?: (data: IdleResponse) => void;
  } = {}): Promise<RanResponse> {
    if (!this.worker) throw new Error('worker not spawned — call build() first');
    if (this.simplePending || this.runPending) throw new Error('previous request still pending');

    return new Promise<RanResponse>((resolveRan, reject) => {
      this.runPending = {
        resolveRan,
        reject,
        timeoutId: null,
        onPaused: opts.onPaused ?? null,
        onIter: opts.onIter ?? null,
      };
      this.startRunTimer();
      this.worker!.postMessage({
        type: 'run',
        maxSteps: opts.maxSteps ?? getSetting('maxSteps'),
        debug: opts.debug ?? false,
        step: opts.step ?? false,
        intervalMs: opts.intervalMs ?? null,
      });
    });
  }

  /** Send a `resume` to a paused worker. Reactivates the round-trip timer.
   * `intervalMs` updates the worker's throttle policy — withPause is re-read
   * at Continue click time (spec §3), so the cold-start-Step → toggle-
   * withPause-on → Continue path must convey the new policy. Pass `null` to
   * drop the throttle, a positive number to set/replace it, or omit to keep
   * the previous policy unchanged (cold-start Step→Step keeps no-throttle). */
  resume(step: boolean = false, intervalMs?: number | null): void {
    if (!this.runPending) throw new Error('resume: no pending run');
    if (!this.worker) throw new Error('resume: worker terminated');
    this.startRunTimer();
    const msg: WorkerRequest = { type: 'resume', step };
    if (intervalMs !== undefined) msg.intervalMs = intervalMs;
    this.worker.postMessage(msg);
  }

  /** Click-pause from RUNNING_AUTO. Worker cancels the in-flight throttle and
   * dispatches a synthetic `paused` from inside its next `onStep`. No-op if
   * the worker isn't currently in a run; throws if the runner is idle. */
  pause(): void {
    if (!this.runPending) throw new Error('pause: no pending run');
    if (!this.worker) throw new Error('pause: worker terminated');
    this.worker.postMessage({ type: 'pause' });
  }

  /**
   * Flip the worker's debug-pause gate. Fire-and-forget. No-op if the worker
   * isn't spawned yet (the next `run()` will pass `debug` through the request).
   */
  setDebug(on: boolean): void {
    if (!this.worker) return;
    this.worker.postMessage({ type: 'setDebug', on });
  }

  /**
   * Toggle a `before` or `after` breakpoint on the State whose engine
   * `GraphNode.id` matches `stateId`. The OTHER kind's
   * current bit is preserved worker-side. Fire-and-forget; the worker
   * echoes a `breakpointToggled` response (with the same `kind`) which
   * routes to `onBreakpointToggled`. No-op if the worker hasn't been
   * built — the UI's context-menu handlers gate this anyway via the
   * `graph != null` check.
   */
  toggleBreakpoint(stateId: number, kind: BreakpointKind): void {
    if (!this.worker) return;
    this.worker.postMessage({ type: 'toggleBreakpoint', stateId, kind });
  }

  terminate(): void {
    this.rejectAll(new Error('runner terminated'));
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
  }
}
