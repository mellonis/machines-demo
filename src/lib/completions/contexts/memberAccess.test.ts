import { describe, it, expect } from 'vitest';
import { memberAccess } from './memberAccess.ts';
import { completionAt } from '../../testUtils.ts';

const labelsOf = (r: { options: ReadonlyArray<{ label: string }> } | null) => r ? r.options.map((o) => o.label).sort() : null;

describe('contexts/memberAccess (Phase 1)', () => {
  it('S-src-member-movements — left/right/stay', () => {
    const r = completionAt(`movements.▮`, 'turing', memberAccess);
    expect(labelsOf(r)).toEqual(['left', 'right', 'stay']);
  });

  it('S-src-member-symbolCommands — keep/erase', () => {
    const r = completionAt(`symbolCommands.▮`, 'turing', memberAccess);
    expect(labelsOf(r)).toEqual(['erase', 'keep']);
  });

  it('S-src-member-state-debug-tag-wohs', () => {
    const r = completionAt(`const s = new State({});\ns.▮`, 'turing', memberAccess);
    expect(labelsOf(r)).toEqual(['debug', 'tag', 'withOverriddenHaltState']);
  });

  it('S-src-member-unknown-falls-through — null', () => {
    const r = completionAt(`const z = someUnknown;\nz.▮`, 'turing', memberAccess);
    expect(r).toBeNull();
  });

  it('S-src-member-haltState-via-import-singleton', () => {
    const r = completionAt(`haltState.▮`, 'turing', memberAccess);
    expect(labelsOf(r)).toEqual(['debug', 'tag', 'withOverriddenHaltState']);
  });
});

describe('contexts/memberAccess (Phase 2 — general)', () => {
  it('S-src-member-tape', () => {
    const r = completionAt(`const t = new Tape({ alphabet });\nt.▮`, 'turing', memberAccess);
    expect(labelsOf(r)).toEqual(['alphabet', 'position', 'symbols', 'viewport']);
  });

  it('S-src-member-tapeblock', () => {
    const r = completionAt(`const tb = new TapeBlock({ tapes: [] });\ntb.▮`, 'turing', memberAccess);
    expect(labelsOf(r)).toEqual(['symbol', 'tapes']);
  });

  it('S-src-member-alphabet', () => {
    const r = completionAt(`const a = new Alphabet(["a"]);\na.▮`, 'turing', memberAccess);
    expect(labelsOf(r)).toEqual(['blankSymbol', 'symbols']);
  });

  it('S-src-member-postmachine', () => {
    const r = completionAt(`const m = new PostMachine({});\nm.▮`, 'post', memberAccess);
    expect(labelsOf(r)).toEqual(expect.arrayContaining(['replaceTapeWith', 'setBreakpoint', 'tape']));
  });
});
