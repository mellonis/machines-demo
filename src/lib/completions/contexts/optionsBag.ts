import { syntaxTree } from '@codemirror/language';
import type { Completion, CompletionContext } from '@codemirror/autocomplete';
import type { SyntaxNode } from '@lezer/common';
import type { CompletionSourceFactory } from './types.ts';

function nameText(node: SyntaxNode, ctx: CompletionContext): string {
  return ctx.state.doc.sliceString(node.from, node.to);
}

function findOptionsBagContext(ctx: CompletionContext): { className: string; existing: Set<string> } | null {
  const tree = syntaxTree(ctx.state);
  let obj: SyntaxNode | null = tree.resolveInner(ctx.pos, -1);
  while (obj && obj.name !== 'ObjectExpression') obj = obj.parent;
  if (!obj) return null;
  let p: SyntaxNode | null = obj.parent;
  while (p && p.name !== 'NewExpression' && p.name !== 'CallExpression') p = p.parent;
  if (!p || p.name !== 'NewExpression') return null;
  const callee = p.firstChild?.nextSibling;
  if (!callee || callee.name !== 'VariableName') return null;
  const className = nameText(callee, ctx);

  const existing = new Set<string>();
  let prop = obj.firstChild;
  while (prop) {
    if (prop.name === 'Property') {
      const k = prop.firstChild;
      if (k && (k.name === 'PropertyName' || k.name === 'VariableName' || k.name === 'PropertyDefinition')) {
        existing.add(nameText(k, ctx));
      }
    }
    prop = prop.nextSibling;
  }

  return { className, existing };
}

export const optionsBag: CompletionSourceFactory = (env) => (ctx) => {
  const found = findOptionsBagContext(ctx);
  if (!found) return null;
  const cls = env.schema.classes[found.className];
  if (!cls?.ctor?.optionsShape) return null;
  const shape = env.schema.shapes[cls.ctor.optionsShape];
  if (!shape) return null;

  const word = ctx.matchBefore(/[\w$]*/);
  const options: Completion[] = shape.keys
    .filter((k) => !found.existing.has(k.name))
    .map<Completion>((k) => ({ label: k.name, type: 'property', detail: k.detail, boost: 90 }));
  return { from: word?.from ?? ctx.pos, options, validFor: /^[\w$]*$/ };
};
