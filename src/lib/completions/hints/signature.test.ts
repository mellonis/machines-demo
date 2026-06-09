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

describe('hints/signature — active argument', () => {
  it('S-sig-active-first-arg', () => {
    const r = signatureAt(`summarize(▮)`, 'turing');
    expect(r!.activeIndex).toBe(0);
  });

  it('S-sig-active-second-arg', () => {
    const r = signatureAt(`summarize(myState, ▮)`, 'turing');
    expect(r!.activeIndex).toBe(1);
  });

  it('S-sig-active-second-arg-no-space', () => {
    const r = signatureAt(`summarize(myState,▮)`, 'turing');
    expect(r!.activeIndex).toBe(1);
  });

  it('S-sig-active-past-last-returns-null', () => {
    // toMermaid takes one param — cursor after a trailing comma is past-last.
    const r = signatureAt(`toMermaid(g, ▮)`, 'turing');
    expect(r).toBeNull();
  });

  it('S-sig-active-skips-commas-inside-nested-args', () => {
    // The cursor is inside summarize's ArgList; the comma inside the inner
    // array literal must not increment summarize's active index.
    const r = signatureAt(`summarize(makeState([a, b]), ▮)`, 'turing');
    expect(r!.activeIndex).toBe(1);
  });
});
