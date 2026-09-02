import { describe, expect, it } from 'vitest';
import { TOOLCHAIN_ENGINES } from '../types.ts';
import { defaultExample, examples, findExample } from '../defaultCode.ts';
import { loadMtcForTests } from './testModule.ts';
import { seedFromGlyphs } from './toolchainHelpers.ts';
import { toolchainExamples } from './examples.ts';
import { langFor } from './types.ts';

describe('toolchain examples', () => {
  it('T-examples-clean: every example builds, lints clean, and its seeds fit the program\'s bands', async () => {
    const { Toolchain } = await loadMtcForTests();
    for (const engine of TOOLCHAIN_ENGINES) {
      for (const ex of toolchainExamples(engine)) {
        const lang = langFor(engine, ex.kind ?? 'source');
        const r = Toolchain.build(lang, ex.code, undefined);
        expect(r.ok, `${engine}/${ex.id} builds`).toBe(true);
        if (!r.ok) continue;
        expect(r.diagnostics, `${engine}/${ex.id} build warnings`).toEqual([]);
        expect(Toolchain.check(lang, ex.code, undefined), `${engine}/${ex.id} lint`).toEqual([]);
        const tapes = r.program.tapes();
        expect((ex.seeds ?? []).length).toBeLessThanOrEqual(tapes.length);
        (ex.seeds ?? []).forEach((s, i) => expect(() => seedFromGlyphs(tapes[i].glyphs, s)).not.toThrow());
        r.program.free();
      }
    }
  });

  it('T-examples-dispatch: defaultCode routes toolchain engines to their example sets', () => {
    expect(examples('pm1')[0].id).toBe('unary-increment');
    expect(examples('tm1')[0].id).toBe('binary-increment');
    expect(defaultExample('tm1').kind ?? 'source').toBe('source');
    expect(findExample('pm1', 'unary-increment-asm')?.kind).toBe('asm');
    expect(findExample('pm1', 'nope')).toBeUndefined();
  });

  it('T-examples-asm-roundtrip: each assembly example is the disassembly of its source twin (same bytes)', async () => {
    const { Toolchain } = await loadMtcForTests();
    for (const [engine, srcId, asmId] of [['pm1', 'unary-increment', 'unary-increment-asm'], ['tm1', 'binary-increment', 'binary-increment-asm']] as const) {
      const src = Toolchain.build(langFor(engine, 'source'), findExample(engine, srcId)!.code, undefined);
      const asm = Toolchain.build(langFor(engine, 'asm'), findExample(engine, asmId)!.code, undefined);
      if (!src.ok || !asm.ok) throw new Error('build failed');
      expect(Array.from(asm.program.bytes())).toEqual(Array.from(src.program.bytes()));
      src.program.free(); asm.program.free();
    }
  });
});
