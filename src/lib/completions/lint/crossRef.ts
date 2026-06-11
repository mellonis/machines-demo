import { syntaxTree } from '@codemirror/language';
import { linter, type Diagnostic } from '@codemirror/lint';
import type { EditorState, Extension } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import type { Env } from '../contexts/types.ts';

export type LocalScope = ReadonlySet<number>;

export type Scope = {
  topLevel: LocalScope;
  subroutines: ReadonlyMap<string, LocalScope>;
};

function text(node: SyntaxNode, state: EditorState): string {
  return state.doc.sliceString(node.from, node.to);
}

// Probe-confirmed Lezer node names for property keys:
//   Numeric key (e.g. `10:`) → name === 'Number'
//   Quoted string key (e.g. `'foo':`) → name === 'String'
//   Bare identifier key (e.g. `bar:`) → name === 'PropertyDefinition'

function parseNumericKey(keyNode: SyntaxNode, state: EditorState): number | null {
  if (keyNode.name !== 'Number') return null;
  const n = Number(text(keyNode, state));
  return Number.isFinite(n) ? n : null;
}

function parseStringKey(keyNode: SyntaxNode, state: EditorState): string | null {
  if (keyNode.name === 'PropertyDefinition') return text(keyNode, state);
  if (keyNode.name === 'String') {
    const raw = text(keyNode, state);
    if (raw.length < 2) return null;
    const quote = raw[0];
    if ((quote === `'` || quote === `"` || quote === '`') && raw.endsWith(quote)) {
      return raw.slice(1, -1);
    }
    return null;
  }
  return null;
}

function indicesOf(objExpr: SyntaxNode, state: EditorState): Set<number> {
  const indices = new Set<number>();
  let prop = objExpr.firstChild;
  while (prop) {
    if (prop.name === 'Property') {
      const k = prop.firstChild;
      if (k) {
        const asNum = parseNumericKey(k, state);
        if (asNum !== null) indices.add(asNum);
      }
    }
    prop = prop.nextSibling;
  }
  return indices;
}

export function collectScope(objExpr: SyntaxNode, state: EditorState): Scope {
  const topLevel = new Set<number>();
  const subroutines = new Map<string, Set<number>>();

  let prop = objExpr.firstChild;
  while (prop) {
    if (prop.name === 'Property') {
      const k = prop.firstChild;
      if (k) {
        const asNum = parseNumericKey(k, state);
        if (asNum !== null) {
          topLevel.add(asNum);
        } else {
          const asStr = parseStringKey(k, state);
          if (asStr !== null) {
            const v = prop.lastChild;
            if (v && v.name === 'ObjectExpression') {
              subroutines.set(asStr, indicesOf(v, state));
            } else {
              subroutines.set(asStr, new Set());
            }
          }
        }
      }
    }
    prop = prop.nextSibling;
  }

  return { topLevel, subroutines };
}

export function computeCrossRefDiagnostics(state: EditorState, env: Env): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  // Walker lands in Task 3.
  void syntaxTree;
  void state;
  void env;
  return diagnostics;
}

export function crossRefLinter(env: Env): Extension {
  return linter((view) => computeCrossRefDiagnostics(view.state, env));
}
