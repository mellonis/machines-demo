import { syntaxTree } from '@codemirror/language';
import type { Completion } from '@codemirror/autocomplete';
import type { CompletionSourceFactory } from './types.ts';
import { inferLocalsFor } from '../scan/locals.ts';
import type { NamespaceEntry } from '../schema/types.ts';

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
        label: renamedTo,
        type: nsEntryTypeForLabel(entry),
        detail: `${entry.detail} — ${name} (as ${renamedTo})`,
        boost: 99,
      });
      continue;
    }
    if (boundNames.has(name)) {
      options.push({
        label: name,
        type: nsEntryTypeForLabel(entry),
        detail: entry.detail,
        boost: 99,
      });
    } else {
      options.push({
        label: name,
        type: nsEntryTypeForLabel(entry),
        detail: `${entry.detail} (import)`,
        boost: 80,
      });
    }
  }

  return { from: word.from, options, validFor: /^[\w$]*$/ };
};
