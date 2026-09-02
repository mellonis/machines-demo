// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { ipHighlight, ipLineOf, showIp } from './ipHighlight.ts';

function make() {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return new EditorView({ parent, state: EditorState.create({ doc: 'a\nb\nc\n', extensions: [ipHighlight()] }) });
}

describe('ipHighlight', () => {
  it('T-ip-set: showIp decorates the line; null clears', () => {
    const view = make();
    showIp(view, 2);
    expect(ipLineOf(view.state)).toBe(2);
    expect(view.dom.querySelectorAll('.cm-ip-line').length).toBe(1);
    showIp(view, null);
    expect(ipLineOf(view.state)).toBeNull();
    expect(view.dom.querySelectorAll('.cm-ip-line').length).toBe(0);
    view.destroy();
  });
  it('T-ip-out-of-range: a line past the document clears instead of throwing', () => {
    const view = make();
    showIp(view, 99);
    expect(ipLineOf(view.state)).toBeNull();
    view.destroy();
  });
  it('T-ip-survives-edit: the decoration maps through an edit above it', () => {
    const view = make();
    showIp(view, 3);
    view.dispatch({ changes: { from: 0, insert: 'x\n' } });
    expect(view.dom.querySelectorAll('.cm-ip-line').length).toBe(1);
    view.destroy();
  });
});
