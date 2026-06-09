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
