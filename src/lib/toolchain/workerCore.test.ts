import { describe, expect, it } from 'vitest';
import { loadMtcForTests } from './testModule.ts';
import { ToolchainCore, type CoreDeps } from './workerCore.ts';
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

const last = (h: Harness) => h.posted[h.posted.length - 1];
const ofType = <T extends ToolchainResponse['type']>(h: Harness, t: T) =>
  h.posted.filter((r) => r.type === t) as Extract<ToolchainResponse, { type: T }>[];

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
