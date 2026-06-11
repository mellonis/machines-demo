import { describe, it, expect } from 'vitest';
import { collectScope } from './crossRef.ts';
import { syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import type { SyntaxNode } from '@lezer/common';
import { crossRefAll } from '../../testUtils.ts';

// Locate the first ObjectExpression in a small JS snippet.
function firstObjectExpression(source: string): { node: SyntaxNode; state: EditorState } {
  const state = EditorState.create({ doc: source, extensions: [javascript()] });
  const tree = syntaxTree(state);
  let found: SyntaxNode | null = null;
  tree.iterate({
    enter(node) {
      if (found) return false;
      if (node.name === 'ObjectExpression') {
        found = node.node;
        return false;
      }
      return undefined;
    },
  });
  if (!found) throw new Error('No ObjectExpression in source');
  return { node: found, state };
}

describe('lint/crossRef/collectScope', () => {
  it('S-cref-scope-numeric-keys-only', () => {
    const { node, state } = firstObjectExpression(`({ 10: x, 20: y, 30: z })`);
    const scope = collectScope(node, state);
    expect([...scope.indices].sort((a, b) => a - b)).toEqual([10, 20, 30]);
    expect(scope.subroutines.size).toBe(0);
  });

  it('S-cref-scope-string-keys-collected-as-subroutines', () => {
    const { node, state } = firstObjectExpression(`({ rightToBlank: { 1: x, 2: y, 3: z }, 10: a })`);
    const scope = collectScope(node, state);
    expect([...scope.indices].sort((a, b) => a - b)).toEqual([10]);
    expect([...scope.subroutines.keys()]).toEqual(['rightToBlank']);
    const sub = scope.subroutines.get('rightToBlank')!;
    expect([...sub.indices].sort((a, b) => a - b)).toEqual([1, 2, 3]);
    expect(sub.subroutines.size).toBe(0);
  });

  it('S-cref-scope-quoted-string-keys-handled', () => {
    const { node, state } = firstObjectExpression(`({ 'subA': { 1: a }, 'subB': { 2: b }, 10: c })`);
    const scope = collectScope(node, state);
    expect([...scope.subroutines.keys()].sort()).toEqual(['subA', 'subB']);
    expect([...scope.indices]).toEqual([10]);
  });

  it('S-cref-scope-array-group-values-still-contribute-index', () => {
    const { node, state } = firstObjectExpression(`({ 1: [a, b], 2: c })`);
    const scope = collectScope(node, state);
    expect([...scope.indices].sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('S-cref-scope-nested-subroutines', () => {
    // outer's body contains 'inner' subroutine — subroutines nest.
    const { node, state } = firstObjectExpression(`({ 10: x, outer: { 1: x, inner: { 1: y, 2: z } } })`);
    const scope = collectScope(node, state);
    expect([...scope.indices]).toEqual([10]);
    expect([...scope.subroutines.keys()]).toEqual(['outer']);
    const outer = scope.subroutines.get('outer')!;
    expect([...outer.indices]).toEqual([1]);
    expect([...outer.subroutines.keys()]).toEqual(['inner']);
    const inner = outer.subroutines.get('inner')!;
    expect([...inner.indices].sort((a, b) => a - b)).toEqual([1, 2]);
    expect(inner.subroutines.size).toBe(0);
  });

  it('S-cref-scope-empty', () => {
    const { node, state } = firstObjectExpression(`({})`);
    const scope = collectScope(node, state);
    expect(scope.indices.size).toBe(0);
    expect(scope.subroutines.size).toBe(0);
  });
});

describe('lint/crossRef — top-level index validation', () => {
  it('S-cref-mark-unknown-index', () => {
    const src = `
      const { PostMachine, mark, stop } = imports;
      new PostMachine({
        10: mark(99),
        20: stop,
      })
    `;
    const diags = crossRefAll(src, 'post');
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('error');
    expect(diags[0].message).toBe('unknown instruction index: 99');
  });

  it('S-cref-mark-known-index', () => {
    const src = `
      const { PostMachine, mark, stop } = imports;
      new PostMachine({
        10: mark(20),
        20: stop,
      })
    `;
    expect(crossRefAll(src, 'post')).toEqual([]);
  });

  it('S-cref-check-both-branches-validated', () => {
    const src = `
      const { PostMachine, check, mark, stop } = imports;
      new PostMachine({
        10: check(20, 99),
        20: mark(30),
        30: stop,
      })
    `;
    const diags = crossRefAll(src, 'post');
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toBe('unknown instruction index: 99');
  });

  it('S-cref-non-literal-arg-skipped', () => {
    const src = `
      const { PostMachine, mark, stop } = imports;
      const target = 20;
      new PostMachine({
        10: mark(target),
        20: stop,
      })
    `;
    expect(crossRefAll(src, 'post')).toEqual([]);
  });

  it('S-cref-no-postmachine-no-diagnostics', () => {
    const src = `
      const { mark } = imports;
      mark(99)
    `;
    expect(crossRefAll(src, 'post')).toEqual([]);
  });

  it('S-cref-renamed-instruction-still-validated', () => {
    const src = `
      const { PostMachine, mark: writeOne, stop } = imports;
      new PostMachine({
        10: writeOne(99),
        20: stop,
      })
    `;
    const diags = crossRefAll(src, 'post');
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toBe('unknown instruction index: 99');
  });
});

describe('lint/crossRef — call subroutine validation', () => {
  it('S-cref-call-unknown-subroutine', () => {
    const src = `
      const { PostMachine, call, stop } = imports;
      new PostMachine({
        10: call('typo'),
        20: stop,
        rightToBlank: { 1: stop },
      })
    `;
    const diags = crossRefAll(src, 'post');
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('error');
    expect(diags[0].message).toBe(`unknown subroutine: 'typo'`);
  });

  it('S-cref-call-known-subroutine', () => {
    const src = `
      const { PostMachine, call, stop } = imports;
      new PostMachine({
        10: call('rightToBlank'),
        20: stop,
        rightToBlank: { 1: stop },
      })
    `;
    expect(crossRefAll(src, 'post')).toEqual([]);
  });

  it('S-cref-call-second-arg-validates-caller-local-index', () => {
    // call('rightToBlank', 99) at top level — 99 not in top-level indices → error
    const src = `
      const { PostMachine, call, stop } = imports;
      new PostMachine({
        10: call('rightToBlank', 99),
        20: stop,
        rightToBlank: { 1: stop },
      })
    `;
    const diags = crossRefAll(src, 'post');
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toBe('unknown instruction index: 99');
  });

  it('S-cref-call-non-literal-name-skipped', () => {
    const src = `
      const { PostMachine, call, stop } = imports;
      const name = 'rightToBlank';
      new PostMachine({
        10: call(name),
        20: stop,
      })
    `;
    expect(crossRefAll(src, 'post')).toEqual([]);
  });
});

describe('lint/crossRef — subroutine-local scope', () => {
  it('S-cref-subroutine-local-index-valid', () => {
    const src = `
      const { PostMachine, call, check, right, stop } = imports;
      new PostMachine({
        10: call('rightToBlank'),
        20: stop,
        rightToBlank: {
          1: right,
          2: check(3, 1),
          3: stop,
        },
      })
    `;
    expect(crossRefAll(src, 'post')).toEqual([]);
  });

  it('S-cref-subroutine-index-not-in-top-level-not-flagged', () => {
    // The '2' referenced from inside rightToBlank refers to rightToBlank's '2',
    // NOT top-level '20'. Even though '2' is not a top-level index, this is OK.
    const src = `
      const { PostMachine, call, mark, stop } = imports;
      new PostMachine({
        10: call('rightToBlank'),
        20: stop,
        rightToBlank: {
          1: mark(2),
          2: stop,
        },
      })
    `;
    expect(crossRefAll(src, 'post')).toEqual([]);
  });

  it('S-cref-subroutine-unknown-local-index', () => {
    const src = `
      const { PostMachine, call, mark, stop } = imports;
      new PostMachine({
        10: call('rightToBlank'),
        20: stop,
        rightToBlank: {
          1: mark(99),
          2: stop,
        },
      })
    `;
    const diags = crossRefAll(src, 'post');
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toBe('unknown instruction index: 99');
  });

  it('S-cref-call-from-subroutine-references-top-level-subroutines', () => {
    // call('subB') from inside subA — subB is at top level, found by walking the chain.
    const src = `
      const { PostMachine, call, stop } = imports;
      new PostMachine({
        10: call('subA'),
        20: stop,
        subA: {
          1: call('subB'),
          2: stop,
        },
        subB: {
          1: stop,
        },
      })
    `;
    expect(crossRefAll(src, 'post')).toEqual([]);
  });

  it('S-cref-call-second-arg-uses-caller-local-scope', () => {
    // call('subA', 2) from inside subA: after returning, jump to subA's
    // index 2 (subA-local). 2 IS a valid subA index → no error, even though
    // 2 is NOT a top-level index.
    const src = `
      const { PostMachine, call, stop } = imports;
      new PostMachine({
        10: call('subA'),
        20: stop,
        subA: {
          1: call('subA', 2),
          2: stop,
        },
      })
    `;
    expect(crossRefAll(src, 'post')).toEqual([]);
  });

  it('S-cref-call-second-arg-unknown-in-caller-local-scope', () => {
    // call('subA', 99) from inside subA: 99 isn't in subA (or anywhere) → error.
    const src = `
      const { PostMachine, call, stop } = imports;
      new PostMachine({
        10: call('subA'),
        20: stop,
        subA: {
          1: call('subA', 99),
          2: stop,
        },
      })
    `;
    const diags = crossRefAll(src, 'post');
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toBe('unknown instruction index: 99');
  });

  it('S-cref-call-nested-subroutine-resolved', () => {
    // outer contains nested 'inner'. call('inner') from inside outer
    // resolves via chain walk (local scope wins before root).
    const src = `
      const { PostMachine, call, stop } = imports;
      new PostMachine({
        10: call('outer'),
        20: stop,
        outer: {
          1: call('inner'),
          inner: { 1: stop },
        },
      })
    `;
    expect(crossRefAll(src, 'post')).toEqual([]);
  });

  it('S-cref-call-unknown-name-from-nested-scope', () => {
    // call('typo') from inside outer — not in local or any upper scope.
    const src = `
      const { PostMachine, call, stop } = imports;
      new PostMachine({
        10: call('outer'),
        20: stop,
        outer: {
          1: call('typo'),
          2: stop,
        },
      })
    `;
    const diags = crossRefAll(src, 'post');
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toBe(`unknown subroutine: 'typo'`);
  });
});

describe('lint/crossRef — indexed form inside array group', () => {
  it('S-cref-indexed-in-array-group', () => {
    const src = `
      const { PostMachine, mark, right, stop } = imports;
      new PostMachine({
        1: [mark(2), right],
        2: stop,
      })
    `;
    const diags = crossRefAll(src, 'post');
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe('error');
    expect(diags[0].message).toBe('indexed form not allowed inside grouped instructions');
  });

  it('S-cref-bare-refs-in-array-group-ok', () => {
    const src = `
      const { PostMachine, mark, right, stop } = imports;
      new PostMachine({
        1: [mark, right, mark],
        2: stop,
      })
    `;
    expect(crossRefAll(src, 'post')).toEqual([]);
  });

  it('S-cref-multiple-indexed-in-array-group', () => {
    const src = `
      const { PostMachine, mark, right, stop } = imports;
      new PostMachine({
        1: [mark(2), right(5)],
        2: stop,
      })
    `;
    const diags = crossRefAll(src, 'post');
    expect(diags).toHaveLength(2);
    expect(diags.map((d) => d.message)).toEqual([
      'indexed form not allowed inside grouped instructions',
      'indexed form not allowed inside grouped instructions',
    ]);
  });
});
