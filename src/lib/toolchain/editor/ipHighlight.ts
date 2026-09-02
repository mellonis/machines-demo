// Line decoration for the paused instruction pointer. Scrolls with
// `scrollTop` math (never `scrollIntoView`, which would yank the page —
// the same policy as ExecutionTraceTable.svelte).
import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

export const setIpLine = StateEffect.define<number | null>();

const ipLine = Decoration.line({ class: 'cm-ip-line' });

const ipField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setIpLine)) continue;
      const line = e.value;
      if (line === null || line < 1 || line > tr.state.doc.lines) { deco = Decoration.none; continue; }
      const from = tr.state.doc.line(line).from;
      deco = Decoration.set([ipLine.range(from)]);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function ipHighlight(): Extension {
  return ipField;
}

export function ipLineOf(state: EditorState): number | null {
  const set = state.field(ipField, false);
  if (!set || set.size === 0) return null;
  let pos = -1;
  set.between(0, state.doc.length, (from) => { pos = from; return false; });
  return pos < 0 ? null : state.doc.lineAt(pos).number;
}

export function showIp(view: EditorView, line: number | null): void {
  view.dispatch({ effects: setIpLine.of(line) });
  if (line === null || line < 1 || line > view.state.doc.lines) return;
  const pos = view.state.doc.line(line).from;
  const block = view.lineBlockAt(pos);
  const scroller = view.scrollDOM;
  const top = block.top - scroller.clientHeight / 2 + block.height / 2;
  scroller.scrollTop = Math.max(0, top);
}
