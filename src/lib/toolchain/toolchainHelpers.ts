// Pure helpers for the toolchain engines: seed tapes, snapshots, the line
// map, the stdlib export index. No DOM, no worker — every function here is
// exercised under Node against the real wasm module.
import * as turing from '@turing-machine-js/machine';
import type { Program } from '$mtc';
import type { Command } from '../types.ts';
import type { AddrLoc, ExampleSeed, Lang, LineMap, Seed, SeedTape, TapeLayout, TapeSnapshot } from './types.ts';

export function glyphIndex(glyphs: readonly string[], glyph: string): number {
  const i = glyphs.indexOf(glyph);
  if (i === -1) {
    throw new Error(`unknown glyph '${glyph}' (alphabet: ${glyphs.map((g) => `'${g}'`).join(' ')})`);
  }
  return i;
}

export function emptySeed(): SeedTape {
  return { cells: new Map(), head: 0 };
}

export function seedFromGlyphs(glyphs: readonly string[], seed: ExampleSeed): SeedTape {
  const origin = seed.origin ?? 0;
  const cells = new Map<number, number>();
  seed.cells.forEach((g, i) => {
    const ix = glyphIndex(glyphs, g);
    if (ix !== 0) cells.set(origin + i, ix);
  });
  return { cells, head: seed.head ?? 0 };
}

/**
 * Maps an example's / snippet's glyph seeds onto a set of tape band layouts
 * — the currently-loaded program's bands, tried at pick/load time so the
 * belt can seed itself before the next Build. Returns the mapped seeds when
 * every provided seed fits (a band with no seed gets `emptySeed()`), or
 * `null` when any seed doesn't fit the layout at that index (wrong alphabet,
 * or more seeds than bands) — the caller falls back to applying at Build
 * time against the new program's own layout.
 */
export function applySeedGlyphs(layouts: TapeLayout[], glyphSeeds: ExampleSeed[]): SeedTape[] | null {
  if (glyphSeeds.length > layouts.length) return null;
  const out: SeedTape[] = [];
  for (const layout of layouts) {
    const g = glyphSeeds[out.length];
    if (!g) { out.push(emptySeed()); continue; }
    try { out.push(seedFromGlyphs(layout.glyphs, g)); } catch { return null; }
  }
  return out;
}

function span(seed: SeedTape): { lo: number; hi: number } | null {
  if (seed.cells.size === 0) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const k of seed.cells.keys()) {
    if (k < lo) lo = k;
    if (k > hi) hi = k;
  }
  return { lo, hi };
}

export function seedCellAt(seed: SeedTape, pos: number): number {
  return seed.cells.get(pos) ?? 0;
}

export function seedToGlyphs(glyphs: readonly string[], seed: SeedTape): ExampleSeed {
  const s = span(seed);
  if (!s) return { cells: [], origin: seed.head, head: seed.head };
  const cells: string[] = [];
  for (let p = s.lo; p <= s.hi; p++) cells.push(glyphs[seedCellAt(seed, p)]);
  return { cells, origin: s.lo, head: seed.head };
}

export function seedToWasm(seed: SeedTape): Seed {
  const s = span(seed);
  if (!s) return { cells: [], origin: seed.head, head: seed.head };
  const cells: number[] = [];
  for (let p = s.lo; p <= s.hi; p++) cells.push(seedCellAt(seed, p));
  return { cells, origin: s.lo, head: seed.head };
}

export function seedFromSnapshot(snap: TapeSnapshot): SeedTape {
  const cells = new Map<number, number>();
  snap.cells.forEach((v, i) => {
    if (v !== 0) cells.set(snap.origin + i, v);
  });
  return { cells, head: snap.head };
}

export function applyCommand(seed: SeedTape, glyphs: readonly string[], cmd: Command): SeedTape {
  const cells = new Map(seed.cells);
  if (cmd.symbol !== null) {
    const ix = glyphIndex(glyphs, cmd.symbol);
    if (ix === 0) cells.delete(seed.head);
    else cells.set(seed.head, ix);
  }
  const head = seed.head + (cmd.movement === 'L' ? -1 : cmd.movement === 'R' ? 1 : 0);
  return { cells, head };
}

export function cellAt(snap: TapeSnapshot, pos: number): number {
  const i = pos - snap.origin;
  return i >= 0 && i < snap.cells.length ? snap.cells[i] : 0;
}

export function headDelta(prevHead: number, nextHead: number): -1 | 0 | 1 {
  const d = nextHead - prevHead;
  return d > 0 ? 1 : d < 0 ? -1 : 0;
}

/** Symbols from `lo` to `hi` inclusive (absolute positions), reading `at`. */
function libTape(
  glyphs: readonly string[],
  lo: number,
  hi: number,
  head: number,
  at: (pos: number) => number,
  viewportWidth: number,
): turing.Tape {
  const start = Math.min(lo, head);
  const end = Math.max(hi, head);
  const symbols: string[] = [];
  for (let p = start; p <= end; p++) symbols.push(glyphs[at(p)]);
  return new turing.Tape({
    alphabet: new turing.Alphabet([...glyphs]),
    symbols,
    position: head - start,
    viewportWidth,
  });
}

export function seedToLibTape(seed: SeedTape, glyphs: readonly string[], viewportWidth: number): turing.Tape {
  const s = span(seed) ?? { lo: seed.head, hi: seed.head };
  return libTape(glyphs, s.lo, s.hi, seed.head, (p) => seedCellAt(seed, p), viewportWidth);
}

export function snapshotToLibTape(snap: TapeSnapshot, viewportWidth: number): turing.Tape {
  const lo = snap.origin;
  const hi = snap.cells.length > 0 ? snap.origin + snap.cells.length - 1 : snap.origin;
  return libTape(snap.glyphs, lo, hi, snap.head, (p) => cellAt(snap, p), viewportWidth);
}

export function layoutsEqual(a: TapeLayout[], b: TapeLayout[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => x.name === b[i].name && x.glyphs.length === b[i].glyphs.length && x.glyphs.every((g, j) => g === b[i].glyphs[j]));
}

/**
 * Exact line ownership: a line owns an address when some instruction's
 * `lineOf` names it (the lowest such address wins). `addressForLine` is not
 * used here — it snaps unmapped lines forward to the next instruction, which
 * is right for planting a breakpoint from a debugger but wrong for a gutter
 * that must refuse comment and declaration lines.
 */
export function buildLineMap(program: Program, userLines: number, stdLines: number): LineMap {
  const addrToLoc: AddrLoc[] = [];
  const userLineToAddr: (number | null)[] = new Array(userLines + 1).fill(null);
  const stdLineToAddr: (number | null)[] = new Array(stdLines + 1).fill(null);
  for (const row of program.listing()) {
    const loc = program.lineOf(row.addr);
    if (!loc) continue;
    addrToLoc.push({ addr: row.addr, file: loc.file, line: loc.line, fn: loc.function });
    if (loc.line === null) continue;
    const table = loc.file === 'std' ? stdLineToAddr : userLineToAddr;
    if (loc.line < table.length && table[loc.line] === null) table[loc.line] = row.addr;
  }
  return { addrToLoc, userLineToAddr, stdLineToAddr };
}

export type StdExport = {
  name: string;
  kind: 'function' | 'routine' | 'graph' | 'alphabet';
  /** 1-based line of the declaration in `stdlibSource(lang)`. */
  line: number;
  /** The declaration, trimmed, without `export` and without the trailing `{`. */
  detail: string;
  /** Preceding contiguous `?` doc lines (`.tmc`) or `//` lines (`.pmc`), joined; null when none. */
  doc: string | null;
};

const PMC_EXPORT = /^\s*export\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*\)\s*\{?/;
const TMC_EXPORT = /^\s*export\s+(routine|graph|alphabet)\s+([A-Za-z_][A-Za-z0-9_]*)(.*)$/;

function docAbove(lines: string[], i: number, marker: RegExp): string | null {
  const out: string[] = [];
  for (let j = i - 1; j >= 0; j--) {
    const m = marker.exec(lines[j]);
    if (!m) break;
    out.unshift(m[1].trim());
  }
  return out.length > 0 ? out.join('\n') : null;
}

export function indexStdExports(lang: Lang, text: string): StdExport[] {
  const lines = text.split('\n');
  const out: StdExport[] = [];
  const isPm = lang === 'pmc' || lang === 'pma';
  lines.forEach((raw, i) => {
    if (isPm) {
      const m = PMC_EXPORT.exec(raw);
      if (!m) return;
      out.push({ name: m[1], kind: 'function', line: i + 1, detail: `${m[1]}()`, doc: docAbove(lines, i, /^\s*\/\/\s?(.*)$/) });
    } else {
      const m = TMC_EXPORT.exec(raw);
      if (!m) return;
      const rest = m[3].replace(/\s*\{\s*$/, '').trimEnd();
      out.push({
        name: m[2],
        kind: m[1] as StdExport['kind'],
        line: i + 1,
        detail: `${m[1]} ${m[2]}${rest}`,
        doc: docAbove(lines, i, /^\s*\?\s?(.*)$/),
      });
    }
  });
  return out;
}

export function findStdDefinition(exports: StdExport[], name: string): StdExport | undefined {
  return exports.find((e) => e.name === name);
}

/** A codec `Seed` (dense cells from `origin`) as a sparse `SeedTape`. */
export function seedFromWasm(seed: Seed): SeedTape {
  const origin = seed.origin ?? 0;
  const cells = new Map<number, number>();
  Array.from(seed.cells).forEach((v, i) => {
    if (v !== 0) cells.set(origin + i, v);
  });
  return { cells, head: seed.head ?? 0 };
}
