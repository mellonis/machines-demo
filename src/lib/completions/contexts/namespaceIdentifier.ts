import { syntaxTree } from '@codemirror/language';
import { snippet, type Completion } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import type { CompletionContext } from '@codemirror/autocomplete';
import type { CompletionSourceFactory, Env } from './types.ts';
import { inferLocalsFor } from '../scan/locals.ts';
import type { NamespaceEntry, ParamSpec } from '../schema/types.ts';
import { applyAutoImport, computeDestructureChange } from '../apply/import.ts';

function nsEntryTypeForLabel(entry: NamespaceEntry): Completion['type'] {
  switch (entry.kind) {
    case 'class':            return 'class';
    case 'function':         return 'function';
    case 'singleton':        return 'variable';
    case 'constants':        return 'namespace';
    case 'symbol':           return 'variable';
    case 'post-instruction': return entry.params ? 'function' : 'variable';
  }
}

function isNewExprCallee(ctx: CompletionContext, wordFrom: number): boolean {
  const tree = syntaxTree(ctx.state);
  const node = tree.resolveInner(wordFrom, 1);
  let p = node.parent;
  while (p && p.name !== 'NewExpression') p = p.parent;
  if (!p) return false;
  const callee = p.firstChild?.nextSibling;
  return callee?.from === node.from;
}

function classSnippetBody(name: string, env: Env): string {
  const cls = env.schema.classes[name];
  if (!cls?.ctor?.optionsShape) return `${name}(\${1})`;
  const shape = env.schema.shapes[cls.ctor.optionsShape];
  if (!shape?.keys.length) return `${name}({ \${1} })`;
  const first = shape.keys[0];
  return `${name}({ ${first.name}: \${1:${first.name}} })`;
}

function postInstrSnippetBody(name: string, params: ParamSpec[]): string {
  const slots = params
    .filter((p) => !p.optional)
    .map((p, i) => `\${${i + 1}:${p.name}}`)
    .join(', ');
  if (!slots) return name;
  return `${name}(${slots})`;
}

export const namespaceIdentifier: CompletionSourceFactory = (env) => (ctx) => {
  const word = ctx.matchBefore(/[\w$]+/);
  if (!word || word.from === word.to) return null;

  const tree = syntaxTree(ctx.state);
  const node = tree.resolveInner(ctx.pos, -1);
  if (node.parent?.name === 'MemberExpression' && node.parent.firstChild !== node) {
    return null;
  }

  const { importsBinding } = inferLocalsFor(ctx.state, env.schema);
  const boundNames =
    importsBinding.kind === 'present' ? importsBinding.boundNames : new Set<string>();
  const renames =
    importsBinding.kind === 'present' ? importsBinding.renames : new Map<string, string>();

  const options: Completion[] = [];
  for (const [name, entry] of Object.entries(env.schema.namespace)) {
    const renamedTo = renames.get(name);
    if (renamedTo) {
      options.push({
        label: name,
        type: nsEntryTypeForLabel(entry),
        detail: `${entry.detail} (as ${renamedTo})`,
        boost: 99,
        apply: renamedTo,
      });
      options.push({
        label: renamedTo,
        type: nsEntryTypeForLabel(entry),
        detail: `${entry.detail} (alias of ${name})`,
        boost: 99,
      });
      continue;
    }
    if (boundNames.has(name)) {
      const snippetBodyDestructured: string | null =
        entry.kind === 'class' && isNewExprCallee(ctx, word.from)
          ? classSnippetBody(name, env)
          : entry.kind === 'post-instruction' && entry.params
          ? postInstrSnippetBody(name, entry.params)
          : null;

      options.push({
        label: name,
        type: nsEntryTypeForLabel(entry),
        detail: entry.detail,
        boost: 99,
        ...(snippetBodyDestructured
          ? {
              apply: (view: EditorView, completion: Completion, from: number, to: number) => {
                snippet(snippetBodyDestructured)(view, completion, from, to);
              },
            }
          : {}),
      });
    } else {
      const isNewCallee = isNewExprCallee(ctx, word.from);
      const snippetBody: string | null =
        entry.kind === 'class' && isNewCallee
          ? classSnippetBody(name, env)
          : entry.kind === 'post-instruction' && entry.params
          ? postInstrSnippetBody(name, entry.params)
          : null;

      options.push({
        label: name,
        type: nsEntryTypeForLabel(entry),
        detail: `${entry.detail} (import)`,
        boost: 80,
        apply: snippetBody
          ? (view: EditorView, completion: Completion, from: number, to: number) => {
              const destructureChange = computeDestructureChange(view, name, env.schema);
              if (destructureChange) {
                view.dispatch({ changes: [destructureChange], userEvent: 'input.complete' });
              }
              snippet(snippetBody)(view, completion, from, to);
            }
          : (view: EditorView, completion: Completion, from: number, to: number) => {
              applyAutoImport(view, completion, from, to, name, env.schema);
            },
      });
    }
  }

  return { from: word.from, options, validFor: /^[\w$]*$/ };
};
