import type { ToolchainEngine } from '../types.ts';
import type {
  Diagnostic, Lang, Outcome, RunResult, RunStats, Seed, SourceFile,
  TapeBlockTapeInput, TapeLayout, TapeSnapshot, TrapInfo,
} from '$mtc';
export type {
  Diagnostic, Lang, Outcome, RunResult, RunStats, Seed, SourceFile,
  TapeBlockTapeInput, TapeLayout, TapeSnapshot, TrapInfo,
};

export type BufferKind = 'source' | 'asm';
export type Arch = 'pm' | 'tm';
export const TOOLCHAIN_ARCH: Record<ToolchainEngine, Arch> = { pm1: 'pm', tm1: 'tm' };
export type SourceTab = 'main' | 'std';

export type AddrLoc = { addr: number; file: SourceFile; line: number | null; fn: string };
/** `userLineToAddr[n]` / `stdLineToAddr[n]` are indexed by 1-based line; index 0 is always null. */
export type LineMap = { addrToLoc: AddrLoc[]; userLineToAddr: (number | null)[]; stdLineToAddr: (number | null)[] };

/** Sparse seed tape: absolute position → alphabet index; blank (index 0) everywhere else. */
export type SeedTape = { cells: Map<number, number>; head: number };
/** Author-facing seed in glyphs (examples, persistence). */
export type ExampleSeed = { cells: string[]; head?: number; origin?: number };

export type DriveMode = 'step' | 'auto' | 'continuous';
export type PauseCause = 'step' | 'brk' | 'manual' | { breakpoint: number } | { trap: string };

export type ToolchainRequest =
  | { type: 'build'; lang: Lang; code: string }
  | { type: 'stdlib'; lang: Lang }
  | { type: 'check'; lang: Lang; code: string }
  | { type: 'format'; lang: Lang; code: string }
  | { type: 'disassemble' }
  | { type: 'decodeTapeBlock'; bytes: Uint8Array }
  | { type: 'encodeTapeBlock'; tapes: TapeBlockTapeInput[] }
  | { type: 'start'; seeds: Seed[]; limits: { maxSteps?: number }; breakpoints: number[]; mode: DriveMode; intervalMs?: number }
  | { type: 'resume'; mode: DriveMode; intervalMs?: number }
  | { type: 'pause' }
  | { type: 'stop' }
  | { type: 'setBreakpoints'; addrs: number[] }
  | { type: 'setDebug'; on: boolean };

export type BuiltResponse =
  | { type: 'built'; ok: true; tapes: TapeLayout[]; diagnostics: Diagnostic[]; lineMap: LineMap }
  | { type: 'built'; ok: false; diagnostics: Diagnostic[] };
export type FormattedResponse =
  | { type: 'formatted'; ok: true; text: string }
  | { type: 'formatted'; ok: false; error: Diagnostic };
export type SteppedResponse = { type: 'stepped'; snapshots: TapeSnapshot[]; ip: number; stats: RunStats; retired: boolean };
export type ProgressResponse = { type: 'progress'; snapshots: TapeSnapshot[]; steps: number; ip: number };
export type PausedResponse = { type: 'paused'; cause: PauseCause; ip: number; snapshots: TapeSnapshot[]; stats: RunStats };
export type FinishedResponse = { type: 'finished'; result: RunResult; snapshots: TapeSnapshot[] };
export type ErrorResponse = { type: 'error'; message: string; fatal?: boolean };

export type ToolchainResponse =
  | BuiltResponse
  | { type: 'stdlibText'; text: string }
  | { type: 'checked'; diagnostics: Diagnostic[] }
  | FormattedResponse
  | { type: 'disassembled'; text: string }
  | { type: 'tapeBlockSeeds'; seeds: Seed[] }
  | { type: 'tapeBlockBytes'; bytes: Uint8Array }
  | SteppedResponse | ProgressResponse | PausedResponse | FinishedResponse
  | { type: 'idle' } | { type: 'busy' }
  | ErrorResponse;

export function langFor(engine: ToolchainEngine, kind: BufferKind): Lang {
  return `${TOOLCHAIN_ARCH[engine]}${kind === 'source' ? 'c' : 'a'}` as Lang;
}
export function kindOfLang(lang: Lang): BufferKind {
  return lang.endsWith('c') ? 'source' : 'asm';
}
/** File extension for a buffer of `lang` — the language name is the extension. */
export function extOf(lang: Lang): string {
  return lang;
}
