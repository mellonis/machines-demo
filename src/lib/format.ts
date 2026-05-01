import type { Command, TapeSnapshot } from './types.ts';
import type { LogEntry } from './log.ts';

function describeOne(cmd: Command): string {
  const sym = cmd.symbol === null ? 'keep' : `wrote '${cmd.symbol === ' ' ? '␣' : cmd.symbol}'`;
  const mv = cmd.movement === 'L' ? 'left' : cmd.movement === 'R' ? 'right' : 'stay';
  return `${sym} + ${mv}`;
}

export function formatAlphabet(alphabet: readonly string[]): string {
  return alphabet.map((s, i) => (i === 0 ? '␣' : `'${s}'`)).join(', ');
}

export function formatTape(tape: TapeSnapshot): string {
  return tape.symbols
    .map((sym, i) => {
      const display = sym === tape.blank ? '␣' : sym;
      return i === tape.position ? `[${display}]` : display;
    })
    .join(' ');
}

/* ───── log entries ─────
 * Single-tape entries are a one-line `text` only; multi-tape entries become a
 * header line plus 1-indexed `- Tape K: …` rows, optionally tinted per-tape
 * via the `colors` palette so each tape's row reads in its caret color.
 */

export function alphabetsEntry(
  alphabets: readonly (readonly string[])[],
  colors?: readonly string[],
): LogEntry {
  if (alphabets.length === 1) {
    return { text: `alphabet: ${formatAlphabet(alphabets[0])}`, color: colors?.[0] };
  }
  return {
    text: 'alphabets:',
    rows: alphabets.map((a, i) => ({
      text: `- Tape ${i + 1}: ${formatAlphabet(a)}`,
      color: colors?.[i],
    })),
  };
}

export function tapesEntry(
  tapes: readonly TapeSnapshot[],
  colors?: readonly string[],
): LogEntry {
  if (tapes.length === 1) {
    return { text: `tape: ${formatTape(tapes[0])}`, color: colors?.[0] };
  }
  return {
    text: 'tapes:',
    rows: tapes.map((t, i) => ({
      text: `- Tape ${i + 1}: ${formatTape(t)}`,
      color: colors?.[i],
    })),
  };
}

export function stepEntry(
  stepNumber: number,
  cmds: Command[] | null,
  colors?: readonly string[],
): LogEntry {
  if (!cmds || cmds.length === 0) return { text: `step ${stepNumber}:` };
  if (cmds.length === 1) {
    return { text: `step ${stepNumber}: ${describeOne(cmds[0])}`, color: colors?.[0] };
  }
  return {
    text: `step ${stepNumber}:`,
    rows: cmds.map((c, i) => ({
      text: `- Tape ${i + 1}: ${describeOne(c)}`,
      color: colors?.[i],
    })),
  };
}

export function appliedEntry(
  cmds: readonly Command[],
  colors?: readonly string[],
): LogEntry {
  if (cmds.length === 0) return { text: 'applied:' };
  if (cmds.length === 1) {
    return { text: `applied: ${describeOne(cmds[0])}`, color: colors?.[0] };
  }
  return {
    text: 'applied:',
    rows: cmds.map((c, i) => ({
      text: `- Tape ${i + 1}: ${describeOne(c)}`,
      color: colors?.[i],
    })),
  };
}
