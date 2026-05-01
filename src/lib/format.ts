import type { Command, TapeSnapshot } from './types.ts';

export function describeCommand(cmd: Command | null): string {
  if (!cmd) return '';
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
