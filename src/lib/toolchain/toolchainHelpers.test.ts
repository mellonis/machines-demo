import { describe, expect, it } from 'vitest';
import { VIEWPORT_WIDTH } from '../caps.ts';
import { loadMtcForTests } from './testModule.ts';
import {
  applyCommand, buildLineMap, cellAt, findStdDefinition, headDelta, indexStdExports,
  layoutsEqual, seedFromGlyphs, seedFromSnapshot, seedToGlyphs, seedToLibTape, seedToWasm, snapshotToLibTape,
} from './toolchainHelpers.ts';
import type { SeedTape, TapeSnapshot } from './types.ts';

const PM = [' ', '*'];
const PMC_INC = 'main() {\n    1: right(2);\n    2: check(1, 3);\n    3: mark(4);\n    4: left(5);\n    5: check(4, 6);\n    6: right(!);\n}\n';
const PMC_STD = 'main() {\n    @std::goToEnd();\n    right;\n    mark;\n}\n';

function snap(cells: number[], origin: number, head: number): TapeSnapshot {
  return { band: 0, name: 'tape', glyphs: PM, origin, cells: new Uint8Array(cells), head };
}

describe('seeds', () => {
  it('T-seed-roundtrip: glyphs → SeedTape → glyphs keeps cells, origin and head', () => {
    const seed = seedFromGlyphs(PM, { cells: ['*', '*', ' ', '*'], origin: 3, head: 4 });
    expect([...seed.cells.entries()]).toEqual([[3, 1], [4, 1], [6, 1]]);
    expect(seed.head).toBe(4);
    expect(seedToGlyphs(PM, seed)).toEqual({ cells: ['*', '*', ' ', '*'], origin: 3, head: 4 });
  });

  it('T-seed-unknown-glyph: an unknown glyph throws naming it', () => {
    expect(() => seedFromGlyphs(PM, { cells: ['x'] })).toThrow(/unknown glyph 'x'/);
  });

  it('T-seed-dense: SeedTape → wasm Seed is dense from the lowest to the highest cell with absolute origin and head', () => {
    const seed: SeedTape = { cells: new Map([[5, 1], [7, 1]]), head: 6 };
    expect(seedToWasm(seed)).toEqual({ cells: [1, 0, 1], origin: 5, head: 6 });
    expect(seedToWasm({ cells: new Map(), head: 2 })).toEqual({ cells: [], origin: 2, head: 2 });
  });

  it('T-seed-from-snapshot: blanks are dropped, head kept', () => {
    const seed = seedFromSnapshot(snap([1, 0, 1], 5, 6));
    expect([...seed.cells.entries()]).toEqual([[5, 1], [7, 1]]);
    expect(seed.head).toBe(6);
  });

  it('T-seed-apply: Apply writes the symbol then moves the head; null symbol keeps', () => {
    const s0: SeedTape = { cells: new Map(), head: 0 };
    const s1 = applyCommand(s0, PM, { movement: 'R', symbol: '*' });
    expect([...s1.cells.entries()]).toEqual([[0, 1]]);
    expect(s1.head).toBe(1);
    const s2 = applyCommand(s1, PM, { movement: 'L', symbol: null });
    expect(s2.head).toBe(0);
    const s3 = applyCommand(s2, PM, { movement: 'S', symbol: ' ' });
    expect(s3.cells.size).toBe(0);
    expect(s0.cells.size).toBe(0); // pure
  });
});

describe('rendering', () => {
  it('T-window-center: a seed becomes a library tape whose viewport is VIEWPORT_WIDTH wide with the head in the middle', () => {
    const tape = seedToLibTape({ cells: new Map([[0, 1], [2, 1]]), head: 2 }, PM, VIEWPORT_WIDTH);
    const view = tape.viewport;
    expect(view.length).toBe(VIEWPORT_WIDTH);
    const mid = (VIEWPORT_WIDTH - 1) / 2;
    expect(view[mid]).toBe('*');
    expect(view[mid - 2]).toBe('*');
    expect(view[mid - 1]).toBe(' ');
  });

  it('T-window-empty: an empty seed renders all blanks', () => {
    const tape = seedToLibTape({ cells: new Map(), head: 0 }, PM, VIEWPORT_WIDTH);
    expect(tape.viewport.every((c) => c === ' ')).toBe(true);
  });

  it('T-window-snapshot: a snapshot with the head outside its span still centers the head', () => {
    const tape = snapshotToLibTape(snap([1, 1], 0, 5), VIEWPORT_WIDTH);
    const mid = (VIEWPORT_WIDTH - 1) / 2;
    expect(tape.viewport[mid]).toBe(' ');
    expect(tape.viewport[mid - 5]).toBe('*');
  });

  it('T-delta-clamp: head delta is clamped to one cell', () => {
    expect(headDelta(3, 4)).toBe(1);
    expect(headDelta(3, 3)).toBe(0);
    expect(headDelta(3, 0)).toBe(-1);
    expect(cellAt(snap([1, 0, 1], 5, 5), 7)).toBe(1);
    expect(cellAt(snap([1, 0, 1], 5, 5), 99)).toBe(0);
  });

  it('T-layouts-equal: same bands and glyphs compare equal, anything else not', () => {
    expect(layoutsEqual([{ name: 'a', glyphs: ['_', 'x'] }], [{ name: 'a', glyphs: ['_', 'x'] }])).toBe(true);
    expect(layoutsEqual([{ name: 'a', glyphs: ['_', 'x'] }], [{ name: 'a', glyphs: ['_', 'y'] }])).toBe(false);
    expect(layoutsEqual([{ name: 'a', glyphs: ['_'] }], [])).toBe(false);
  });
});

describe('line map', () => {
  it('T-linemap-inverse: every instruction line of a user program maps to an address whose lineOf is that line', async () => {
    const { Toolchain } = await loadMtcForTests();
    const r = Toolchain.build('pmc', PMC_INC, undefined);
    if (!r.ok) throw new Error('build failed');
    const map = buildLineMap(r.program, PMC_INC.split('\n').length, Toolchain.stdlibSource('pmc').split('\n').length);
    for (const line of [2, 3, 4, 5, 6, 7]) {
      const addr = map.userLineToAddr[line];
      expect(addr).not.toBeNull();
      expect(map.addrToLoc.find((l) => l.addr === addr)?.line).toBe(line);
    }
    expect(map.userLineToAddr[0]).toBeNull();
    expect(map.userLineToAddr[1]).toBeNull(); // `main() {` owns no instruction
    expect(map.userLineToAddr[8]).toBeNull(); // `}`
    r.program.free();
  });

  it('T-linemap-std: stdlib addresses resolve to std lines and stdLineToAddr inverts them', async () => {
    const { Toolchain } = await loadMtcForTests();
    const r = Toolchain.build('pmc', PMC_STD, undefined);
    if (!r.ok) throw new Error('build failed');
    const std = Toolchain.stdlibSource('pmc');
    const map = buildLineMap(r.program, PMC_STD.split('\n').length, std.split('\n').length);
    const stdLocs = map.addrToLoc.filter((l) => l.file === 'std' && l.line !== null);
    expect(stdLocs.length).toBeGreaterThan(0);
    for (const loc of stdLocs) expect(map.stdLineToAddr[loc.line!]).not.toBeNull();
    expect(map.stdLineToAddr.length).toBe(std.split('\n').length + 1);
    r.program.free();
  });

  it('T-linemap-asm: an assembled program maps physical lines', async () => {
    const { Toolchain } = await loadMtcForTests();
    const PMA = '.func main\nL1:\n        rgt\n        jm      L1\n        wr      1\n        stp\n';
    const r = Toolchain.build('pma', PMA, undefined);
    if (!r.ok) throw new Error('assemble failed');
    const map = buildLineMap(r.program, PMA.split('\n').length, 1);
    expect(map.userLineToAddr[3]).not.toBeNull(); // rgt
    expect(map.userLineToAddr[2]).toBeNull();     // label line
    r.program.free();
  });
});

describe('stdlib index', () => {
  it('T-stddef-all: every `export` in both stdlibs is indexed with its line and detail', async () => {
    const { Toolchain } = await loadMtcForTests();
    const pmc = Toolchain.stdlibSource('pmc');
    const pm = indexStdExports('pmc', pmc);
    expect(pm.map((e) => e.name)).toContain('goToEnd');
    const goToEnd = findStdDefinition(pm, 'goToEnd')!;
    expect(pmc.split('\n')[goToEnd.line - 1]).toMatch(/export goToEnd\(\)/);
    expect(goToEnd.kind).toBe('function');
    expect(goToEnd.detail).toBe('goToEnd()');
    const tmc = Toolchain.stdlibSource('tmc');
    const tm = indexStdExports('tmc', tmc);
    expect(tm.some((e) => e.kind === 'routine')).toBe(true);
    expect(tm.some((e) => e.kind === 'graph')).toBe(true);
    expect(tm.some((e) => e.kind === 'alphabet')).toBe(true);
    // Count check against a plain scan of the text — nothing exported is missed.
    const exportLines = tmc.split('\n').filter((l) => /^\s*export\s+(routine|graph|alphabet)\s+/.test(l)).length;
    expect(tm.length).toBe(exportLines);
    expect(findStdDefinition(tm, 'nope')).toBeUndefined();
  });

  it('T-stdcomp-doc: a preceding `?` doc block becomes the export\'s doc', () => {
    const text = '? Walks right.\n? Stops on blank.\nexport routine goRight(tape t: a writes {}) {\n}\n';
    const [e] = indexStdExports('tmc', text);
    expect(e.doc).toBe('Walks right.\nStops on blank.');
    expect(e.detail).toBe('routine goRight(tape t: a writes {})');
  });
});
