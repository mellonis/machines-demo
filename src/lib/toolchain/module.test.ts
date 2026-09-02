import { describe, expect, it } from 'vitest';
import { loadMtcForTests } from './testModule.ts';

describe('mtc-wasm module', () => {
  it('T-module-loads: the vendored bundle initialises and builds a one-line program', async () => {
    const { Toolchain } = await loadMtcForTests();
    const r = Toolchain.build('pmc', 'main() {\n  1: mark(!);\n}\n', undefined);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.program.tapes()).toEqual([{ name: 'tape', glyphs: [' ', '*'] }]);
      r.program.free();
    }
  });
});
