import { describe, expect, it } from 'vitest';
import { commandsEntry } from './format.ts';
import type { Command } from './types.ts';

// Engine edge-label notation (machines-demo#69): `[reads] → [writes]/[moves]`.
// Read cells: literal-quoted `'X'` or `B` (blank). Write cells: literal-quoted
// or `K` (keep, command.symbol === null) or `E` (erase, command.symbol equals
// blank). Move cells: bare `L`/`R`/`S`.

describe('commandsEntry — edge-label notation', () => {
  const alphabets = [[' ', '0', '1']]; // single-tape: blank = ' ', symbols 0/1

  it('formats single-tape literal read + literal write + R move', () => {
    const reads = ['1'];
    const commands: Command[] = [{ movement: 'R', symbol: '0' }];
    const entry = commandsEntry(reads, commands, alphabets, { stepNumber: 12 });
    expect(entry.text).toBe(`step 12: ['1'] → ['0']/[R]`);
  });

  it('uses K=<read> when command.symbol is null (keep) and reads are known', () => {
    const reads = ['1'];
    const commands: Command[] = [{ movement: 'S', symbol: null }];
    const entry = commandsEntry(reads, commands, alphabets, { stepNumber: 3 });
    expect(entry.text).toBe(`step 3: ['1'] → [K='1']/[S]`);
  });

  it('uses K=B when keep over a blank cell', () => {
    const reads = [' ']; // blank under head
    const commands: Command[] = [{ movement: 'S', symbol: null }];
    const entry = commandsEntry(reads, commands, alphabets, { stepNumber: 4 });
    expect(entry.text).toBe(`step 4: [B] → [K=B]/[S]`);
  });

  it('falls back to bare K when reads are unavailable (manual Apply)', () => {
    const commands: Command[] = [{ movement: 'S', symbol: null }];
    const entry = commandsEntry(null, commands, alphabets, 'applied');
    expect(entry.text).toBe(`applied: [K]/[S]`);
  });

  it('uses E when command.symbol equals the blank (erase)', () => {
    const reads = ['1'];
    const commands: Command[] = [{ movement: 'L', symbol: ' ' }];
    const entry = commandsEntry(reads, commands, alphabets, { stepNumber: 5 });
    expect(entry.text).toBe(`step 5: ['1'] → [E]/[L]`);
  });

  it('uses B when the read symbol equals the blank', () => {
    const reads = [' ']; // blank under head
    const commands: Command[] = [{ movement: 'R', symbol: '1' }];
    const entry = commandsEntry(reads, commands, alphabets, { stepNumber: 7 });
    expect(entry.text).toBe(`step 7: [B] → ['1']/[R]`);
  });

  it('renders manual `applied` entries with no [reads] prefix when reads is null', () => {
    const commands: Command[] = [{ movement: 'R', symbol: '1' }];
    const entry = commandsEntry(null, commands, alphabets, 'applied');
    expect(entry.text).toBe(`applied: ['1']/[R]`);
  });

  it('renders manual `applied` entries with [reads] prefix when reads supplied', () => {
    const reads = ['0'];
    const commands: Command[] = [{ movement: 'R', symbol: '1' }];
    const entry = commandsEntry(reads, commands, alphabets, 'applied');
    expect(entry.text).toBe(`applied: ['0'] → ['1']/[R]`);
  });

  it('multi-tape: one row per tape with engine notation', () => {
    const multiAlphabets = [
      [' ', '0', '1'],
      [' ', 'a', 'b'],
    ];
    const reads = ['1', 'a'];
    const commands: Command[] = [
      { movement: 'R', symbol: '0' },
      { movement: 'L', symbol: 'b' },
    ];
    const entry = commandsEntry(reads, commands, multiAlphabets, { stepNumber: 2 });
    expect(entry.text).toBe('step 2:');
    expect(entry.rows).toHaveLength(2);
    expect(entry.rows?.[0].text).toBe(`- Tape 1: ['1'] → ['0']/[R]`);
    expect(entry.rows?.[1].text).toBe(`- Tape 2: ['a'] → ['b']/[L]`);
  });

  it('multi-tape: per-tape blank handling — B and E independently', () => {
    const multiAlphabets = [
      [' ', '0', '1'],
      ['_', 'a', 'b'], // tape 2 uses '_' as blank
    ];
    const reads = [' ', 'a']; // tape 1 reads blank, tape 2 reads literal
    const commands: Command[] = [
      { movement: 'S', symbol: '_' }, // tape 1 writes literal '_' (NOT its blank ' ')
      { movement: 'S', symbol: '_' }, // tape 2 writes '_' which IS its blank → E
    ];
    const entry = commandsEntry(reads, commands, multiAlphabets, { stepNumber: 1 });
    expect(entry.rows?.[0].text).toBe(`- Tape 1: [B] → ['_']/[S]`);
    expect(entry.rows?.[1].text).toBe(`- Tape 2: ['a'] → [E]/[S]`);
  });

  it('empty / null commands → just the header', () => {
    expect(commandsEntry(null, null, alphabets, { stepNumber: 1 }).text).toBe('step 1:');
    expect(commandsEntry(null, [], alphabets, { stepNumber: 1 }).text).toBe('step 1:');
  });

  // Wildcard marker (`*='X'`) — driven by per-tape matchKinds sourced from
  // engine `MachineState.matchedTransition.matchKinds` (turing-machine-js
  // #205). Position renders as `*='<lit>'` iff the firing alternative
  // matched via `ifOtherSymbol` at that tape index. The literal symbol
  // is always shown (no `B` shortcut for blanks) so the user can see
  // WHAT the catch-all caught — that's the whole point of the marker.
  describe('wildcard read marker (#205)', () => {
    it('renders single-tape wildcard read as `*=<lit>`', () => {
      const reads = ['1'];
      const commands: Command[] = [{ movement: 'R', symbol: null }];
      const entry = commandsEntry(
        reads, commands, alphabets, { stepNumber: 3 }, undefined, ['wildcard'],
      );
      expect(entry.text).toBe(`step 3: [*='1'] → [K='1']/[R]`);
    });

    it('renders wildcard over blank as `*=\' \'` (literal, not `*=B`)', () => {
      // Wildcard always shows literal — the `B` shortcut only applies to
      // non-wildcard blank reads. The literal answers "what did ifOtherSymbol
      // catch?"; `B` would only confirm "it was blank" (already implied by
      // the alphabet's first symbol).
      const reads = [' '];
      const commands: Command[] = [{ movement: 'S', symbol: null }];
      const entry = commandsEntry(
        reads, commands, alphabets, { stepNumber: 4 }, undefined, ['wildcard'],
      );
      expect(entry.text).toBe(`step 4: [*=' '] → [K=B]/[S]`);
    });

    it('matchKinds = [literal] renders identically to omitting matchKinds', () => {
      const reads = ['1'];
      const commands: Command[] = [{ movement: 'R', symbol: '0' }];
      const withLit = commandsEntry(
        reads, commands, alphabets, { stepNumber: 1 }, undefined, ['literal'],
      );
      const withoutKinds = commandsEntry(
        reads, commands, alphabets, { stepNumber: 1 },
      );
      expect(withLit.text).toBe(withoutKinds.text);
    });

    it('multi-tape: per-tape kinds (wildcard, literal) render independently', () => {
      const multiAlphabets = [
        [' ', '0', '1'],
        [' ', 'a', 'b'],
      ];
      const reads = ['1', 'a'];
      const commands: Command[] = [
        { movement: 'R', symbol: null },
        { movement: 'L', symbol: 'b' },
      ];
      const entry = commandsEntry(
        reads, commands, multiAlphabets, { stepNumber: 2 }, undefined, ['wildcard', 'literal'],
      );
      expect(entry.rows?.[0].text).toBe(`- Tape 1: [*='1'] → [K='1']/[R]`);
      expect(entry.rows?.[1].text).toBe(`- Tape 2: ['a'] → ['b']/[L]`);
    });
  });
});
