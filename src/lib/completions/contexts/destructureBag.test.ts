import { describe, it, expect } from 'vitest';
import { destructureBag } from './destructureBag.ts';
import { completionAt } from '../../testUtils.ts';

const labelsOf = (r: { options: ReadonlyArray<{ label: string }> } | null) => r ? r.options.map((o) => o.label).sort() : null;

describe('contexts/destructureBag', () => {
  it('S-src-destructure-imports-empty', () => {
    const r = completionAt(`const { ▮ } = imports;`, 'turing', destructureBag);
    expect(labelsOf(r)).toEqual(expect.arrayContaining(['Alphabet', 'State', 'Tape', 'TapeBlock', 'TuringMachine']));
  });

  it('S-src-destructure-imports-partial', () => {
    const r = completionAt(`const { State, ▮ } = imports;`, 'turing', destructureBag);
    expect(labelsOf(r)).not.toContain('State');
    expect(labelsOf(r)).toEqual(expect.arrayContaining(['Alphabet', 'Tape']));
  });

  it('S-src-destructure-tapeblock', () => {
    const r = completionAt(`const tb = new TapeBlock({ tapes: [] });\nconst { ▮ } = tb;`, 'turing', destructureBag);
    expect(labelsOf(r)).toEqual(['symbol', 'tapes']);
  });

  it('S-src-destructure-out-of-context — null', () => {
    const r = completionAt(`const x = ▮`, 'turing', destructureBag);
    expect(r).toBeNull();
  });
});
