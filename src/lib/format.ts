import { formatStepNotation, formatTape, type TapeSnapshot } from '@turing-machine-js/visuals';
import type { Alphabets, Command } from './types.ts';
import type { LogEntry } from './log.ts';

// `formatStepNotation` and `formatTape` now come from `@turing-machine-js/visuals`
// (engine edge-label format `[reads] → [writes]/[moves]` + per-cell `B` / `E` /
// `K='X'` / `*='X'` encoding). Re-exported below so demo consumers that still
// import `formatTape` from this module keep working.
export { formatTape };

/** Quoted, comma-separated rest-of-alphabet (excludes the blank at index 0). */
function alphabetRest(alphabet: readonly string[]): string {
  return alphabet.slice(1).map((s) => `'${s}'`).join(', ');
}

/* ───── log entries ─────
 * Single-tape entries are a one-line `text` only; multi-tape entries become a
 * header line plus 1-indexed `- Tape K: …` rows, optionally tinted per-tape
 * via the `colors` palette so each tape's row reads in its caret color.
 */

/**
 * Log entries describing each tape's full definition: blank, alphabet, and
 * current tape symbols. Single-tape: three sibling lines. Multi-tape: one
 * entry per tape with a `Tape N:` header and `- blank` / `- alphabet` /
 * `- tape` on indented rows, so a tape's full definition reads as one
 * grouped chunk in the log. Returned as an array; callers spread it into
 * `appendBatch`.
 */
export function tapesEntry(
  tapes: readonly TapeSnapshot[],
  alphabets: Alphabets,
  colors?: readonly string[],
): LogEntry[] {
  // Blank symbol per tape is `alphabets[i][0]`, quoted on the log line so an
  // invisible space still reads as `' '`.
  const blankFor = (i: number): string => `'${alphabets[i]?.[0] ?? ''}'`;
  if (tapes.length === 1) {
    return [
      { text: `blank: ${blankFor(0)}`, color: colors?.[0] },
      { text: `alphabet: ${alphabetRest(alphabets[0]) || '(empty)'}`, color: colors?.[0] },
      { text: `tape: ${formatTape(tapes[0])}`, color: colors?.[0] },
    ];
  }
  return tapes.map((t, i) => ({
    text: `Tape ${i + 1}:`,
    color: colors?.[i],
    rows: [
      { text: `- blank: ${blankFor(i)}`, color: colors?.[i] },
      { text: `- alphabet: ${alphabetRest(alphabets[i] ?? []) || '(empty)'}`, color: colors?.[i] },
      { text: `- tape: ${formatTape(t)}`, color: colors?.[i] },
    ],
  }));
}

/**
 * Where the commands came from, used as the entry header. A step carries its
 * 1-based step number (`step N:`); a manual `Apply` is the literal `'applied'`
 * (no extra data — `applied:` header).
 */
export type CommandsApplication = { stepNumber: number } | 'applied';

/**
 * One log entry rendering an applied step in engine edge-label notation
 * (`[reads] → [writes]/[moves]`, machines-demo#69). Single-tape gets a
 * one-line header + inline notation; multi-tape gets a header line with
 * `- Tape N: …` rows per tape.
 *
 * `reads` parallels `commands` (per-tape symbols read at each head before
 * the step applied). Manual `'applied'` from the control panel doesn't
 * have a transition match in the engine sense; callers pass the symbols
 * at the heads at apply-time when available, or `null` to render just
 * `[writes]/[moves]`.
 *
 * `matchKinds` parallels `reads` — per-tape match kind for the firing
 * alternative's selector (`'wildcard'` iff the engine matched via
 * `ifOtherSymbol` at that position). Pass `null`/omit for the manual
 * Apply path where no transition fired — every position renders as a
 * literal.
 *
 * `alphabets[i][0]` is the per-tape blank symbol — used to choose `B` over
 * `'<literal>'` for reads and `E` over `'<literal>'` for writes when the
 * symbol matches the blank.
 */
export function commandsEntry(
  reads: readonly string[] | readonly string[][] | null,
  commands: readonly Command[] | null,
  alphabets: Alphabets,
  application: CommandsApplication,
  colors?: readonly string[],
  matchKinds?: readonly ('wildcard' | 'literal')[] | readonly ('wildcard' | 'literal')[][] | null,
): LogEntry {
  const prefix = application === 'applied' ? 'applied' : `step ${application.stepNumber}`;
  if (!commands || commands.length === 0) return { text: `${prefix}:` };

  const blanks = alphabets.map((a) => a[0] ?? '');
  // Single-tape: `reads` and `commands` are flat per-tape arrays.
  if (commands.length === 1) {
    const tapeRead =
      reads === null
        ? null
        : ((reads as readonly string[])[0] ?? null);
    const tapeMatch =
      matchKinds == null
        ? null
        : ((matchKinds as readonly ('wildcard' | 'literal')[])[0] ?? null);
    const notation = formatStepNotation(
      tapeRead === null ? null : [tapeRead],
      commands,
      blanks,
      tapeMatch === null ? null : [tapeMatch],
    );
    return { text: `${prefix}: ${notation}`, color: colors?.[0] };
  }

  // Multi-tape: one bracketed group per tape on its own row.
  return {
    text: `${prefix}:`,
    rows: commands.map((command, i) => {
      const tapeRead =
        reads === null
          ? null
          : ((reads as readonly string[])[i] ?? null);
      const tapeMatch =
        matchKinds == null
          ? null
          : ((matchKinds as readonly ('wildcard' | 'literal')[])[i] ?? null);
      const notation = formatStepNotation(
        tapeRead === null ? null : [tapeRead],
        [command],
        [blanks[i] ?? ''],
        tapeMatch === null ? null : [tapeMatch],
      );
      return {
        text: `- Tape ${i + 1}: ${notation}`,
        color: colors?.[i],
      };
    }),
  };
}
