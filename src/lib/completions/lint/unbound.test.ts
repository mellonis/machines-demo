import { describe, it, expect } from 'vitest';
import { unboundAll } from '../../testUtils.ts';

describe('lint/unbound — bare identifier references', () => {
  it('S-unbound-call-not-destructured', () => {
    const src = `
      const { PostMachine, mark, stop } = imports;
      new PostMachine({
        10: mark,
        20: call('sss'),
        30: stop,
      })
    `;
    const diags = unboundAll(src, 'post');
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('error');
    expect(diags[0].message).toBe(`'call' is not defined`);
  });

  it('S-unbound-all-destructured-ok', () => {
    const src = `
      const { PostMachine, mark, call, stop } = imports;
      new PostMachine({
        10: mark,
        20: call('sss'),
        30: stop,
      })
    `;
    expect(unboundAll(src, 'post')).toEqual([]);
  });

  it('S-unbound-local-const-ok', () => {
    const src = `
      const { PostMachine } = imports;
      const cfg = { a: 1 };
      new PostMachine(cfg)
    `;
    expect(unboundAll(src, 'post')).toEqual([]);
  });

  it('S-unbound-imports-is-allowlisted', () => {
    const src = `const { mark } = imports;`;
    expect(unboundAll(src, 'post')).toEqual([]);
  });

  it('S-unbound-common-globals-allowed', () => {
    const src = `
      const x = Math.floor(1.5);
      const y = JSON.stringify({ a: 1 });
      const z = console.log;
    `;
    expect(unboundAll(src, 'post')).toEqual([]);
  });

  it('S-unbound-skips-arrow-params', () => {
    const src = `
      const xs = [1, 2, 3];
      const doubled = xs.map(x => x + 1);
    `;
    expect(unboundAll(src, 'post')).toEqual([]);
  });

  it('S-unbound-skips-function-decls', () => {
    const src = `
      const greeting = 'hi';
      function helper(name) {
        return greeting + name;
      }
    `;
    expect(unboundAll(src, 'post')).toEqual([]);
  });

  it('S-unbound-renamed-destructure', () => {
    const src = `
      const { PostMachine, mark: writeOne } = imports;
      new PostMachine({ 10: writeOne(20) })
    `;
    expect(unboundAll(src, 'post')).toEqual([]);
  });

  it('S-unbound-works-on-turing', () => {
    const src = `
      const { Alphabet } = imports;
      const a = new Alphabet(['_', 'X']);
      const s = new State({});
    `;
    const diags = unboundAll(src, 'turing');
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toBe(`'State' is not defined`);
  });

  it('S-unbound-for-loop-let-binding', () => {
    const src = `
      const arr = [];
      for (let i = 0; i < 3; i++) arr[i] = i;
    `;
    expect(unboundAll(src, 'turing')).toEqual([]);
  });

  it('S-unbound-for-of-binding', () => {
    const src = `
      const xs = [1, 2, 3];
      const seen = [];
      for (const x of xs) seen.push(x);
    `;
    expect(unboundAll(src, 'turing')).toEqual([]);
  });

  it('S-unbound-for-in-binding', () => {
    const src = `
      const obj = { a: 1 };
      const keys = [];
      for (const k in obj) keys.push(k);
    `;
    expect(unboundAll(src, 'turing')).toEqual([]);
  });

  it('S-unbound-fn-param-does-not-suppress-toplevel-use', () => {
    // A name bound only as a function parameter must NOT count as "defined"
    // for a top-level use of the same name — the loop-binding fix collects
    // declarations at top-level scope only, not inside function bodies.
    const src = `
      const { State } = imports;
      function helper(movements) { return movements; }
      const x = movements.left;
    `;
    const diags = unboundAll(src, 'turing');
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toBe(`'movements' is not defined`);
  });

  it('S-unbound-multiple-undeclared', () => {
    const src = `
      const { PostMachine } = imports;
      new PostMachine({
        10: foo(),
        20: bar(),
      })
    `;
    const diags = unboundAll(src, 'post');
    expect(diags).toHaveLength(2);
    expect(diags.map((d) => d.message)).toEqual([
      `'foo' is not defined`,
      `'bar' is not defined`,
    ]);
  });
});
