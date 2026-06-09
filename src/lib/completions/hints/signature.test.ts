import { describe, it, expect } from 'vitest';
import { signatureAt } from '../../testUtils.ts';

describe('hints/signature — namespace function (Phase 1)', () => {
  it('S-sig-namespace-function-toMermaid', () => {
    const r = signatureAt(`toMermaid(▮)`, 'turing');
    expect(r).not.toBeNull();
    expect(r!.header).toBe('toMermaid');
    expect(r!.params).toEqual([{ name: 'graph', typeStr: 'Graph', optional: false }]);
    expect(r!.activeIndex).toBe(0);
  });

  it('S-sig-namespace-function-summarize', () => {
    const r = signatureAt(`summarize(▮)`, 'turing');
    expect(r).not.toBeNull();
    expect(r!.params.map((p) => p.name)).toEqual(['state', 'block']);
    expect(r!.params.map((p) => p.typeStr)).toEqual(['State', 'TapeBlock']);
  });

  it('S-sig-not-a-call — null', () => {
    const r = signatureAt(`const x = 1 + ▮`, 'turing');
    expect(r).toBeNull();
  });

  it('S-sig-unknown-callee — null', () => {
    const r = signatureAt(`thisIsNotInTheSchema(▮)`, 'turing');
    expect(r).toBeNull();
  });
});
