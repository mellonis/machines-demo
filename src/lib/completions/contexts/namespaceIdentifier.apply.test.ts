// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { javascript } from '@codemirror/lang-javascript';
import { CompletionContext } from '@codemirror/autocomplete';
import { namespaceIdentifier } from './namespaceIdentifier.ts';
import { localsField } from '../scan/locals.ts';
import { getSchema } from '../schema/index.ts';
import type { Env } from './types.ts';

function setup(marked: string) {
  const cursor = marked.indexOf('▮');
  if (cursor === -1) throw new Error('marker missing');
  const doc = marked.slice(0, cursor) + marked.slice(cursor + 1);
  const state = EditorState.create({
    doc,
    extensions: [javascript(), localsField],
    selection: { anchor: cursor },
  });
  const view = new EditorView({ state });
  return { view, cursor };
}

describe('namespaceIdentifier — apply chains', () => {
  it('S-src-ns-apply-snippet-chained-absent — destructure-insert + snippet body correctly positioned', () => {
    const { view, cursor } = setup(`const a = new Alpha▮`);
    const env: Env = { engine: 'turing', schema: getSchema('turing') };
    const ctx = new CompletionContext(view.state, cursor, true);
    const result = namespaceIdentifier(env)(ctx);
    expect(result).not.toBeNull();
    const opt = result!.options.find((o) => o.label === 'Alphabet');
    expect(opt?.apply).toBeTypeOf('function');
    const wordFrom = cursor - 'Alpha'.length;
    (opt!.apply as (v: EditorView, c: unknown, from: number, to: number) => void)(view, opt!, wordFrom, cursor);
    const after = view.state.doc.toString();
    expect(after).toContain('const { Alphabet } = imports;');
    expect(after).toContain('new Alphabet(');
    expect(after).not.toContain('AlphabAlphabet');
  });
});
