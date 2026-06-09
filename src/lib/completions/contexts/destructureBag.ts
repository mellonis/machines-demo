import { syntaxTree } from '@codemirror/language';
import type { Completion, CompletionContext } from '@codemirror/autocomplete';
import type { SyntaxNode } from '@lezer/common';
import type { CompletionSourceFactory } from './types.ts';
import { inferLocalsFor } from '../scan/locals.ts';

type DestructureContext =
  | { kind: 'imports'; existing: Set<string> }
  | { kind: 'class'; className: string; existing: Set<string> }
  | null;

function nameText(node: SyntaxNode, ctx: CompletionContext): string {
  return ctx.state.doc.sliceString(node.from, node.to);
}

function findDestructure(ctx: CompletionContext): DestructureContext {
  const tree = syntaxTree(ctx.state);
  let node: SyntaxNode | null = tree.resolveInner(ctx.pos, -1);
  while (node && node.name !== 'ObjectPattern') node = node.parent;
  if (!node) return null;

  let decl: SyntaxNode | null = node.parent;
  while (decl && decl.name !== 'VariableDeclarator' && decl.name !== 'VariableDeclaration') decl = decl.parent;
  if (!decl) return null;

  let init: SyntaxNode | null = node.nextSibling;
  while (init && (init.name === '=' || init.name === 'Equals')) init = init.nextSibling;
  if (!init) return null;

  const existing = new Set<string>();
  let prop = node.firstChild;
  while (prop) {
    if (prop.name === 'PatternProperty' || prop.name === 'Property') {
      const k = prop.firstChild;
      if (k && (k.name === 'PropertyName' || k.name === 'VariableDefinition' || k.name === 'VariableName')) {
        existing.add(nameText(k, ctx));
      }
    }
    prop = prop.nextSibling;
  }

  if (init.name === 'VariableName' && nameText(init, ctx) === 'imports') {
    return { kind: 'imports', existing };
  }
  if (init.name === 'VariableName') {
    return { kind: 'class', className: nameText(init, ctx), existing };
  }
  return null;
}

export const destructureBag: CompletionSourceFactory = (env) => (ctx) => {
  const found = findDestructure(ctx);
  if (!found) return null;

  const word = ctx.matchBefore(/[\w$]*/);
  const from = word?.from ?? ctx.pos;

  if (found.kind === 'imports') {
    const options: Completion[] = Object.keys(env.schema.namespace)
      .filter((n) => !found.existing.has(n))
      .map((n) => ({ label: n, type: 'variable' as const, detail: env.schema.namespace[n].detail, boost: 90 }));
    return { from, options, validFor: /^[\w$]*$/ };
  }

  const { locals } = inferLocalsFor(ctx.state, env.schema);
  const t = locals.get(found.className);
  if (!t || t.kind !== 'class') return null;
  const cls = env.schema.classes[t.name];
  if (!cls) return null;
  const options: Completion[] = cls.members
    .filter((m) => !found.existing.has(m.name))
    .map<Completion>((m) => ({ label: m.name, type: m.kind === 'method' ? 'method' : 'property', detail: m.detail, boost: 90 }));
  return { from, options, validFor: /^[\w$]*$/ };
};
