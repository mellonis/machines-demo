import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import type { Env } from '../contexts/types.ts';
import type { ResolvedCallee, SignatureInfo } from './types.ts';
import { formatTypeRef } from './format.ts';

function findEnclosingArgList(state: EditorState, pos: number): SyntaxNode | null {
  const tree = syntaxTree(state);
  let node: SyntaxNode | null = tree.resolveInner(pos, -1);
  while (node) {
    if (node.name === 'ArgList') return node;
    node = node.parent;
  }
  return null;
}

function text(node: SyntaxNode, state: EditorState): string {
  return state.doc.sliceString(node.from, node.to);
}

function activeArgIndex(argList: SyntaxNode, pos: number): number {
  let commas = 0;
  let child = argList.firstChild;
  while (child) {
    if (child.name === ',' && child.to <= pos) commas += 1;
    child = child.nextSibling;
  }
  return commas;
}

function resolveCallee(argList: SyntaxNode, state: EditorState, env: Env): ResolvedCallee | null {
  const call = argList.parent;
  if (!call) return null;
  if (call.name !== 'CallExpression' && call.name !== 'NewExpression') return null;

  const callee = call.firstChild;
  if (!callee) return null;
  if (callee === argList) return null;

  if (call.name === 'CallExpression' && callee.name === 'VariableName') {
    const name = text(callee, state);
    const entry = env.schema.namespace[name];
    if (!entry) return null;
    if (entry.kind === 'function') {
      return { params: entry.params, header: name };
    }
    return null;
  }

  return null;
}

export function computeSignatureInfo(state: EditorState, env: Env): SignatureInfo | null {
  const pos = state.selection.main.head;
  const argList = findEnclosingArgList(state, pos);
  if (!argList) return null;

  const resolved = resolveCallee(argList, state, env);
  if (!resolved) return null;
  if (resolved.params.length === 0) return null;

  const activeIndex = activeArgIndex(argList, pos);
  if (activeIndex >= resolved.params.length) return null;

  const params = resolved.params.map((p) => ({
    name: p.name,
    typeStr: formatTypeRef(p.type),
    optional: p.optional === true,
  }));

  return {
    header: resolved.header,
    params,
    activeIndex,
    anchor: argList.from,
  };
}
