import { describe, it, expect } from 'vitest';
import { lintAll } from '../../testUtils.ts';

describe('lint/argCount — missing required args', () => {
  it('S-lint-mark-empty-parens', () => {
    const src = `
      const { mark } = imports;
      mark()
    `;
    const diags = lintAll(src, 'post');
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('error');
    expect(diags[0].message).toBe('mark requires 1 argument (got 0)');
  });

  it('S-lint-mark-correct', () => {
    const src = `
      const { mark } = imports;
      mark(20)
    `;
    const diags = lintAll(src, 'post');
    expect(diags).toEqual([]);
  });

  it('S-lint-call-missing-name', () => {
    const src = `
      const { call } = imports;
      call()
    `;
    const diags = lintAll(src, 'post');
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('error');
    expect(diags[0].message).toBe('call requires 1 argument (got 0)');
  });

  it('S-lint-check-missing-branches', () => {
    const src = `
      const { check } = imports;
      check()
    `;
    const diags = lintAll(src, 'post');
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toBe('check requires 2 arguments (got 0)');
  });

  it('S-lint-call-with-only-name', () => {
    // call(name) is valid — second jumpTo is optional.
    const src = `
      const { call } = imports;
      call('foo')
    `;
    const diags = lintAll(src, 'post');
    expect(diags).toEqual([]);
  });
});

describe('lint/argCount — too many args', () => {
  it('S-lint-mark-too-many', () => {
    const src = `
      const { mark } = imports;
      mark(1, 2)
    `;
    const diags = lintAll(src, 'post');
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('warning');
    expect(diags[0].message).toBe('mark takes 1 argument (got 2)');
  });

  it('S-lint-mark-three-extras', () => {
    const src = `
      const { mark } = imports;
      mark(1, 2, 3)
    `;
    const diags = lintAll(src, 'post');
    expect(diags[0].message).toBe('mark takes 1 argument (got 3)');
  });

  it('S-lint-call-too-many', () => {
    // call has 2 params (1 required + 1 optional); 3 args is extra.
    const src = `
      const { call } = imports;
      call('foo', 5, 10)
    `;
    const diags = lintAll(src, 'post');
    expect(diags[0].severity).toBe('warning');
    expect(diags[0].message).toBe('call takes 2 arguments (got 3)');
  });

  it('S-lint-check-correct-two-args', () => {
    const src = `
      const { check } = imports;
      check(20, 30)
    `;
    expect(lintAll(src, 'post')).toEqual([]);
  });
});

describe('lint/argCount — bare-only instructions called', () => {
  it('S-lint-stop-with-parens', () => {
    const src = `
      const { stop } = imports;
      stop()
    `;
    const diags = lintAll(src, 'post');
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('error');
    expect(diags[0].message).toBe('stop has no callable form (use bare `stop` instead)');
  });

  it('S-lint-stop-with-arg-still-flagged', () => {
    // Even with an arg, stop(...) is still invalid syntax. One diagnostic,
    // the bare-only error (not arg-count, since there's no callable form to count against).
    const src = `
      const { stop } = imports;
      stop(20)
    `;
    const diags = lintAll(src, 'post');
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toBe('stop has no callable form (use bare `stop` instead)');
  });

  it('S-lint-stop-renamed-still-flagged', () => {
    const src = `
      const { stop: halt } = imports;
      halt()
    `;
    const diags = lintAll(src, 'post');
    expect(diags).toHaveLength(1);
    // Message uses the user-typed alias so the diagnostic points at what's on screen.
    expect(diags[0].message).toBe('halt has no callable form (use bare `stop` instead)');
  });
});

describe('lint/argCount — constructors and member methods', () => {
  it('S-lint-new-alphabet-empty', () => {
    const src = `new Alphabet()`;
    const diags = lintAll(src, 'turing');
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('error');
    expect(diags[0].message).toBe('new Alphabet requires 1 argument (got 0)');
  });

  it('S-lint-new-alphabet-correct', () => {
    const src = `new Alphabet([' ', '*'])`;
    expect(lintAll(src, 'turing')).toEqual([]);
  });

  it('S-lint-new-state-positional-optional-name', () => {
    // State ctor: (symbolToData, name?). Calling with just the first is valid.
    const src = `
      const { State } = imports;
      new State({})
    `;
    expect(lintAll(src, 'turing')).toEqual([]);
  });

  it('S-lint-new-state-missing-required', () => {
    const src = `
      const { State } = imports;
      new State()
    `;
    const diags = lintAll(src, 'turing');
    expect(diags[0].message).toBe('new State requires 1 argument (got 0)');
  });

  it('S-lint-state-tag-empty', () => {
    const src = `
      const { State } = imports;
      const s = new State({});
      s.tag()
    `;
    const diags = lintAll(src, 'turing');
    // 2 calls in this source: new State({}) (valid, 1 arg), s.tag() (invalid, 0 args).
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toBe('s.tag requires 1 argument (got 0)');
  });

  it('S-lint-state-tag-correct', () => {
    const src = `
      const { State } = imports;
      const s = new State({});
      s.tag(['x'])
    `;
    expect(lintAll(src, 'turing')).toEqual([]);
  });
});

describe('lint/argCount — passes silently', () => {
  it('S-lint-unknown-callee', () => {
    const src = `userDefined()`;
    expect(lintAll(src, 'post')).toEqual([]);
  });

  it('S-lint-non-literal-arg-still-counts', () => {
    // mark(someVar) is one arg — meets required count.
    const src = `
      const { mark } = imports;
      const target = 20;
      mark(target)
    `;
    expect(lintAll(src, 'post')).toEqual([]);
  });

  it('S-lint-nested-call-counted-independently', () => {
    // Inner call(): missing arg → error. Outer mark(...): 1 arg (the call expression) → ok.
    const src = `
      const { mark, call } = imports;
      mark(call())
    `;
    const diags = lintAll(src, 'post');
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toBe('call requires 1 argument (got 0)');
  });

  it('S-lint-chained-member-access', () => {
    // a.b.c() — resolveCallee returns null for chained member access. No diagnostic.
    const src = `
      const x = { a: { b: () => 1 } };
      x.a.b()
    `;
    expect(lintAll(src, 'post')).toEqual([]);
  });

  it('S-lint-multiple-calls-all-checked', () => {
    const src = `
      const { mark, check, stop } = imports;
      mark()
      check()
      stop()
    `;
    const diags = lintAll(src, 'post');
    expect(diags).toHaveLength(3);
    expect(diags.map((d) => d.message)).toEqual([
      'mark requires 1 argument (got 0)',
      'check requires 2 arguments (got 0)',
      'stop has no callable form (use bare `stop` instead)',
    ]);
  });
});
