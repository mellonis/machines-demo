// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { mapToolchainDiagnostics } from './lint.ts';
import type { Diagnostic } from '../types.ts';

const diag = (over: Partial<Diagnostic>): Diagnostic => ({ code: 'x', severity: 'warning', from: 0, to: 1, message: 'm', ...over });

describe('mapToolchainDiagnostics', () => {
  it('T-lint-map: positions, severity and code carry over', () => {
    const [d] = mapToolchainDiagnostics([diag({ from: 2, to: 5, severity: 'error', code: 'unknown-mnemonic', message: 'bad' })], 10);
    expect(d).toMatchObject({ from: 2, to: 5, severity: 'error', message: 'bad', source: 'unknown-mnemonic' });
  });
  it('T-lint-clamp: positions past the document clamp to its length', () => {
    const [d] = mapToolchainDiagnostics([diag({ from: 8, to: 50 })], 10);
    expect(d.from).toBe(8); expect(d.to).toBe(10);
  });
  it('T-lint-fix-action: a fix becomes an action that applies its edits; maybeIncorrect is labelled', () => {
    const raw = diag({ from: 4, to: 6, fix: { description: "remove the label prefix '1:'", applicability: 'maybeIncorrect', edits: [{ from: 4, to: 6, replacement: '' }] } });
    const [d] = mapToolchainDiagnostics([raw], 20);
    expect(d.actions?.[0].name).toBe("remove the label prefix '1:' (may be incorrect)");
    const view = new EditorView({ state: EditorState.create({ doc: 'abcd1:efg' }) });
    d.actions![0].apply(view, 4, 6);
    expect(view.state.doc.toString()).toBe('abcdefg');
    view.destroy();
  });
  it('T-lint-fix-machine-applicable: no suffix on a machineApplicable fix', () => {
    const [d] = mapToolchainDiagnostics([diag({ fix: { description: 'sort', applicability: 'machineApplicable', edits: [] } })], 5);
    expect(d.actions?.[0].name).toBe('sort');
  });
});
