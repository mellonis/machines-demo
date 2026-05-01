import MachineWorker from './worker.js?worker';

const DEFAULT_TIMEOUT_MS = 5000;

export class MachineRunner {
  constructor(mode) {
    this.mode = mode;
    this.worker = null;
    this.pending = null;
  }

  _spawnWorker() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.worker = new MachineWorker();
    this.worker.onmessage = (e) => this._onMessage(e.data);
    this.worker.onerror = (e) => this._onWorkerError(e);
  }

  _onMessage(data) {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    if (p.timer) clearTimeout(p.timer);
    if (data.type === 'error') {
      p.reject(new Error(data.message));
    } else {
      p.resolve(data);
    }
  }

  _onWorkerError(e) {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    if (p.timer) clearTimeout(p.timer);
    p.reject(new Error(`worker error: ${e.message ?? 'unknown'}`));
  }

  _send(msg, timeoutMs = DEFAULT_TIMEOUT_MS) {
    if (!this.worker) throw new Error('worker not spawned — call load() first');
    if (this.pending) throw new Error('previous request still pending');

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        this.worker.terminate();
        this.worker = null;
        reject(new Error(`timeout after ${timeoutMs}ms — worker terminated (likely infinite loop)`));
      }, timeoutMs);
      this.pending = { resolve, reject, timer };
      this.worker.postMessage(msg);
    });
  }

  async load(code) {
    this._spawnWorker();
    return this._send({ type: 'load', mode: this.mode, code });
  }

  async step() {
    return this._send({ type: 'step' });
  }

  async run(maxSteps = 100000, timeoutMs = DEFAULT_TIMEOUT_MS) {
    return this._send({ type: 'run', maxSteps }, timeoutMs);
  }

  terminate() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pending = null;
  }
}
