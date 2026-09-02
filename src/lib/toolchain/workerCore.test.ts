import { describe, expect, it } from 'vitest';
import { loadMtcForTests } from './testModule.ts';
import { ToolchainCore, type CoreDeps, type MtcModule } from './workerCore.ts';
import type { Program, RunStats, Session } from '$mtc';
import type { ToolchainRequest, ToolchainResponse } from './types.ts';

const PMC_INC = 'main() {\n    1: right(2);\n    2: check(1, 3);\n    3: mark(4);\n    4: left(5);\n    5: check(4, 6);\n    6: right(!);\n}\n';
const PMC_BRK = 'main() {\n    right;\n    debugger;\n    mark;\n}\n';
const TMC_REPLACE_B = "alphabet ab { '_', 'a', 'b' }\n\nmachine {\n  tape main: ab;\n\n  entry state scan {\n    ['b'] -> write ['a'] move [>] goto scan;\n    ['a'] ->             move [>] goto scan;\n    ['_'] -> stop;\n  }\n}\n";

type Harness = { core: ToolchainCore; posted: ToolchainResponse[]; send: (r: ToolchainRequest) => Promise<void>; sleeps: number[] };

async function harness(): Promise<Harness> {
  const mod = await loadMtcForTests();
  const posted: ToolchainResponse[] = [];
  const sleeps: number[] = [];
  const deps: CoreDeps = {
    post: (r) => posted.push(r),
    sleep: async (ms) => { sleeps.push(ms); },
    yieldTurn: async () => {},
    now: () => Date.now(),
  };
  const core = new ToolchainCore(mod, deps);
  return { core, posted, sleeps, send: (r) => core.handle(r) };
}

const last = (h: Pick<Harness, 'posted'>) => h.posted[h.posted.length - 1];
const ofType = <T extends ToolchainResponse['type']>(h: Pick<Harness, 'posted'>, t: T) =>
  h.posted.filter((r) => r.type === t) as Extract<ToolchainResponse, { type: T }>[];

// Minimal Session/Program/Toolchain fakes for the failure-mode tests below,
// where we need to control exactly what `pump()` returns/throws — the real
// module has no way to force a panic or a `deviceWait` on demand.
function fakeStats(): RunStats {
  return { steps: 0, coreTacts: 0, stallTacts: 0, totalTacts: 0 };
}

function fakeSession(overrides: Partial<Session> = {}): Session {
  return {
    free: () => {},
    addBreakpoint: () => {},
    removeBreakpoint: () => {},
    finished: () => null,
    pause: () => {},
    pump: () => ({ kind: 'budgetSpent' }),
    snapshot: () => ({ band: 0, name: 't', glyphs: [], origin: 0, cells: new Uint8Array(), head: 0 }),
    snapshots: () => [],
    stack: () => [],
    stats: fakeStats,
    stop: fakeStats,
    depth: 0,
    fr: 0,
    ip: 0,
    mf: false,
    ...overrides,
  } as unknown as Session;
}

function fakeProgram(session: Session): Program {
  return {
    free: () => {},
    addressForLine: () => undefined,
    bytes: () => new Uint8Array(),
    disassembly: () => '',
    lineOf: () => null,
    listing: () => [],
    mapJson: () => '{}',
    seedsFromTapeBlock: () => [],
    session: () => session,
    tapes: () => [],
  } as unknown as Program;
}

function fakeModule(program: Program): MtcModule {
  return {
    Toolchain: {
      build: () => ({ ok: true, program, diagnostics: [] }),
      check: () => [],
      decodeTapeBlock: () => ({ alphabet: [], tapes: [] }),
      encodeTapeBlock: () => new Uint8Array(),
      format: () => ({ ok: true, text: '' }),
      stdlibSource: () => '',
    },
  } as unknown as MtcModule;
}

function panicModule(): MtcModule {
  return {
    Toolchain: {
      build: () => { throw new WebAssembly.RuntimeError('unreachable'); },
      check: () => [],
      decodeTapeBlock: () => ({ alphabet: [], tapes: [] }),
      encodeTapeBlock: () => new Uint8Array(),
      format: () => ({ ok: true, text: '' }),
      stdlibSource: () => '',
    },
  } as unknown as MtcModule;
}

function bareHarness(mod: MtcModule): Omit<Harness, 'sleeps'> {
  const posted: ToolchainResponse[] = [];
  const deps: CoreDeps = { post: (r) => posted.push(r), sleep: async () => {}, yieldTurn: async () => {}, now: () => 0 };
  const core = new ToolchainCore(mod, deps);
  return { core, posted, send: (r) => core.handle(r) };
}

describe('build / simple requests', () => {
  it('T-core-build-ok: built carries tapes, warnings and a line map', async () => {
    const h = await harness();
    await h.send({ type: 'build', lang: 'pmc', code: PMC_INC });
    const b = last(h);
    expect(b.type).toBe('built');
    if (b.type === 'built' && b.ok) {
      expect(b.tapes).toEqual([{ name: 'tape', glyphs: [' ', '*'] }]);
      expect(b.lineMap.userLineToAddr[2]).not.toBeNull();
    } else throw new Error('expected ok build');
  });

  it('T-core-build-fatal: a syntax error is built ok:false with one error diagnostic', async () => {
    const h = await harness();
    await h.send({ type: 'build', lang: 'pmc', code: 'main() { nope' });
    const b = last(h);
    expect(b.type === 'built' && !b.ok && b.diagnostics.some((d) => d.severity === 'error')).toBe(true);
  });

  it('T-core-stdlib-check-format: stdlib text, lint channel and format answer', async () => {
    const h = await harness();
    await h.send({ type: 'stdlib', lang: 'tmc' });
    expect(last(h).type).toBe('stdlibText');
    await h.send({ type: 'check', lang: 'pmc', code: 'namespace api {\nhelper() {\n5: right;\n}\n}\nmain() { @api::helper(); }\n' });
    const c = last(h);
    expect(c.type === 'checked' && c.diagnostics.some((d) => d.code === 'unused-label')).toBe(true);
    await h.send({ type: 'format', lang: 'pmc', code: 'main() {  right;   mark; }\n' });
    expect(last(h).type === 'formatted' && (last(h) as { ok: boolean }).ok).toBe(true);
  });

  it('T-core-disassemble-roundtrip: disassembly of a source build assembles to the same bytes', async () => {
    const h = await harness();
    await h.send({ type: 'build', lang: 'tmc', code: TMC_REPLACE_B });
    await h.send({ type: 'disassemble' });
    const d = last(h);
    expect(d.type).toBe('disassembled');
    const mod = await loadMtcForTests();
    const again = mod.Toolchain.build('tma', (d as { text: string }).text, undefined);
    expect(again.ok).toBe(true);
    if (again.ok) again.program.free();
  });

  it('T-core-disassemble-without-build: error, not fatal', async () => {
    const h = await harness();
    await h.send({ type: 'disassemble' });
    expect(last(h)).toEqual({ type: 'error', message: 'disassemble: nothing built yet' });
  });
});

describe('pump loops', () => {
  it('T-pump-step: step mode retires one instruction per start/resume and reports snapshots + ip', async () => {
    const h = await harness();
    await h.send({ type: 'build', lang: 'pmc', code: PMC_INC });
    await h.send({ type: 'start', seeds: [{ cells: [1, 1, 1], head: 0 }], limits: {}, breakpoints: [], mode: 'step' });
    const s1 = ofType(h, 'stepped')[0];
    expect(s1.retired).toBe(true);
    expect(s1.stats.steps).toBe(1);
    await h.send({ type: 'resume', mode: 'step' });
    expect(ofType(h, 'stepped')[1].stats.steps).toBe(2);
  });

  it('T-pump-step-to-finish: stepping past the last instruction posts finished with the final snapshots', async () => {
    const h = await harness();
    await h.send({ type: 'build', lang: 'pmc', code: 'main() {\n    mark(!);\n}\n' });
    await h.send({ type: 'start', seeds: [], limits: {}, breakpoints: [], mode: 'step' });
    for (let i = 0; i < 10 && ofType(h, 'finished').length === 0; i++) await h.send({ type: 'resume', mode: 'step' });
    const f = ofType(h, 'finished')[0];
    expect(f.result.outcome.kind).toBe('stopped');
    expect(Array.from(f.snapshots[0].cells)).toEqual([1]);
  });

  it('T-pump-continuous-finished: continuous runs to the end and posts finished', async () => {
    const h = await harness();
    await h.send({ type: 'build', lang: 'tmc', code: TMC_REPLACE_B });
    await h.send({ type: 'start', seeds: [{ cells: [2, 2, 2] }], limits: {}, breakpoints: [], mode: 'continuous' });
    const f = ofType(h, 'finished')[0];
    expect(f.result.outcome.kind).toBe('stopped');
    expect(Array.from(f.snapshots[0].cells.slice(0, 3))).toEqual([1, 1, 1]);
  });

  it('T-pump-step-limit: maxSteps traps as step-limit inside finished', async () => {
    const h = await harness();
    await h.send({ type: 'build', lang: 'tmc', code: TMC_REPLACE_B });
    await h.send({ type: 'start', seeds: [{ cells: [2, 2, 2, 2, 2, 2] }], limits: { maxSteps: 2 }, breakpoints: [], mode: 'continuous' });
    const f = ofType(h, 'finished')[0];
    expect(f.result.outcome.kind).toBe('trapped');
    expect(f.result.outcome.kind === 'trapped' && f.result.outcome.trap.kind).toBe('step-limit');
  });

  it('T-pump-breakpoint: a registered breakpoint pauses before its instruction; the next step retires it', async () => {
    const h = await harness();
    await h.send({ type: 'build', lang: 'pmc', code: PMC_INC });
    const b = ofType(h, 'built')[0];
    const addr = b.ok ? b.lineMap.userLineToAddr[4]! : -1; // `3: mark(4);`
    await h.send({ type: 'setDebug', on: true });
    await h.send({ type: 'start', seeds: [{ cells: [1, 1, 1], head: 0 }], limits: {}, breakpoints: [addr], mode: 'continuous' });
    const p = ofType(h, 'paused')[0];
    expect(p.cause).toEqual({ breakpoint: addr });
    expect(p.ip).toBe(addr);
    await h.send({ type: 'resume', mode: 'step' });
    const s = ofType(h, 'stepped')[0];
    expect(s.retired).toBe(true);
    expect(s.ip).not.toBe(addr);
  });

  it('T-pump-breakpoint-debug-off: with debug off the same run does not pause', async () => {
    const h = await harness();
    await h.send({ type: 'build', lang: 'pmc', code: PMC_INC });
    const b = ofType(h, 'built')[0];
    const addr = b.ok ? b.lineMap.userLineToAddr[4]! : -1;
    await h.send({ type: 'setDebug', on: false });
    await h.send({ type: 'start', seeds: [{ cells: [1, 1, 1], head: 0 }], limits: {}, breakpoints: [addr], mode: 'continuous' });
    expect(ofType(h, 'paused')).toHaveLength(0);
    expect(ofType(h, 'finished')).toHaveLength(1);
  });

  it('T-pump-brk: a retired `debugger` pauses with cause brk when debug is on and is ignored when off', async () => {
    const on = await harness();
    await on.send({ type: 'build', lang: 'pmc', code: PMC_BRK });
    await on.send({ type: 'setDebug', on: true });
    await on.send({ type: 'start', seeds: [], limits: {}, breakpoints: [], mode: 'continuous' });
    expect(ofType(on, 'paused')[0]?.cause).toBe('brk');
    const off = await harness();
    await off.send({ type: 'build', lang: 'pmc', code: PMC_BRK });
    await off.send({ type: 'start', seeds: [], limits: {}, breakpoints: [], mode: 'continuous' });
    expect(ofType(off, 'paused')).toHaveLength(0);
    expect(ofType(off, 'finished')).toHaveLength(1);
  });

  it('T-pump-manual-pause: pause during an auto run ends the segment with cause manual', async () => {
    const h = await harness();
    await h.send({ type: 'build', lang: 'tmc', code: TMC_REPLACE_B });
    // sleep is instrumented: request the pause from inside the first sleep.
    let armed = false;
    const origSleep = (h.core as unknown as { deps: CoreDeps }).deps.sleep;
    (h.core as unknown as { deps: CoreDeps }).deps.sleep = async (ms) => {
      await origSleep(ms);
      if (!armed) { armed = true; await h.send({ type: 'pause' }); }
    };
    await h.send({ type: 'start', seeds: [{ cells: [2, 2, 2, 2, 2, 2, 2, 2] }], limits: {}, breakpoints: [], mode: 'auto', intervalMs: 50 });
    expect(ofType(h, 'paused')[0]?.cause).toBe('manual');
    expect(ofType(h, 'idle').length).toBeGreaterThan(0);
    expect(h.sleeps[0]).toBe(50);
  });

  it('T-pump-stop: stop while paused posts finished { stopped } with snapshots', async () => {
    const h = await harness();
    await h.send({ type: 'build', lang: 'pmc', code: PMC_INC });
    await h.send({ type: 'start', seeds: [{ cells: [1, 1, 1], head: 0 }], limits: {}, breakpoints: [], mode: 'step' });
    await h.send({ type: 'stop' });
    const f = ofType(h, 'finished')[0];
    expect(f.result.outcome.kind).toBe('stopped');
    expect(f.snapshots).toHaveLength(1);
  });

  it('T-pump-progress: a continuous run posts progress when the gate opens', async () => {
    const h = await harness();
    // now() jumps by a second on every call so the time gate is always open.
    let t = 0;
    (h.core as unknown as { deps: CoreDeps }).deps.now = () => (t += 1000);
    await h.send({ type: 'build', lang: 'tmc', code: TMC_REPLACE_B });
    await h.send({ type: 'start', seeds: [{ cells: new Array(60_000).fill(2) }], limits: {}, breakpoints: [], mode: 'continuous' });
    expect(ofType(h, 'progress').length).toBeGreaterThan(0);
    expect(ofType(h, 'finished')).toHaveLength(1);
  });

  it('T-pump-std-bp: a breakpoint planted on a stdlib line pauses with the ip in the std file', async () => {
    const h = await harness();
    await h.send({ type: 'build', lang: 'pmc', code: 'main() {\n    @std::goToEnd();\n    mark;\n}\n' });
    const b = ofType(h, 'built')[0];
    if (!b.ok) throw new Error('build failed');
    const stdLine = b.lineMap.stdLineToAddr.findIndex((a) => a !== null);
    const addr = b.lineMap.stdLineToAddr[stdLine]!;
    await h.send({ type: 'setDebug', on: true });
    await h.send({ type: 'start', seeds: [{ cells: [1, 1] }], limits: {}, breakpoints: [addr], mode: 'continuous' });
    const p = ofType(h, 'paused')[0];
    expect(p.cause).toEqual({ breakpoint: addr });
    expect(b.lineMap.addrToLoc.find((l) => l.addr === p.ip)?.file).toBe('std');
  });

  it('T-pump-tapeblock: decode → seedsFromTapeBlock and encode round-trip through the core', async () => {
    const h = await harness();
    await h.send({ type: 'build', lang: 'tmc', code: TMC_REPLACE_B });
    await h.send({ type: 'encodeTapeBlock', tapes: [{ cells: [2, 1, 2], head: 0, origin: 0, glyphs: ['_', 'a', 'b'] }] });
    const enc = last(h);
    expect(enc.type).toBe('tapeBlockBytes');
    await h.send({ type: 'decodeTapeBlock', bytes: (enc as { bytes: Uint8Array }).bytes });
    const dec = last(h);
    expect(dec.type === 'tapeBlockSeeds' && Array.from(dec.seeds[0].cells)).toEqual([2, 1, 2]);
    await h.send({ type: 'encodeTapeBlock', tapes: [{ cells: [1], glyphs: ['_', 'x'] }] });
    const bad = last(h);
    expect(bad.type).toBe('tapeBlockBytes'); // encoding is alphabet-agnostic…
    await h.send({ type: 'decodeTapeBlock', bytes: (bad as { bytes: Uint8Array }).bytes });
    expect(last(h).type).toBe('error');      // …mapping onto this program is not
    expect((last(h) as { message: string }).message).toMatch(/`x`/);
  });
});

describe('failure modes and cancellation', () => {
  it('T-core-panic-fatal: a wasm panic surfaces as a fatal error, both on build and mid-run', async () => {
    // Build-path panic.
    const buildBoom = bareHarness(panicModule());
    await buildBoom.send({ type: 'build', lang: 'pmc', code: 'main() {}' });
    expect(buildBoom.posted).toEqual([{ type: 'error', message: 'unreachable', fatal: true }]);

    // Run-path panic: build succeeds, but the session's pump() panics. Before
    // the fix, `case 'start': return this.start(req);` let this rejection
    // escape `handle()`'s catch entirely (a `try { return promise }` does not
    // route a later rejection through the catch) — nothing would be posted.
    const session = fakeSession({ pump: () => { throw new WebAssembly.RuntimeError('unreachable'); } });
    const runBoom = bareHarness(fakeModule(fakeProgram(session)));
    await runBoom.send({ type: 'build', lang: 'pmc', code: 'main() {}' });
    await runBoom.send({ type: 'start', seeds: [], limits: {}, breakpoints: [], mode: 'continuous' });
    expect(last(runBoom)).toEqual({ type: 'error', message: 'unreachable', fatal: true });
  });

  it('T-core-devicewait-error: a deviceWait pump result is a plain (non-fatal) error', async () => {
    const session = fakeSession({ pump: () => ({ kind: 'deviceWait' }) });
    const h = bareHarness(fakeModule(fakeProgram(session)));
    await h.send({ type: 'build', lang: 'pmc', code: 'main() {}' });
    await h.send({ type: 'start', seeds: [], limits: {}, breakpoints: [], mode: 'continuous' });
    const l = last(h);
    expect(l.type).toBe('error');
    expect((l as { fatal?: boolean }).fatal).toBeUndefined();
    expect((l as { message: string }).message).toMatch(/deviceWait/);
  });

  it('T-core-start-without-build: start before any build is a plain error', async () => {
    const h = await harness();
    await h.send({ type: 'start', seeds: [], limits: {}, breakpoints: [], mode: 'step' });
    expect(last(h)).toEqual({ type: 'error', message: 'start: nothing built yet' });
  });

  it('T-core-setbreakpoints-live: setBreakpoints on a live session registers immediately when debug is on', async () => {
    const h = await harness();
    await h.send({ type: 'build', lang: 'pmc', code: PMC_INC });
    const b = ofType(h, 'built')[0];
    const addr = b.ok ? b.lineMap.userLineToAddr[4]! : -1; // `3: mark(4);`
    await h.send({ type: 'start', seeds: [{ cells: [1, 1, 1], head: 0 }], limits: {}, breakpoints: [], mode: 'step' });
    await h.send({ type: 'setDebug', on: true });
    await h.send({ type: 'setBreakpoints', addrs: [addr] });
    await h.send({ type: 'resume', mode: 'continuous' });
    const p = ofType(h, 'paused')[0];
    expect(p.cause).toEqual({ breakpoint: addr });
    expect(p.ip).toBe(addr);
  });

  it('T-pump-stop-during-loop: stop requested during a yield finalises the loop with exactly one finished', async () => {
    const h = await harness();
    await h.send({ type: 'build', lang: 'tmc', code: TMC_REPLACE_B });
    let armed = false;
    const origYield = (h.core as unknown as { deps: CoreDeps }).deps.yieldTurn;
    (h.core as unknown as { deps: CoreDeps }).deps.yieldTurn = async () => {
      await origYield();
      if (!armed) { armed = true; await h.send({ type: 'stop' }); }
    };
    await h.send({ type: 'start', seeds: [{ cells: new Array(60_000).fill(2) }], limits: {}, breakpoints: [], mode: 'continuous' });
    const finished = ofType(h, 'finished');
    expect(finished).toHaveLength(1);
    expect(finished[0].result.outcome.kind).toBe('stopped');
    expect(ofType(h, 'paused')).toHaveLength(0);
    const finishedAt = h.posted.indexOf(finished[0]);
    expect(h.posted.slice(finishedAt + 1).some((r) => r.type === 'progress' || r.type === 'paused')).toBe(false);
  });

  it('T-pump-stop-then-build-during-loop: stop then build back-to-back during a yield does not throw; the build wins', async () => {
    const h = await harness();
    await h.send({ type: 'build', lang: 'tmc', code: TMC_REPLACE_B });
    let armed = false;
    const origYield = (h.core as unknown as { deps: CoreDeps }).deps.yieldTurn;
    (h.core as unknown as { deps: CoreDeps }).deps.yieldTurn = async () => {
      await origYield();
      if (!armed) {
        armed = true;
        await h.send({ type: 'stop' });
        await h.send({ type: 'build', lang: 'pmc', code: PMC_INC });
      }
    };
    await expect(
      h.send({ type: 'start', seeds: [{ cells: new Array(60_000).fill(2) }], limits: {}, breakpoints: [], mode: 'continuous' }),
    ).resolves.toBeUndefined();
    // Chosen behaviour: `build`'s dropSession() frees the abandoned session
    // and bumps the generation counter before the stale loop wakes up, so
    // the loop's generation check fires first and it returns silently — no
    // `finished` is ever posted for the superseded run. Only the two
    // `built` responses (initial tmc + the pmc build issued mid-yield) land.
    expect(ofType(h, 'built')).toHaveLength(2);
    expect(ofType(h, 'finished')).toHaveLength(0);
  });

  it('T-pump-paused-honours-stop: a stop that lands as pump() returns paused finalises as stopped, not paused', async () => {
    const posted: ToolchainResponse[] = [];
    const deps: CoreDeps = { post: (r) => posted.push(r), sleep: async () => {}, yieldTurn: async () => {}, now: () => 0 };
    const coreRef: { current?: ToolchainCore } = {};
    const session = fakeSession({
      pump: () => {
        // A stop lands in the exact same synchronous stretch as this pump()
        // call returning paused — reach in via handle() directly since we're
        // already inside a call chain that originated from it.
        void coreRef.current?.handle({ type: 'stop' });
        return { kind: 'paused', cause: { breakpoint: 1 } };
      },
    });
    const core = new ToolchainCore(fakeModule(fakeProgram(session)), deps);
    coreRef.current = core;
    await core.handle({ type: 'build', lang: 'pmc', code: 'main() {}' });
    await core.handle({ type: 'start', seeds: [], limits: {}, breakpoints: [], mode: 'continuous' });
    expect(posted.filter((r) => r.type === 'paused')).toHaveLength(0);
    const finished = posted.filter((r) => r.type === 'finished');
    expect(finished).toHaveLength(1);
    expect((finished[0] as Extract<ToolchainResponse, { type: 'finished' }>).result.outcome.kind).toBe('stopped');
  });
});
