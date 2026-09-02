// Cmd/Ctrl-click on a stdlib reference opens the stdlib tab at its
// definition (the orchestrator does the tab switch and the search).
// Both spellings resolve: the qualified `std::name` and the bare `name` a
// `use std::name;` import brought into scope. A bare word is reported as
// unqualified so the orchestrator can stay silent when it turns out to be an
// ordinary identifier rather than a stdlib export.
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

/** Optional call `@`, optional `std::` qualifier, then the identifier. */
const REF = /@?(?:std::)?([A-Za-z_][A-Za-z0-9_]*)/g;

export type StdRef = { name: string; qualified: boolean };

export function stdNameAt(text: string, pos: number): StdRef | null {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  let lineEnd = text.indexOf('\n', pos);
  if (lineEnd === -1) lineEnd = text.length;
  const line = text.slice(lineStart, lineEnd);
  const col = pos - lineStart;
  for (const m of line.matchAll(REF)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    // Inclusive at both edges: a click near a glyph's boundary resolves to
    // either side of it, and both sides mean the same token here.
    if (col >= start && col <= end) return { name: m[1], qualified: m[0].includes('std::') };
  }
  return null;
}

export function stdLink(onGoTo: (name: string, qualified: boolean) => void): Extension {
  return EditorView.domEventHandlers({
    mousedown(e, view) {
      if (!(e.metaKey || e.ctrlKey)) return false;
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
      if (pos === null) return false;
      const ref = stdNameAt(view.state.doc.toString(), pos);
      if (!ref) return false;
      e.preventDefault();
      onGoTo(ref.name, ref.qualified);
      return true;
    },
  });
}
