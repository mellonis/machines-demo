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
