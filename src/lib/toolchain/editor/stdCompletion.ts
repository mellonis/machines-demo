// `std::` completion over the standard library's exported names. The list is
// built from `stdlibSource` (the text the module links), so it cannot drift.
import { autocompletion, type CompletionSource } from '@codemirror/autocomplete';
import type { Extension } from '@codemirror/state';
import type { StdExport } from '../toolchainHelpers.ts';

export function stdCompletionSource(getExports: () => StdExport[]): CompletionSource {
  return (ctx) => {
    const m = ctx.matchBefore(/std::[A-Za-z0-9_]*/);
    if (!m) return null;
    return {
      from: m.from + 'std::'.length,
      validFor: /^[A-Za-z0-9_]*$/,
      options: getExports().map((e) => ({
        label: e.name,
        type: e.kind === 'alphabet' ? 'class' : 'function',
        detail: e.detail,
        ...(e.doc ? { info: e.doc } : {}),
      })),
    };
  };
}

export function stdCompletion(getExports: () => StdExport[]): Extension {
  return autocompletion({ override: [stdCompletionSource(getExports)] });
}
