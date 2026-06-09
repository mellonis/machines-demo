import { describe, it, expect } from 'vitest';
import { optionsBag } from './optionsBag.ts';
import { completionAt } from '../../testUtils.ts';

const labelsOf = (r: { options: ReadonlyArray<{ label: string }> } | null) => r ? r.options.map((o) => o.label).sort() : null;

describe('contexts/optionsBag (Phase 4 — top-level)', () => {
  it('S-src-options-toplevel-turingmachine', () => {
    const r = completionAt(`new TuringMachine({ ▮ })`, 'turing', optionsBag);
    expect(labelsOf(r)).toEqual(['tapeBlock']);
  });

  it('S-src-options-toplevel-tape', () => {
    const r = completionAt(`new Tape({ ▮ })`, 'turing', optionsBag);
    expect(labelsOf(r)).toEqual(['alphabet', 'symbols', 'viewportWidth']);
  });

  it('S-src-options-toplevel-tapeblock', () => {
    const r = completionAt(`new TapeBlock({ ▮ })`, 'turing', optionsBag);
    expect(labelsOf(r)).toEqual(['tapes']);
  });

  it('S-src-options-postmachine', () => {
    const r = completionAt(`new PostMachine({}, { ▮ })`, 'post', optionsBag);
    expect(labelsOf(r)).toEqual(['blankSymbol', 'markSymbol']);
  });

  it('S-src-options-partial', () => {
    const r = completionAt(`new Tape({ alphabet, ▮ })`, 'turing', optionsBag);
    expect(labelsOf(r)).toEqual(['symbols', 'viewportWidth']);
  });

  it('S-src-options-not-options-context — null', () => {
    const r = completionAt(`const x = { ▮ }`, 'turing', optionsBag);
    expect(r).toBeNull();
  });
});

describe('contexts/optionsBag (Phase 5 — nested)', () => {
  it('S-src-options-nested-state-pattern', () => {
    const src = `new State({ [tb.symbol(['a'])]: { ▮ } })`;
    const r = completionAt(src, 'turing', optionsBag);
    expect(labelsOf(r)).toEqual(['command', 'nextState']);
  });

  it('S-src-options-nested-command', () => {
    const src = `new State({ [tb.symbol(['a'])]: { command: [{ ▮ }] } })`;
    const r = completionAt(src, 'turing', optionsBag);
    expect(labelsOf(r)).toEqual(['movement', 'symbol']);
  });
});
