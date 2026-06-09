import type { MachineWorkerLike, WorkerFactory } from './machineRunner';
import type { WorkerRequest, WorkerResponse } from './types';
import { EditorState } from '@codemirror/state';
import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { javascript } from '@codemirror/lang-javascript';
import type { Engine } from './types.ts';
import { getSchema } from './completions/schema/index.ts';
import type { EngineSchema } from './completions/schema/types.ts';
import { localsField } from './completions/scan/locals.ts';
import { computeSignatureInfo } from './completions/hints/signature.ts';
import type { SignatureInfo } from './completions/hints/types.ts';
import type { Diagnostic } from '@codemirror/lint';
import { computeArgCountDiagnostics } from './completions/lint/argCount.ts';

/**
 * Test double for the Web Worker that `MachineRunner` posts to.
 *
 * - `postedMessages` captures every request sent by the runner.
 * - Tests trigger inbound messages via `respond(...)` and `errorEvent(...)`.
 * - Implements `MachineWorkerLike` structurally; can be passed wherever a
 *   real `Worker` is expected on the runner side.
 */
export class FakeWorker implements MachineWorkerLike {
  postedMessages: WorkerRequest[] = [];

  onmessage: ((e: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;

  terminated = false;

  postMessage(msg: WorkerRequest): void {
    if (this.terminated) throw new Error('postMessage on terminated worker');
    this.postedMessages.push(msg);
  }

  terminate(): void {
    this.terminated = true;
  }

  // -- Test helpers (not part of MachineWorkerLike) --

  respond(data: WorkerResponse): void {
    if (!this.onmessage) throw new Error('respond() before onmessage handler set');
    this.onmessage({ data } as MessageEvent<WorkerResponse>);
  }

  errorEvent(message: string): void {
    if (!this.onerror) throw new Error('errorEvent() before onerror handler set');
    this.onerror({ message } as ErrorEvent);
  }

  get last(): WorkerRequest | undefined {
    return this.postedMessages[this.postedMessages.length - 1];
  }
}

/**
 * Returns a factory that produces a fresh `FakeWorker` on each call, plus
 * accessors for the most recent fake (`current()`) and every fake produced
 * (`all()`). Mirrors `MachineRunner.spawnWorker` semantics: each `build()`
 * invokes the factory once.
 */
export function makeFakeFactory(): {
  factory: WorkerFactory;
  current: () => FakeWorker;
  all: () => FakeWorker[];
} {
  const fakes: FakeWorker[] = [];
  return {
    factory: () => {
      const fake = new FakeWorker();
      fakes.push(fake);
      return fake;
    },
    current: () => {
      const last = fakes[fakes.length - 1];
      if (!last) throw new Error('makeFakeFactory: factory not yet called');
      return last;
    },
    all: () => fakes.slice(),
  };
}

export type SourceEnv = { engine: Engine; schema: EngineSchema };
export type SourceFactory = (env: SourceEnv) => (ctx: CompletionContext) => CompletionResult | null;

export function completionAt(marked: string, engine: Engine, makeSource: SourceFactory): CompletionResult | null {
  const cursorPos = marked.indexOf('▮');
  if (cursorPos === -1) throw new Error('completionAt: source must contain ▮');
  const doc = marked.slice(0, cursorPos) + marked.slice(cursorPos + 1);
  const env: SourceEnv = { engine, schema: getSchema(engine) };
  const state = EditorState.create({
    doc,
    extensions: [javascript(), localsField],
    selection: { anchor: cursorPos },
  });
  const ctx = new CompletionContext(state, cursorPos, true);
  return makeSource(env)(ctx);
}

export function signatureAt(marked: string, engine: Engine): SignatureInfo | null {
  const cursorPos = marked.indexOf('▮');
  if (cursorPos === -1) throw new Error('signatureAt: source must contain ▮');
  const doc = marked.slice(0, cursorPos) + marked.slice(cursorPos + 1);
  const env: SourceEnv = { engine, schema: getSchema(engine) };
  const state = EditorState.create({
    doc,
    extensions: [javascript(), localsField],
    selection: { anchor: cursorPos },
  });
  return computeSignatureInfo(state, env);
}

export function lintAll(source: string, engine: Engine): Diagnostic[] {
  const env: SourceEnv = { engine, schema: getSchema(engine) };
  const state = EditorState.create({
    doc: source,
    extensions: [javascript(), localsField],
  });
  return computeArgCountDiagnostics(state, env);
}
