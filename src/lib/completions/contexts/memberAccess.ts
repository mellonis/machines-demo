import { syntaxTree } from '@codemirror/language';
import type { Completion, CompletionContext } from '@codemirror/autocomplete';
import type { CompletionSourceFactory } from './types.ts';
import { inferLocalsFor } from '../scan/locals.ts';
import type { InferredType } from '../scan/types.ts';
import type { EngineSchema, NamespaceEntry } from '../schema/types.ts';

function leftIdentForDot(ctx: CompletionContext): string | null {
  const tree = syntaxTree(ctx.state);
  const node = tree.resolveInner(ctx.pos, -1);
  let memberExpr = node;
  while (memberExpr && memberExpr.name !== 'MemberExpression') {
    if (!memberExpr.parent) return null;
    memberExpr = memberExpr.parent;
  }
  if (memberExpr.name !== 'MemberExpression') return null;
  const left = memberExpr.firstChild;
  if (!left || left.name !== 'VariableName') return null;
  return ctx.state.doc.sliceString(left.from, left.to);
}

function namespaceEntryToType(name: string, schema: EngineSchema): InferredType | null {
  const entry: NamespaceEntry | undefined = schema.namespace[name];
  if (!entry) return null;
  if (entry.kind === 'class') return { kind: 'class', name: entry.classRef };
  if (entry.kind === 'constants') return { kind: 'constants', name: entry.constantsRef };
  if (entry.kind === 'singleton' && entry.type.kind === 'class') return { kind: 'class', name: entry.type.name };
  return null;
}

function buildOptions(t: InferredType, schema: EngineSchema): Completion[] | null {
  if (t.kind === 'class') {
    const cls = schema.classes[t.name];
    if (!cls || cls.members.length === 0) return null;
    return cls.members.map<Completion>((m) => ({
      label: m.name,
      type: m.kind === 'method' ? 'method' : 'property',
      detail: m.detail,
      boost: 99,
    }));
  }
  if (t.kind === 'constants') {
    const c = schema.constants[t.name];
    if (!c) return null;
    return c.keys.map<Completion>((k) => ({ label: k, type: 'variable', boost: 99 }));
  }
  return null;
}

export const memberAccess: CompletionSourceFactory = (env) => (ctx) => {
  const ident = leftIdentForDot(ctx);
  if (!ident) return null;

  const { locals } = inferLocalsFor(ctx.state, env.schema);
  const t = locals.get(ident) ?? namespaceEntryToType(ident, env.schema);
  if (!t) return null;

  const options = buildOptions(t, env.schema);
  if (!options) return null;

  const word = ctx.matchBefore(/[\w$]*/);
  return { from: word?.from ?? ctx.pos, options, validFor: /^[\w$]*$/ };
};
