import { syntaxTree } from '@codemirror/language';
import { linter, type Diagnostic } from '@codemirror/lint';
import type { EditorState, Extension } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import type { Env } from '../contexts/types.ts';
import { resolveCallee } from '../hints/signature.ts';
import { inferLocalsFor } from '../scan/locals.ts';
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
  // Count expression children — anything that isn't `(`, `)`, or `,`. Trailing
  // commas (allowed in JS arg lists since ES2017) don't contribute another
  // arg; counting commas + 1 would inflate `f(a,)` to 2.
  let count = 0;
  let child = argList.firstChild;
  while (child) {
    if (child.name !== '(' && child.name !== ')' && child.name !== ',') count += 1;
    child = child.nextSibling;
  }
  return count;
}

function requiredCount(params: ParamSpec[]): number {
  return params.filter((p) => p.optional !== true).length;
}

function pluralArg(n: number): string {
  return n === 1 ? 'argument' : 'arguments';
}

function calleeIdentifier(call: SyntaxNode, state: EditorState): { typed: string; receiverShape: 'bare' | 'member' | 'new' | 'other' } | null {
  if (call.name === 'NewExpression') {
    // Walk past `new` keyword to the VariableName, mirroring signature.ts.
    const first = call.firstChild;
    if (!first) return null;
    const ident = first.name === 'VariableName' ? first : first.nextSibling;
    if (!ident || ident.name !== 'VariableName') return null;
    return { typed: state.doc.sliceString(ident.from, ident.to), receiverShape: 'new' };
  }
  const callee = call.firstChild;
  if (!callee) return null;
  if (callee.name === 'VariableName') {
    return { typed: state.doc.sliceString(callee.from, callee.to), receiverShape: 'bare' };
  }
  if (callee.name === 'MemberExpression') {
    return { typed: state.doc.sliceString(callee.from, callee.to), receiverShape: 'member' };
  }
  return { typed: '', receiverShape: 'other' };
}

function originalImportName(alias: string, env: Env, state: EditorState): string | null {
  const { importsBinding } = inferLocalsFor(state, env.schema);
  if (importsBinding.kind !== 'present') return null;
  for (const [original, local] of importsBinding.renames) {
    if (local === alias) return original;
  }
  return null;
}

function bareOnlyDiagnostic(call: SyntaxNode, state: EditorState, env: Env): Diagnostic | null {
  const ident = calleeIdentifier(call, state);
  if (!ident || ident.receiverShape !== 'bare') return null;
  const typed = ident.typed;
  const schemaName = env.schema.namespace[typed] ? typed : (originalImportName(typed, env, state) ?? typed);
  const entry = env.schema.namespace[schemaName];
  if (!entry) return null;
  if (entry.kind !== 'post-instruction') return null;
  if (entry.params) return null; // has a callable form; arity check handles it
  return {
    from: call.from,
    to: call.to,
    severity: 'error',
    message: `${typed} has no callable form (use bare \`${schemaName}\` instead)`,
  };
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

      const bareOnly = bareOnlyDiagnostic(call, state, env);
      if (bareOnly) {
        diagnostics.push(bareOnly);
        return; // don't also try arity check — resolveCallee returns null here anyway
      }

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

      if (actual > resolved.params.length) {
        diagnostics.push({
          from: call.from,
          to: call.to,
          severity: 'warning',
          message: `${resolved.header} takes ${resolved.params.length} ${pluralArg(resolved.params.length)} (got ${actual})`,
        });
      }
    },
  });

  return diagnostics;
}

export function argCountLinter(env: Env): Extension {
  return linter((view) => computeArgCountDiagnostics(view.state, env));
}
