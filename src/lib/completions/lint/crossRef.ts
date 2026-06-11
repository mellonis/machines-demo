import { syntaxTree } from '@codemirror/language';
import { linter, type Diagnostic } from '@codemirror/lint';
import type { EditorState, Extension } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import type { Env } from '../contexts/types.ts';
import { inferLocalsFor } from '../scan/locals.ts';

export type ScopeNode = {
  indices: ReadonlySet<number>;
  subroutines: ReadonlyMap<string, ScopeNode>;
};

export type ScopeChain = ReadonlyArray<ScopeNode>;

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

/**
 * Recursively builds a ScopeNode from an ObjectExpression. Subroutines may
 * nest — a subroutine body can itself contain string-keyed subroutines, and
 * `call(name)` later resolves names by walking the scope chain local-to-root.
 */
export function collectScope(objExpr: SyntaxNode, state: EditorState): ScopeNode {
  const indices = new Set<number>();
  const subroutines = new Map<string, ScopeNode>();

  let prop = objExpr.firstChild;
  while (prop) {
    if (prop.name === 'Property') {
      const k = prop.firstChild;
      if (k) {
        const asNum = parseNumericKey(k, state);
        if (asNum !== null) {
          indices.add(asNum);
        } else {
          const asStr = parseStringKey(k, state);
          if (asStr !== null) {
            const v = prop.lastChild;
            if (v && v.name === 'ObjectExpression') {
              subroutines.set(asStr, collectScope(v, state));
            } else {
              subroutines.set(asStr, { indices: new Set(), subroutines: new Map() });
            }
          }
        }
      }
    }
    prop = prop.nextSibling;
  }

  return { indices, subroutines };
}

/** Post-instruction names whose number params reference instruction indices in the CURRENT scope. */
const INDEXED_INSTRUCTIONS = new Set(['mark', 'erase', 'noop', 'left', 'right', 'check']);

function originalImportName(alias: string, env: Env, state: EditorState): string | null {
  const { importsBinding } = inferLocalsFor(state, env.schema);
  if (importsBinding.kind !== 'present') return null;
  for (const [original, local] of importsBinding.renames) {
    if (local === alias) return original;
  }
  return null;
}

function calleeSchemaName(call: SyntaxNode, state: EditorState, env: Env): string | null {
  // Only bare-VariableName CallExpressions resolve to schema names here.
  if (call.name !== 'CallExpression') return null;
  const callee = call.firstChild;
  if (!callee || callee.name !== 'VariableName') return null;
  const typed = text(callee, state);
  if (env.schema.namespace[typed]) return typed;
  return originalImportName(typed, env, state);
}

function argChildren(call: SyntaxNode): SyntaxNode[] {
  let argList = call.firstChild;
  while (argList && argList.name !== 'ArgList') argList = argList.nextSibling;
  if (!argList) return [];
  const args: SyntaxNode[] = [];
  let c = argList.firstChild;
  while (c) {
    if (c.name !== '(' && c.name !== ')' && c.name !== ',') args.push(c);
    c = c.nextSibling;
  }
  return args;
}

function parseNumberLiteral(node: SyntaxNode, state: EditorState): number | null {
  if (node.name !== 'Number') return null;
  const n = Number(text(node, state));
  return Number.isFinite(n) ? n : null;
}

function findPostMachineConstructors(state: EditorState, env: Env): SyntaxNode[] {
  const tree = syntaxTree(state);
  const found: SyntaxNode[] = [];
  tree.iterate({
    enter(node) {
      if (node.name !== 'NewExpression') return;
      const first = node.node.firstChild;
      if (!first) return;
      const ident = first.name === 'VariableName' ? first : first.nextSibling;
      if (!ident || ident.name !== 'VariableName') return;
      const typed = text(ident, state);
      const schemaName = env.schema.classes[typed]
        ? typed
        : originalImportName(typed, env, state);
      if (schemaName === 'PostMachine') found.push(node.node);
    },
  });
  return found;
}

function instructionsArgOf(newExpr: SyntaxNode): SyntaxNode | null {
  let argList = newExpr.firstChild;
  while (argList && argList.name !== 'ArgList') argList = argList.nextSibling;
  if (!argList) return null;
  let c = argList.firstChild;
  while (c) {
    if (c.name === 'ObjectExpression') return c;
    c = c.nextSibling;
  }
  return null;
}

function validateCall(
  call: SyntaxNode,
  chain: ScopeChain,
  state: EditorState,
  env: Env,
  diagnostics: Diagnostic[],
): void {
  const schemaName = calleeSchemaName(call, state, env);
  if (!schemaName) return;
  if (!INDEXED_INSTRUCTIONS.has(schemaName)) return;
  const local = chain[0];
  const args = argChildren(call);
  for (const arg of args) {
    const n = parseNumberLiteral(arg, state);
    if (n === null) continue; // non-literal — skip
    if (!local.indices.has(n)) {
      diagnostics.push({
        from: call.from,
        to: call.to,
        severity: 'error',
        message: `unknown instruction index: ${n}`,
      });
      return; // one diagnostic per call; don't fire twice for check(99, 99)
    }
  }
}

function walkObjectExpression(
  objExpr: SyntaxNode,
  chain: ScopeChain,
  state: EditorState,
  env: Env,
  diagnostics: Diagnostic[],
): void {
  let prop = objExpr.firstChild;
  while (prop) {
    if (prop.name === 'Property') {
      const v = prop.lastChild;
      if (v && v.name === 'CallExpression') {
        validateCall(v, chain, state, env, diagnostics);
      }
      // (ArrayExpression handling lands in Task 6; subroutine recursion in Task 5.)
    }
    prop = prop.nextSibling;
  }
}

export function computeCrossRefDiagnostics(state: EditorState, env: Env): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const ctors = findPostMachineConstructors(state, env);
  for (const ctor of ctors) {
    const objExpr = instructionsArgOf(ctor);
    if (!objExpr) continue;
    const root = collectScope(objExpr, state);
    walkObjectExpression(objExpr, [root], state, env, diagnostics);
  }
  return diagnostics;
}

export function crossRefLinter(env: Env): Extension {
  return linter((view) => computeCrossRefDiagnostics(view.state, env));
}
