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

describe('hints/signature — member methods', () => {
  it('S-sig-member-state-tag', () => {
    const src = `
      const { State } = imports;
      const s = new State({});
      s.tag(▮)
    `;
    const r = signatureAt(src, 'turing');
    expect(r).not.toBeNull();
    expect(r!.header).toBe('s.tag');
    expect(r!.params).toEqual([{ name: 'tags', typeStr: 'string[]', optional: false }]);
    expect(r!.activeIndex).toBe(0);
  });

  it('S-sig-member-state-wohs', () => {
    const src = `
      const { State } = imports;
      const s = new State({});
      s.withOverriddenHaltState(▮)
    `;
    const r = signatureAt(src, 'turing');
    expect(r!.header).toBe('s.withOverriddenHaltState');
    expect(r!.params).toEqual([{ name: 'continuation', typeStr: 'State', optional: false }]);
  });

  it('S-sig-member-tapeblock-symbol', () => {
    const src = `
      const { TapeBlock } = imports;
      const tb = new TapeBlock({ tapes: [] });
      tb.symbol(▮)
    `;
    const r = signatureAt(src, 'turing');
    expect(r!.header).toBe('tb.symbol');
    expect(r!.params).toEqual([{ name: 'pattern', typeStr: '(string | symbol)[]', optional: false }]);
  });

  it('S-sig-member-postmachine-stateAt', () => {
    const src = `
      const { PostMachine } = imports;
      const pm = new PostMachine({});
      pm.stateAt(▮)
    `;
    const r = signatureAt(src, 'post');
    expect(r!.header).toBe('pm.stateAt');
    expect(r!.params).toEqual([{ name: 'path', typeStr: 'string', optional: false }]);
  });

  it('S-sig-member-destructured-tapeblock-symbol', () => {
    // Uses the existing scan/locals.ts signatureRef:'TapeBlock.symbol' path.
    const src = `
      const { TapeBlock } = imports;
      const tb = new TapeBlock({ tapes: [] });
      const { symbol } = tb;
      symbol(▮)
    `;
    const r = signatureAt(src, 'turing');
    expect(r!.header).toBe('symbol');
    expect(r!.params).toEqual([{ name: 'pattern', typeStr: '(string | symbol)[]', optional: false }]);
  });

  it('S-sig-member-on-unknown-local — null', () => {
    const r = signatureAt(`somethingUntyped.tag(▮)`, 'turing');
    expect(r).toBeNull();
  });

  it('S-sig-member-method-not-in-schema — null', () => {
    const src = `
      const { State } = imports;
      const s = new State({});
      s.totallyMadeUp(▮)
    `;
    const r = signatureAt(src, 'turing');
    expect(r).toBeNull();
  });
});

describe('hints/signature — constructors', () => {
  it('S-sig-new-alphabet', () => {
    const r = signatureAt(`new Alphabet(▮)`, 'turing');
    expect(r).not.toBeNull();
    expect(r!.header).toBe('new Alphabet');
    expect(r!.params).toEqual([{ name: 'symbols', typeStr: 'string[]', optional: false }]);
    expect(r!.activeIndex).toBe(0);
  });

  it('S-sig-new-state-positional', () => {
    // State ctor: (symbolToData, name?)
    const r = signatureAt(`new State(▮)`, 'turing');
    expect(r!.params.map((p) => p.name)).toEqual(['symbolToData', 'name']);
    expect(r!.params.map((p) => p.optional)).toEqual([false, true]);
  });

  it('S-sig-new-state-second-arg', () => {
    const r = signatureAt(`new State({}, ▮)`, 'turing');
    expect(r!.activeIndex).toBe(1);
  });

  it('S-sig-new-postmachine', () => {
    const r = signatureAt(`new PostMachine(▮)`, 'post');
    expect(r!.params.map((p) => p.name)).toEqual(['instructions', 'options']);
    expect(r!.params[1].optional).toBe(true);
  });

  it('S-sig-new-unknown-class — null', () => {
    const r = signatureAt(`new NoSuchClass(▮)`, 'turing');
    expect(r).toBeNull();
  });
});

describe('hints/signature — post instructions', () => {
  it('S-sig-post-call', () => {
    const src = `
      const { call } = imports;
      call(▮)
    `;
    const r = signatureAt(src, 'post');
    expect(r).not.toBeNull();
    expect(r!.header).toBe('call');
    expect(r!.params).toEqual([{ name: 'label', typeStr: 'string', optional: false }]);
  });

  it('S-sig-post-check-second-arg', () => {
    const src = `
      const { check } = imports;
      check('then', ▮)
    `;
    const r = signatureAt(src, 'post');
    expect(r!.params.map((p) => p.name)).toEqual(['thenLabel', 'elseLabel']);
    expect(r!.activeIndex).toBe(1);
  });

  it('S-sig-post-mark-empty-signature', () => {
    // Zero-param post-instructions still show a tooltip — symmetry with right/left.
    // The empty parens confirm "this is the call form, no args expected".
    const src = `
      const { mark } = imports;
      mark(▮)
    `;
    const r = signatureAt(src, 'post');
    expect(r).not.toBeNull();
    expect(r!.header).toBe('mark');
    expect(r!.params).toEqual([]);
    expect(r!.activeIndex).toBe(0);
  });

  it('S-sig-post-left-optional-jumpTo', () => {
    const src = `
      const { left } = imports;
      left(▮)
    `;
    const r = signatureAt(src, 'post');
    expect(r!.params).toEqual([{ name: 'jumpTo', typeStr: 'number', optional: true }]);
  });
});

describe('hints/signature — renamed imports', () => {
  it('S-sig-rename-namespace-function', () => {
    const src = `
      const { toMermaid: tm } = imports;
      tm(▮)
    `;
    const r = signatureAt(src, 'turing');
    expect(r).not.toBeNull();
    // Header reflects what the user typed (the local alias), not the original name.
    expect(r!.header).toBe('tm');
    expect(r!.params).toEqual([{ name: 'graph', typeStr: 'Graph', optional: false }]);
  });

  it('S-sig-rename-class-ctor', () => {
    const src = `
      const { Alphabet: A } = imports;
      new A(▮)
    `;
    const r = signatureAt(src, 'turing');
    expect(r!.header).toBe('new A');
    expect(r!.params).toEqual([{ name: 'symbols', typeStr: 'string[]', optional: false }]);
  });

  it('S-sig-rename-post-instruction', () => {
    const src = `
      const { call: callSub } = imports;
      callSub(▮)
    `;
    const r = signatureAt(src, 'post');
    expect(r!.header).toBe('callSub');
    expect(r!.params).toEqual([{ name: 'label', typeStr: 'string', optional: false }]);
  });
});
