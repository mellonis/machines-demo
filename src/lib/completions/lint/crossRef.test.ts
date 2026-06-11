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
