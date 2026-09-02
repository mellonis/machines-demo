// The toolchain worker's brain, kept free of `self` so it runs under Node in
// tests. Owns the wasm Program and at most one Session; drives it with pump
// calls per `docs/execution-model.md (toolchain engines)` and the session
// contract in the toolchains' `docs/wasm.md (sessions)`.
import type { Program, Session } from '$mtc';
import { PROGRESS_INTERVAL_MS, TOOLCHAIN_SLICE_BUDGET } from '../caps.ts';
import { buildLineMap, positionKey } from './toolchainHelpers.ts';
import type { DriveMode, Lang, LineMap, PauseCause, ToolchainRequest, ToolchainResponse } from './types.ts';

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
  /** The current program's address → source map, kept so a Step can tell
   *  where one source position ends and the next begins. */
  private lineMap: LineMap | null = null;
  private session: Session | null = null;
  private breakpoints = new Set<number>();
  private registered = new Set<number>();
  private debugOn = false;
  private stopRequested = false;
  private loopActive = false;
  private lastProgressAt = 0;
  /** Set while the auto loop is parked in its interval; calling it ends the
   *  wait immediately (see `sleepInterval`). Null at every other moment. */
  private wake: (() => void) | null = null;
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
          this.wake?.();
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
    this.lineMap = null;
    const r = this.mod.Toolchain.build(lang, code, undefined);
    if (!r.ok) { this.deps.post({ type: 'built', ok: false, diagnostics: r.diagnostics }); return; }
    this.program = r.program;
    const stdLines = this.mod.Toolchain.stdlibSource(lang).split('\n').length;
    const lineMap = buildLineMap(r.program, code.split('\n').length, stdLines);
    this.lineMap = lineMap;
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

  /** Silent when there is nothing to stop, like `pause`: Stop can land just
   *  after the run finished on its own, and an error nobody asked for would
   *  surface on the main thread as an uncorrelated failure. */
  private stop(): void {
    if (!this.session) return;
    if (this.loopActive) { this.stopRequested = true; this.wake?.(); return; } // the loop finalises after its slice
    this.finishStopped();
  }

  /** The auto-mode interval, cut short by a `pause` / `stop` that arrives
   *  while it is running. Waiting the interval out would make both actions
   *  look dead for as long as the user configured (intervals go up to
   *  minutes), and would let a Stop outlive the main thread's watchdog. */
  private sleepInterval(ms: number): Promise<void> {
    // Only clear `wake` if it is still ours: an abandoned loop's real sleep
    // can resolve long after a newer loop parked, and clearing that one's
    // resolver would leave its Pause / Stop with nothing to call.
    let mine: (() => void) | null = null;
    return Promise.race([
      this.deps.sleep(ms),
      new Promise<void>((resolve) => { this.wake = mine = resolve; }),
    ]).finally(() => { if (this.wake === mine) this.wake = null; });
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

  /** The source position of `ip` under the current program's line map — the
   *  unit a Step advances by. `null` when nothing resolves (no map, or an
   *  address with no line), which every comparison treats as a change. */
  private positionAt(ip: number): string | null {
    return this.lineMap ? positionKey(this.lineMap, ip) : null;
  }

  /**
   * One source-level step: instructions retire, one `pump(1)` at a time,
   * until the resolved `(file, function, line)` position differs from the
   * one the step began at — the line granularity of the toolchains' debug
   * adapter (their `docs/dap.md`, stepping granularity). A breakpoint, an
   * honoured `debugger`, a manual pause or the program ending partway
   * interrupts the step and reports that event instead.
   *
   * Returns the `retired` flag for the caller's `stepped` response, or
   * `null` when this call already finalised the segment — it posted
   * `finished` / `paused`, or the loop was stopped or superseded and there
   * is nothing left to post.
   */
  private sourceStep(s: Session, gen: number): boolean | null {
    const start = this.positionAt(s.ip);
    let retired = 0;
    for (;;) {
      if (this.generation !== gen) return null; // superseded by a build/start — s may be freed
      if (this.stopRequested) { this.finishStopped(); return null; }
      const ev = s.pump(1);
      if (ev.kind === 'finished') { this.finish(); return null; }
      if (ev.kind === 'deviceWait') throw new Error('deviceWait with owned devices');
      if (ev.kind === 'paused') {
        // `brk` is the one cause whose instruction has already retired; every
        // other pause fires *before* the instruction at the ip.
        if (ev.cause === 'brk') retired++;
        if (this.isPauseHonoured(ev.cause)) {
          // A breakpoint met with nothing retired means the session was
          // already sitting on it, not that the step ran into one: report the
          // step as the no-op it was, which is what `retired: false` has
          // always meant here. Every other cause — a manual pause above all —
          // is a pause wherever in the step it lands.
          if (retired === 0 && typeof ev.cause === 'object' && 'breakpoint' in ev.cause) return false;
          // A stop that lands in the same synchronous stretch as this pump()
          // wins, exactly as in the continuous loop.
          if (this.stopRequested) { this.finishStopped(); return null; }
          this.deps.post({ type: 'paused', cause: ev.cause, ip: s.ip, snapshots: s.snapshots(), stats: s.stats() });
          return null;
        }
        // an ignored brk retired like a no-op: keep stepping
      } else {
        retired++;
      }
      // The cap is the runaway guard: a source line that jumps to itself
      // would otherwise pump forever inside one Step and hang the UI.
      if (retired >= TOOLCHAIN_SLICE_BUDGET) return true;
      const now = this.positionAt(s.ip);
      if (now === null || now !== start) return true;
    }
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
        const retired = this.sourceStep(s, gen);
        if (retired !== null) this.deps.post({ type: 'stepped', snapshots: s.snapshots(), ip: s.ip, stats: s.stats(), retired });
        return;
      }
      for (;;) {
        if (this.generation !== gen) return; // superseded by a build/start — s may be freed
        if (this.stopRequested) { this.finishStopped(); return; }
        if (mode === 'auto') {
          // One *source* step per interval — the same unit the Step button
          // advances by, so an auto run reads like held-down Step.
          const retired = this.sourceStep(s, gen);
          if (retired === null) return;
          this.deps.post({ type: 'stepped', snapshots: s.snapshots(), ip: s.ip, stats: s.stats(), retired });
          this.deps.post({ type: 'idle' });
          await this.sleepInterval(intervalMs ?? 0);
          if (this.generation !== gen) return;
          // A stop that woke the interval finalises here rather than at the
          // top of the loop, so the main thread never sees a `busy` (and the
          // watchdog it re-arms) for a run that is already over. A pause
          // falls through: the engine's armed pause fires at the next
          // instruction boundary, which is what ends the segment.
          if (this.stopRequested) { this.finishStopped(); return; }
          this.deps.post({ type: 'busy' });
          continue;
        }
        const ev = s.pump(TOOLCHAIN_SLICE_BUDGET);
        if (ev.kind === 'finished') { this.finish(); return; }
        if (ev.kind === 'deviceWait') throw new Error('deviceWait with owned devices');
        if (ev.kind === 'paused' && this.isPauseHonoured(ev.cause)) {
          // A stop that lands in the same synchronous stretch as this
          // pump() call wins: finalise as stopped rather than reporting a
          // pause nobody is waiting to see.
          if (this.stopRequested) { this.finishStopped(); return; }
          this.deps.post({ type: 'paused', cause: ev.cause, ip: s.ip, snapshots: s.snapshots(), stats: s.stats() });
          return;
        }
        // an ignored brk falls through and keeps going
        const t = this.deps.now();
        if (t - this.lastProgressAt >= PROGRESS_INTERVAL_MS) {
          this.lastProgressAt = t;
          this.deps.post({ type: 'progress', snapshots: s.snapshots(), steps: s.stats().steps, ip: s.ip });
        }
        await this.deps.yieldTurn();
        if (this.generation !== gen) return;
      }
    } finally {
      this.loopActive = false;
    }
  }
}
