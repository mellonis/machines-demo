import { describe, it, expect } from 'vitest';
import { collectScope } from './crossRef.ts';
import { syntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import type { SyntaxNode } from '@lezer/common';

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
    expect([...scope.topLevel].sort((a, b) => a - b)).toEqual([10, 20, 30]);
    expect(scope.subroutines.size).toBe(0);
  });

  it('S-cref-scope-string-keys-collected-as-subroutines', () => {
    const { node, state } = firstObjectExpression(`({ rightToBlank: { 1: x, 2: y, 3: z }, 10: a })`);
    const scope = collectScope(node, state);
    expect([...scope.topLevel].sort((a, b) => a - b)).toEqual([10]);
    expect([...scope.subroutines.keys()]).toEqual(['rightToBlank']);
    const subKeys = scope.subroutines.get('rightToBlank')!;
    expect([...subKeys].sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('S-cref-scope-quoted-string-keys-handled', () => {
    const { node, state } = firstObjectExpression(`({ 'subA': { 1: a }, 'subB': { 2: b }, 10: c })`);
    const scope = collectScope(node, state);
    expect([...scope.subroutines.keys()].sort()).toEqual(['subA', 'subB']);
    expect([...scope.topLevel]).toEqual([10]);
  });

  it('S-cref-scope-array-group-values-still-contribute-index', () => {
    const { node, state } = firstObjectExpression(`({ 1: [a, b], 2: c })`);
    const scope = collectScope(node, state);
    expect([...scope.topLevel].sort((a, b) => a - b)).toEqual([1, 2]);
  });

  it('S-cref-scope-empty', () => {
    const { node, state } = firstObjectExpression(`({})`);
    const scope = collectScope(node, state);
    expect(scope.topLevel.size).toBe(0);
    expect(scope.subroutines.size).toBe(0);
  });
});
