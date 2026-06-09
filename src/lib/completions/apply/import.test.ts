// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { javascript } from '@codemirror/lang-javascript';
import { applyAutoImport } from './import.ts';
import { localsField } from '../scan/locals.ts';
import { getSchema } from '../schema/index.ts';
import type { Completion } from '@codemirror/autocomplete';

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

const dummy: Completion = { label: 'Alphabet' };

describe('applyAutoImport — present-block branch', () => {
  it('S-apply-import-present-singleline-mid-alpha', () => {
    const { view, cursor } = setup(`const { State, Tape } = imports;\nnew Alpha▮`);
    applyAutoImport(view, dummy, cursor - 'Alpha'.length, cursor, 'Alphabet', getSchema('turing'));
    expect(view.state.doc.toString()).toBe(`const { Alphabet, State, Tape } = imports;\nnew Alphabet`);
  });

  it('S-apply-import-present-empty-pattern', () => {
    const { view, cursor } = setup(`const {} = imports;\nnew Alpha▮`);
    applyAutoImport(view, dummy, cursor - 'Alpha'.length, cursor, 'Alphabet', getSchema('turing'));
    expect(view.state.doc.toString()).toBe(`const { Alphabet } = imports;\nnew Alphabet`);
  });

  it('S-apply-import-idempotent-name-already-bound', () => {
    const { view, cursor } = setup(`const { Alphabet } = imports;\nnew Alpha▮`);
    applyAutoImport(view, dummy, cursor - 'Alpha'.length, cursor, 'Alphabet', getSchema('turing'));
    expect(view.state.doc.toString()).toBe(`const { Alphabet } = imports;\nnew Alphabet`);
  });
});

describe('applyAutoImport — absent-block + multi-line', () => {
  it('S-apply-import-absent', () => {
    const { view, cursor } = setup(`// Task: count cells on the tape.\n\nconst a = new Alpha▮;`);
    applyAutoImport(view, dummy, cursor - 'Alpha'.length, cursor, 'Alphabet', getSchema('turing'));
    expect(view.state.doc.toString()).toBe(
      `// Task: count cells on the tape.\n\nconst { Alphabet } = imports;\nconst a = new Alphabet;`
    );
  });

  it('S-apply-import-absent-no-leading-comment', () => {
    const { view, cursor } = setup(`const a = new Alpha▮;`);
    applyAutoImport(view, dummy, cursor - 'Alpha'.length, cursor, 'Alphabet', getSchema('turing'));
    expect(view.state.doc.toString()).toBe(`const { Alphabet } = imports;\nconst a = new Alphabet;`);
  });

  it('S-apply-import-present-multiline-end', () => {
    const before = `const {\n  Alphabet,\n  State,\n  Tape,\n} = imports;\nnew Turin▮`;
    const { view, cursor } = setup(before);
    applyAutoImport(view, dummy, cursor - 'Turin'.length, cursor, 'TuringMachine', getSchema('turing'));
    expect(view.state.doc.toString()).toBe(
      `const {\n  Alphabet,\n  State,\n  Tape,\n  TuringMachine,\n} = imports;\nnew TuringMachine`
    );
  });

  it('S-apply-import-rename-suppresses-original', () => {
    const before = `const { State: TS, Tape } = imports;\nnew Stat▮`;
    const { view, cursor } = setup(before);
    applyAutoImport(view, dummy, cursor - 'Stat'.length, cursor, 'TS', getSchema('turing'));
    expect(view.state.doc.toString()).toBe(`const { State: TS, Tape } = imports;\nnew TS`);
  });
});
