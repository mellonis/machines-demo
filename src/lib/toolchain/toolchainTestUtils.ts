import type { ToolchainWorkerFactory, ToolchainWorkerLike } from './toolchainRunner.ts';
import type { ToolchainRequest, ToolchainResponse } from './types.ts';

export class FakeToolchainWorker implements ToolchainWorkerLike {
  postedMessages: ToolchainRequest[] = [];
  onmessage: ((e: MessageEvent<ToolchainResponse>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  terminated = false;
  postMessage(msg: ToolchainRequest): void {
    if (this.terminated) throw new Error('postMessage on terminated worker');
    this.postedMessages.push(msg);
  }
  terminate(): void { this.terminated = true; }
  respond(data: ToolchainResponse): void {
    if (!this.onmessage) throw new Error('respond() before onmessage set');
    this.onmessage({ data } as MessageEvent<ToolchainResponse>);
  }
  get last(): ToolchainRequest | undefined { return this.postedMessages[this.postedMessages.length - 1]; }
}

export function makeFakeToolchainFactory(): { factory: ToolchainWorkerFactory; current: () => FakeToolchainWorker; all: () => FakeToolchainWorker[] } {
  const fakes: FakeToolchainWorker[] = [];
  return {
    factory: () => { const f = new FakeToolchainWorker(); fakes.push(f); return f; },
    current: () => { const l = fakes[fakes.length - 1]; if (!l) throw new Error('factory not yet called'); return l; },
    all: () => fakes.slice(),
  };
}
