import type { Alphabets, Command, TapeSnapshot } from './types.ts';
import type { LogEntry } from './log.ts';

/** Engine edge-label format (machines-demo#69) — matches turing-machine-js's
 *  `toMermaid` emit so a logged step's notation lines up byte-for-byte with
 *  the same transition's edge label in the rendered state graph.
 *
 *  Format: `[reads] → [writes]/[moves]` (writes/moves omit the `[reads] →`
 *  prefix when `reads === null`, e.g. manual Apply where no transition
 *  matched).
 *
 *  Per-cell encoding:
 *  - Read cell: `'X'` (literal symbol, always single-quoted) or `B`
 *    (blank — used only for NON-wildcard reads where the transition
 *    matched the blank specifically). Wildcard reads always render the
 *    literal symbol prefixed with `*=` (so `*='a'`, `*=' '`, etc.) — the
 *    whole point of the wildcard marker is to show WHAT `ifOtherSymbol`
 *    actually caught on this iter; the `B` shortcut would hide that.
 *    Wildcard rendering requires per-tape `matchKinds` (sourced from
 *    `MachineState.matchedTransition.matchKinds`); when `matchKinds` is
 *    omitted (manual Apply — no transition fired) every position renders
 *    as a literal.
 *  - Write cell: `'X'` (literal) | `K='X'` (keep, no write — `command.symbol`
 *    is null because the resolved symbol matched current; the read symbol
 *    that remains is appended for clarity, falling back to bare `K` when
 *    reads aren't available e.g. manual Apply) | `E` (erase, write equals
 *    blank).
 *  - Move cell: `L` | `R` | `S`.
 *
 *  Multi-tape: per-tape entries are comma-separated inside one outer
 *  bracket per role: `['1','a'] → ['0','b']/[R,L]`.
 */
function formatStepNotation(
  reads: readonly string[] | null,
  commands: readonly Command[],
  blanks: readonly string[],
  matchKinds: readonly ('wildcard' | 'literal')[] | null,
): string {
  const writes = commands
    .map((c, i) => {
      if (c.symbol === null) {
        // Augment `K` with the concrete kept symbol — without this the
        // log shows `['a'] → [K]/[R]` and the reader has to mentally
        // re-resolve `K` against the read each time. `K='a'/[R]` carries
        // both the semantic (matched a wildcard, no write) and the
        // observable outcome (`'a'` stays on the cell).
        if (reads !== null) {
          const r = reads[i];
          if (r !== undefined) return r === blanks[i] ? "K=B" : `K='${r}'`;
        }
        return 'K';
      }
      if (c.symbol === blanks[i]) return 'E';
      return `'${c.symbol}'`;
    })
    .join(',');
  const moves = commands.map((c) => c.movement).join(',');
  const writesPart = `[${writes}]/[${moves}]`;

  if (reads === null) return writesPart;

  const readsStr = reads
    .map((r, i) => {
      // Non-wildcard: blank → `B`, literal → `'X'`. Wildcard: always
      // literal `*='X'` so the user sees WHAT the catch-all caught;
      // the `B` shortcut would obscure the matched value (especially
      // bad when the alphabet's blank glyph is something unusual).
      if (matchKinds?.[i] === 'wildcard') return `*='${r}'`;
      // Non-wildcard (or no matchKinds → manual Apply): blank → `B`,
      // literal → `'X'`.
      return r === blanks[i] ? 'B' : `'${r}'`;
    })
    .join(',');
  return `[${readsStr}] → ${writesPart}`;
}

export function formatTape(tape: TapeSnapshot): string {
  // No UI substitution — the user controls their blank glyph. We bracket
  // the head; `[<blank-char>]` may render an invisible space if blank=' ',
  // but that's the user's chosen symbol.
  return tape.symbols
    .map((sym, i) => (i === tape.position ? `[${sym}]` : sym))
    .join('');
}

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
