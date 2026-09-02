// Cmd/Ctrl-click on a `std::name` reference opens the stdlib tab at its
// definition (the orchestrator does the tab switch and the search).
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

const REF = /std::([A-Za-z_][A-Za-z0-9_]*)/g;

export function stdNameAt(text: string, pos: number): string | null {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  let lineEnd = text.indexOf('\n', pos);
  if (lineEnd === -1) lineEnd = text.length;
  const line = text.slice(lineStart, lineEnd);
  const col = pos - lineStart;
  for (const m of line.matchAll(REF)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    if (col >= start && col <= end) return m[1];
  }
  return null;
}

export function stdLink(onGoTo: (name: string) => void): Extension {
  return EditorView.domEventHandlers({
    mousedown(e, view) {
      if (!(e.metaKey || e.ctrlKey)) return false;
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
      if (pos === null) return false;
      const name = stdNameAt(view.state.doc.toString(), pos);
      if (!name) return false;
      e.preventDefault();
      onGoTo(name);
      return true;
    },
  });
}
