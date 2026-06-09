import { syntaxTree } from '@codemirror/language';
import { linter, type Diagnostic } from '@codemirror/lint';
import type { EditorState, Extension } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import type { Env } from '../contexts/types.ts';
import { resolveCallee } from '../hints/signature.ts';
import type { ParamSpec } from '../schema/types.ts';

function findArgListChild(call: SyntaxNode): SyntaxNode | null {
  let child = call.firstChild;
  while (child) {
    if (child.name === 'ArgList') return child;
    child = child.nextSibling;
  }
  return null;
}

function actualArgCount(argList: SyntaxNode): number {
  let commas = 0;
  let hasExpr = false;
  let child = argList.firstChild;
  while (child) {
    if (child.name === ',') commas += 1;
    else if (child.name !== '(' && child.name !== ')') hasExpr = true;
    child = child.nextSibling;
  }
  return hasExpr ? commas + 1 : 0;
}

function requiredCount(params: ParamSpec[]): number {
  return params.filter((p) => p.optional !== true).length;
}

function pluralArg(n: number): string {
  return n === 1 ? 'argument' : 'arguments';
}

export function computeArgCountDiagnostics(state: EditorState, env: Env): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const tree = syntaxTree(state);

  tree.iterate({
    enter(node) {
      if (node.name !== 'CallExpression' && node.name !== 'NewExpression') return;
      const call = node.node;
      const argList = findArgListChild(call);
      if (!argList) return;
      const resolved = resolveCallee(argList, state, env);
      if (!resolved) return;

      const actual = actualArgCount(argList);
      const required = requiredCount(resolved.params);

      if (actual < required) {
        diagnostics.push({
          from: call.from,
          to: call.to,
          severity: 'error',
          message: `${resolved.header} requires ${required} ${pluralArg(required)} (got ${actual})`,
        });
      }
    },
  });

  return diagnostics;
}

export function argCountLinter(env: Env): Extension {
  return linter((view) => computeArgCountDiagnostics(view.state, env));
}
