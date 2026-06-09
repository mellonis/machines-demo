import { syntaxTree } from '@codemirror/language';
import type { Completion, CompletionContext } from '@codemirror/autocomplete';
import type { SyntaxNode } from '@lezer/common';
import type { CompletionSourceFactory, Env } from './types.ts';
import type { ShapeSpec, TypeRef } from '../schema/types.ts';

function nameText(node: SyntaxNode, ctx: CompletionContext): string {
  return ctx.state.doc.sliceString(node.from, node.to);
}

type Frame = { shape: ShapeSpec; existing: Set<string> };

type StackItem =
  | { kind: 'object'; existing: Set<string> }
  | { kind: 'array' }
  | { kind: 'property'; key: string };

function buildStack(obj: SyntaxNode, ctx: CompletionContext): { stack: StackItem[]; newExpr: SyntaxNode | null } {
  const stack: StackItem[] = [];
  let cursor: SyntaxNode | null = obj;
  let newExpr: SyntaxNode | null = null;
  while (cursor) {
    if (cursor.name === 'ObjectExpression') {
      const existing = new Set<string>();
      let prop = cursor.firstChild;
      while (prop) {
        if (prop.name === 'Property') {
          const k = prop.firstChild;
          if (k && (k.name === 'PropertyName' || k.name === 'VariableName' || k.name === 'PropertyDefinition')) {
            existing.add(nameText(k, ctx));
          }
        }
        prop = prop.nextSibling;
      }
      stack.unshift({ kind: 'object', existing });
    } else if (cursor.name === 'ArrayExpression') {
      stack.unshift({ kind: 'array' });
    } else if (cursor.name === 'Property') {
      const k = cursor.firstChild;
      const key = k ? nameText(k, ctx) : '';
      stack.unshift({ kind: 'property', key });
    } else if (cursor.name === 'NewExpression') {
      newExpr = cursor;
      break;
    } else if (cursor.name === 'CallExpression') {
      return { stack: [], newExpr: null };
    }
    cursor = cursor.parent;
  }
  return { stack, newExpr };
}

function resolveTypeToShape(t: TypeRef, env: Env): ShapeSpec | null {
  if (t.kind === 'shape') return env.schema.shapes[t.name] ?? null;
  if (t.kind === 'array') return resolveTypeToShape(t.of, env);
  return null;
}

function resolveNestedShape(ctx: CompletionContext, env: Env): Frame | null {
  const tree = syntaxTree(ctx.state);
  let obj: SyntaxNode | null = tree.resolveInner(ctx.pos, -1);
  while (obj && obj.name !== 'ObjectExpression') obj = obj.parent;
  if (!obj) return null;

  const { stack, newExpr } = buildStack(obj, ctx);
  if (!newExpr) return null;

  const callee = newExpr.firstChild?.nextSibling;
  if (!callee || callee.name !== 'VariableName') return null;
  const className = nameText(callee, ctx);
  const cls = env.schema.classes[className];
  if (!cls?.ctor) return null;

  let shape: ShapeSpec | null;
  let dictionaryEntry = false;

  if (cls.ctor.optionsShape) {
    shape = env.schema.shapes[cls.ctor.optionsShape] ?? null;
  } else {
    const firstParam = cls.ctor.params[0];
    if (firstParam?.type.kind === 'shape') {
      shape = env.schema.shapes[firstParam.type.name] ?? null;
      dictionaryEntry = true;
    } else {
      return null;
    }
  }
  if (!shape) return null;

  let topFrameExisting = new Set<string>();

  for (const item of stack) {
    if (item.kind === 'object') {
      topFrameExisting = item.existing;
    } else if (item.kind === 'property') {
      if (dictionaryEntry) {
        dictionaryEntry = false;
        continue;
      }
      const member = shape.keys.find((k) => k.name === item.key);
      if (!member) return null;
      shape = resolveTypeToShape(member.type, env);
      if (!shape) return null;
    }
    // array items are pass-through; the prior property step already descended into the element shape
  }

  return { shape, existing: topFrameExisting };
}

export const optionsBag: CompletionSourceFactory = (env) => (ctx) => {
  const frame = resolveNestedShape(ctx, env);
  if (!frame) return null;
  const word = ctx.matchBefore(/[\w$]*/);
  const options: Completion[] = frame.shape.keys
    .filter((k) => !frame.existing.has(k.name))
    .map<Completion>((k) => ({ label: k.name, type: 'property', detail: k.detail, boost: 90 }));
  return { from: word?.from ?? ctx.pos, options, validFor: /^[\w$]*$/ };
};
