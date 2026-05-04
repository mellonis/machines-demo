import type { Alphabets, Command, TapeSnapshot } from './types.ts';
import type { LogEntry } from './log.ts';

function describeAppliedCommand(command: Command): string {
  // Display symbol — literal char from the alphabet (no UI substitution; the
  // user controls what their blank looks like via the alphabet definition).
  // Single-quote-wrap so an invisible blank (e.g. literal space) still reads
  // as something on a log line. `sym` (not `symbol`) avoids shadowing the
  // built-in TS/JS `symbol` type used by the upstream library's movement
  // primitives.
  const sym = command.symbol === null ? 'kept' : `wrote '${command.symbol}'`;
  const movement = command.movement === 'L' ? 'moved left' : command.movement === 'R' ? 'moved right' : 'stayed';
  // Paper-style shorthand: `<sym>/<mvmt>`. Actual symbols wrap in single
  // quotes so a literal `*` (valid alphabet symbol) reads as `'*'` and stays
  // distinct from the bare `*` wildcard used for "kept" (no write).
  const shortSym = command.symbol === null ? '*' : `'${command.symbol}'`;
  return `${sym} + ${movement} (${shortSym}/${command.movement})`;
}

/** Quoted, comma-separated rest-of-alphabet (excludes the blank at index 0). */
function alphabetRest(alphabet: readonly string[]): string {
  return alphabet.slice(1).map((s) => `'${s}'`).join(', ');
}

export function formatTape(tape: TapeSnapshot): string {
  // No UI substitution — the user controls their blank glyph. We bracket
  // the head; `[<blank-char>]` may render an invisible space if blank=' ',
  // but that's the user's chosen symbol.
  return tape.symbols
    .map((sym, i) => (i === tape.position ? `[${sym}]` : sym))
    .join('');
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
 * One log entry describing applied commands — replaces the previous
 * `stepEntry` / `appliedEntry` split. Single-tape: header followed by inline
 * description (`step 3: wrote 'a' + moved right ('a'/R)`). Multi-tape:
 * header on its own line and `- Tape N: …` rows per tape.
 */
export function commandsEntry(
  commands: readonly Command[] | null,
  application: CommandsApplication,
  colors?: readonly string[],
): LogEntry {
  const prefix = application === 'applied' ? 'applied' : `step ${application.stepNumber}`;
  if (!commands || commands.length === 0) return { text: `${prefix}:` };
  if (commands.length === 1) {
    return { text: `${prefix}: ${describeAppliedCommand(commands[0])}`, color: colors?.[0] };
  }
  return {
    text: `${prefix}:`,
    rows: commands.map((command, i) => ({
      text: `- Tape ${i + 1}: ${describeAppliedCommand(command)}`,
      color: colors?.[i],
    })),
  };
}
