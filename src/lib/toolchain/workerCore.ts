// The toolchain worker's brain, kept free of `self` so it runs under Node in
// tests. Owns the wasm Program and at most one Session; drives it with pump
// calls per `docs/execution-model.md (toolchain engines)` and the session
// contract in the toolchains' `docs/wasm.md (sessions)`.
import type { Program, Session } from '$mtc';
import { PROGRESS_INTERVAL_MS, TOOLCHAIN_SLICE_BUDGET } from '../caps.ts';
import { buildLineMap } from './toolchainHelpers.ts';
import type { DriveMode, Lang, PauseCause, ToolchainRequest, ToolchainResponse } from './types.ts';

export type MtcModule = Pick<typeof import('$mtc'), 'Toolchain'>;

export type CoreDeps = {
  post: (r: ToolchainResponse) => void;
  sleep: (ms: number) => Promise<void>;
  /** Lets queued messages run between pump slices. */
  yieldTurn: () => Promise<void>;
  now: () => number;
};

export class ToolchainCore {
  private program: Program | null = null;
  private session: Session | null = null;
  private breakpoints = new Set<number>();
  private registered = new Set<number>();
  private debugOn = false;
  private stopRequested = false;
  private loopActive = false;
  private lastProgressAt = 0;
  /** Bumped every time `this.session` is dropped or replaced. A running
   *  `drive()` loop captures the value at entry and treats a mismatch as
   *  "the session I was pumping is gone" — it stops touching it rather than
   *  calling into a freed wasm object or finalising a session that isn't
   *  its own. */
  private generation = 0;

  constructor(private readonly mod: MtcModule, private readonly deps: CoreDeps) {}

  async handle(req: ToolchainRequest): Promise<void> {
    try {
      switch (req.type) {
        case 'build': return this.build(req.lang, req.code);
        case 'stdlib': return this.deps.post({ type: 'stdlibText', text: this.mod.Toolchain.stdlibSource(req.lang) });
        case 'check': return this.deps.post({ type: 'checked', diagnostics: this.mod.Toolchain.check(req.lang, req.code, undefined) });
        case 'format': {
          const r = this.mod.Toolchain.format(req.lang, req.code);
          return this.deps.post(r.ok ? { type: 'formatted', ok: true, text: r.text } : { type: 'formatted', ok: false, error: r.error });
        }
        case 'disassemble':
          if (!this.program) return this.deps.post({ type: 'error', message: 'disassemble: nothing built yet' });
          return this.deps.post({ type: 'disassembled', text: this.program.disassembly() });
        case 'decodeTapeBlock': {
          if (!this.program) return this.deps.post({ type: 'error', message: 'load tape block: nothing built yet' });
          const block = this.mod.Toolchain.decodeTapeBlock(req.bytes);
          return this.deps.post({ type: 'tapeBlockSeeds', seeds: this.program.seedsFromTapeBlock(block) });
        }
        case 'encodeTapeBlock':
          return this.deps.post({ type: 'tapeBlockBytes', bytes: this.mod.Toolchain.encodeTapeBlock({ tapes: req.tapes }) });
        // `await` here (not a bare `return this.start(req)`) is load-bearing:
        // inside a try, returning a promise directly does not route its
        // later rejection through this function's `catch` — the `await`
        // forces the rejection to surface while the try is still active.
        case 'start': return await this.start(req);
        case 'resume': return await this.drive(req.mode, req.intervalMs);
        case 'pause':
          this.session?.pause();
          return;
        case 'stop': return this.stop();
        case 'setBreakpoints':
          this.breakpoints = new Set(req.addrs);
          this.syncBreakpoints();
          return;
        case 'setDebug':
          this.debugOn = req.on;
          this.syncBreakpoints();
          return;
      }
    } catch (err) {
      // A Rust panic surfaces as a WebAssembly trap and leaves the module
      // unusable (`docs/wasm.md (failure modes)`); everything else is a
      // documented JsError from the binding.
      const fatal = err instanceof WebAssembly.RuntimeError;
      this.deps.post({ type: 'error', message: err instanceof Error ? err.message : String(err), ...(fatal ? { fatal: true } : {}) });
    }
  }

  private build(lang: Lang, code: string): void {
    this.dropSession();
    if (this.program) { this.program.free(); this.program = null; }
    const r = this.mod.Toolchain.build(lang, code, undefined);
    if (!r.ok) { this.deps.post({ type: 'built', ok: false, diagnostics: r.diagnostics }); return; }
    this.program = r.program;
    const stdLines = this.mod.Toolchain.stdlibSource(lang).split('\n').length;
    const lineMap = buildLineMap(r.program, code.split('\n').length, stdLines);
    this.deps.post({ type: 'built', ok: true, tapes: r.program.tapes(), diagnostics: r.diagnostics, lineMap });
  }

  private start(req: Extract<ToolchainRequest, { type: 'start' }>): Promise<void> {
    if (!this.program) { this.deps.post({ type: 'error', message: 'start: nothing built yet' }); return Promise.resolve(); }
    this.dropSession();
    const limits = req.limits.maxSteps === undefined ? undefined : { maxSteps: req.limits.maxSteps };
    this.session = this.program.session(req.seeds, limits);
    this.registered = new Set();
    this.breakpoints = new Set(req.breakpoints);
    this.stopRequested = false;
    this.lastProgressAt = 0;
    this.syncBreakpoints();
    return this.drive(req.mode, req.intervalMs);
  }

  /** Registers exactly `breakpoints` on the live session when debug is on, none when off. */
  private syncBreakpoints(): void {
    if (!this.session) return;
    const want = this.debugOn ? this.breakpoints : new Set<number>();
    for (const a of this.registered) if (!want.has(a)) this.session.removeBreakpoint(a);
    for (const a of want) if (!this.registered.has(a)) this.session.addBreakpoint(a);
    this.registered = new Set(want);
  }

  /** Clears `this.session` and invalidates any `drive()` loop still holding
   *  a reference to the incarnation it replaces. */
  private clearSession(): void {
    this.session = null;
    this.generation++;
  }

  private dropSession(): void {
    if (this.session) { try { this.session.free(); } catch { /* already stopped */ } }
    this.clearSession();
    this.loopActive = false;
  }

  /** No-op when the session is already gone — a stale `drive()` loop can
   *  race a `build`/`stop` here after its generation check already passed
   *  but before it reaches this call; tolerate it rather than dereferencing
   *  null. */
  private finish(): void {
    const s = this.session;
    if (!s) return;
    const result = s.finished()!;
    this.deps.post({ type: 'finished', result, snapshots: s.snapshots() });
    this.dropSession();
  }

  private stop(): void {
    if (!this.session) { this.deps.post({ type: 'error', message: 'stop: no run in progress' }); return; }
    if (this.loopActive) { this.stopRequested = true; return; } // the loop finalises after its slice
    this.finishStopped();
  }

  /** See `finish()` — tolerates an already-cleared session. */
  private finishStopped(): void {
    const s = this.session;
    if (!s) return;
    const snapshots = s.snapshots();
    const ip = s.ip;
    const stack = s.stack();
    const stats = s.stop();
    this.clearSession();
    this.loopActive = false;
    this.deps.post({ type: 'finished', result: { outcome: { kind: 'stopped' }, stats, ip, stack }, snapshots });
  }

  /** `brk` is a pause only while debug is on; breakpoints are never registered while it is off. */
  private isPauseHonoured(cause: PauseCause): boolean {
    if (cause === 'brk') return this.debugOn;
    return true;
  }

  private async drive(mode: DriveMode, intervalMs?: number): Promise<void> {
    const s = this.session;
    if (!s) { this.deps.post({ type: 'error', message: 'resume: no run in progress' }); return; }
    if (s.finished()) { this.finish(); return; }
    // Captured once: identifies the session incarnation this loop pumps.
    // A `build`/`start` that lands while we're awaiting below bumps
    // `generation` (via dropSession/clearSession) — every checkpoint below
    // re-reads it and bails out silently rather than touching `s`, which may
    // already be freed by then.
    const gen = this.generation;
    this.loopActive = true;
    try {
      if (mode === 'step') {
        const ev = s.pump(1);
        if (ev.kind === 'finished') { this.finish(); return; }
        if (ev.kind === 'deviceWait') throw new Error('deviceWait with owned devices');
        if (ev.kind === 'paused' && !this.isPauseHonoured(ev.cause)) {
          // An ignored brk retired like a no-op — count it as the step.
          this.deps.post({ type: 'stepped', snapshots: s.snapshots(), ip: s.ip, stats: s.stats(), retired: true });
          return;
        }
        const retired = ev.kind === 'budgetSpent' || (ev.kind === 'paused' && ev.cause === 'brk');
        this.deps.post({ type: 'stepped', snapshots: s.snapshots(), ip: s.ip, stats: s.stats(), retired });
        return;
      }
      for (;;) {
        if (this.generation !== gen) return; // superseded by a build/start — s may be freed
        if (this.stopRequested) { this.finishStopped(); return; }
        const budget = mode === 'auto' ? 1 : TOOLCHAIN_SLICE_BUDGET;
        const ev = s.pump(budget);
        if (ev.kind === 'finished') { this.finish(); return; }
        if (ev.kind === 'deviceWait') throw new Error('deviceWait with owned devices');
        if (ev.kind === 'paused') {
          if (this.isPauseHonoured(ev.cause)) {
            // A stop that lands in the same synchronous stretch as this
            // pump() call wins: finalise as stopped rather than reporting a
            // pause nobody is waiting to see.
            if (this.stopRequested) { this.finishStopped(); return; }
            this.deps.post({ type: 'paused', cause: ev.cause, ip: s.ip, snapshots: s.snapshots(), stats: s.stats() });
            return;
          }
          // ignored brk: fall through and keep going
        }
        if (mode === 'auto') {
          this.deps.post({ type: 'stepped', snapshots: s.snapshots(), ip: s.ip, stats: s.stats(), retired: true });
          this.deps.post({ type: 'idle' });
          await this.deps.sleep(intervalMs ?? 0);
          if (this.generation !== gen) return;
          this.deps.post({ type: 'busy' });
        } else {
          const t = this.deps.now();
          if (t - this.lastProgressAt >= PROGRESS_INTERVAL_MS) {
            this.lastProgressAt = t;
            this.deps.post({ type: 'progress', snapshots: s.snapshots(), steps: s.stats().steps, ip: s.ip });
          }
          await this.deps.yieldTurn();
          if (this.generation !== gen) return;
        }
      }
    } finally {
      this.loopActive = false;
    }
  }
}
