import { syntaxTree } from '@codemirror/language';
import type { Completion, CompletionContext } from '@codemirror/autocomplete';
import type { SyntaxNode } from '@lezer/common';
import type { CompletionSourceFactory } from './types.ts';
import { inferLocalsFor } from '../scan/locals.ts';

type DebugContext =
  | { kind: 'rhs'; ident: string; isHalt: boolean }
  | { kind: 'keys'; ident: string; existing: Set<string> }
  | null;

function nameText(node: SyntaxNode, ctx: CompletionContext): string {
  return ctx.state.doc.sliceString(node.from, node.to);
}

function findDebugAssignment(ctx: CompletionContext): DebugContext {
  const tree = syntaxTree(ctx.state);
  let node: SyntaxNode | null = tree.resolveInner(ctx.pos, -1);
  while (node && node.name !== 'AssignmentExpression') node = node.parent;
  if (!node) return null;

  const lhs = node.firstChild;
  if (!lhs || lhs.name !== 'MemberExpression') return null;
  const left = lhs.firstChild;
  const dotProp = lhs.lastChild;
  if (!left || left.name !== 'VariableName') return null;
  if (!dotProp || dotProp.name !== 'PropertyName') return null;
  if (nameText(dotProp, ctx) !== 'debug') return null;

  const ident = nameText(left, ctx);
  const isHalt = ident === 'haltState';

  const rhs = lhs.nextSibling?.nextSibling;
  if (rhs && rhs.name === 'ObjectExpression' && ctx.pos > rhs.from && ctx.pos < rhs.to) {
    const existing = new Set<string>();
    let prop = rhs.firstChild;
    while (prop) {
      if (prop.name === 'Property') {
        const key = prop.firstChild;
        if (key && (key.name === 'PropertyName' || key.name === 'PropertyDefinition' || key.name === 'VariableName')) {
          existing.add(nameText(key, ctx));
        }
      }
      prop = prop.nextSibling;
    }
    return { kind: 'keys', ident, existing };
  }

  return { kind: 'rhs', ident, isHalt };
}

function rhsOptions(isHalt: boolean): Completion[] {
  const base: Completion[] = [
    { label: 'true', type: 'keyword', boost: 99 },
    { label: 'false', type: 'keyword', boost: 98 },
  ];
  if (isHalt) return base;
  return [
    ...base,
    { label: '{ before: true }', type: 'text', apply: '{ before: true }', boost: 95 },
    { label: '{ after: true }', type: 'text', apply: '{ after: true }', boost: 94 },
    { label: '{ before: true, after: true }', type: 'text', apply: '{ before: true, after: true }', boost: 93 },
  ];
}

export const debugAssignment: CompletionSourceFactory = (env) => (ctx) => {
  const detected = findDebugAssignment(ctx);
  if (!detected) return null;

  const { locals } = inferLocalsFor(ctx.state, env.schema);
  const t = locals.get(detected.ident);
  const isStateOrHalt = detected.ident === 'haltState' || (t?.kind === 'class' && t.name === 'State');
  if (!isStateOrHalt) return null;

  if (detected.kind === 'rhs') {
    const options = rhsOptions(detected.isHalt);
    const word = ctx.matchBefore(/[\w${}\s]*/);
    return { from: word?.from ?? ctx.pos, options, validFor: /^[\w${}\s]*$/ };
  }

  const all = env.schema.shapes.StateDebug.keys;
  const options = all
    .filter((k) => !detected.existing.has(k.name))
    .map<Completion>((k) => ({ label: k.name, type: 'property', detail: k.detail, boost: 99 }));
  const word = ctx.matchBefore(/[\w$]*/);
  return { from: word?.from ?? ctx.pos, options, validFor: /^[\w$]*$/ };
};
