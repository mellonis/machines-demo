import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { stdCompletionSource } from './stdCompletion.ts';
import type { StdExport } from '../toolchainHelpers.ts';

const EXPORTS: StdExport[] = [
  { name: 'goToEnd', kind: 'function', line: 13, detail: 'goToEnd()', doc: 'Walk right to the first blank.' },
  { name: 'goToBegin', kind: 'function', line: 21, detail: 'goToBegin()', doc: null },
  { name: 'symbols', kind: 'alphabet', line: 53, detail: "alphabet symbols { '_', '^', '$', '0', '1' }", doc: null },
];

// stdCompletionSource is typed as CompletionSource (CodeMirror's alias
// includes an async variant), but this implementation is synchronous — cast
// away the Promise branch the real return value never takes.
function at(marked: string): CompletionResult | null {
  const pos = marked.indexOf('▮');
  const doc = marked.slice(0, pos) + marked.slice(pos + 1);
  const state = EditorState.create({ doc, selection: { anchor: pos } });
  return stdCompletionSource(() => EXPORTS)(new CompletionContext(state, pos, true)) as CompletionResult | null;
}

describe('std:: completion', () => {
  it('T-stdcomp-activates: only after `std::`', () => {
    expect(at('    1: @std::▮')).not.toBeNull();
    expect(at('    1: @st▮')).toBeNull();
    expect(at('call std::go▮')).not.toBeNull();
  });
  it('T-stdcomp-options: one option per export with detail / info, from after the `::`', () => {
    const r = at('@std::go▮')!;
    expect(r.from).toBe('@std::'.length);
    expect(r.options.map((o) => o.label)).toEqual(['goToEnd', 'goToBegin', 'symbols']);
    expect(r.options[0]).toMatchObject({ type: 'function', detail: 'goToEnd()', info: 'Walk right to the first blank.' });
    expect(r.options[2].type).toBe('class');
  });
});
