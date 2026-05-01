import { javascriptLanguage, localCompletionSource } from '@codemirror/lang-javascript';
import * as turingNs from '@turing-machine-js/machine';
import * as postNs from '@post-machine-js/machine';
import type { Completion, CompletionContext } from '@codemirror/autocomplete';
import type { Engine } from './types.ts';

type Entry = { label: string; type: 'class' | 'function' | 'variable' };

function buildCompletions(ns: Record<string, unknown>): Completion[] {
  return Object.keys(ns)
    .filter((k) => k !== 'default')
    .sort()
    .map((name): Completion => {
      const v = ns[name];
      let type: Entry['type'] = 'variable';
      if (typeof v === 'function') {
        type = /^[A-Z]/.test(name) ? 'class' : 'function';
      }
      // Boost: machine-namespace identifiers rank above generic JS keywords.
      // User-defined locals (from localCompletionSource) get default boost (0)
      // and rank between machine names and built-in keywords.
      return { label: name, type, boost: 99 };
    });
}

const COMPLETIONS: Record<Engine, Completion[]> = {
  turing: buildCompletions(turingNs as Record<string, unknown>),
  post: buildCompletions(postNs as Record<string, unknown>),
};

/**
 * Three completion sources, in priority order:
 *   - machine namespace exports (boost 99, top of the list)
 *   - user-defined identifiers from the current document (default boost)
 *   - JS built-in keywords / snippets (lowest)
 */
export function importsCompletion(engine: Engine) {
  const options = COMPLETIONS[engine];
  return [
    javascriptLanguage.data.of({
      autocomplete: (ctx: CompletionContext) => {
        const word = ctx.matchBefore(/[\w$]+/);
        if (!word || (word.from === word.to && !ctx.explicit)) return null;
        return { from: word.from, options, validFor: /^[\w$]*$/ };
      },
    }),
    javascriptLanguage.data.of({ autocomplete: localCompletionSource }),
  ];
}
