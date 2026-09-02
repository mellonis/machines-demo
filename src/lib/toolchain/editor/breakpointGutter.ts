// Breakpoint gutter keyed by 1-based line. Breakpoint state lives in the
// orchestrator (`{ file, line }` keys — docs/execution-model.md (toolchain
// engines)); the gutter reads it through `has` / `canSet` and re-renders when
// `bpRefresh` is dispatched.
import { StateEffect, type Extension } from '@codemirror/state';
import { EditorView, GutterMarker, gutter } from '@codemirror/view';

export type BreakpointGutterOpts = {
  has: (line: number) => boolean;
  canSet: (line: number) => boolean;
  onToggle: (line: number) => void;
  refuseTitle: string;
  /** The file's current breakpoint lines, read on every document change so
   *  they can be mapped through the edit. Omit for a read-only document. */
  lines?: () => number[];
  /** Old line → new line for every line `lines()` returned, called only when
   *  at least one of them moved. Omit together with `lines`. */
  onLinesMapped?: (next: Map<number, number>) => void;
};

export const bpRefresh = StateEffect.define<null>();

class BpMarker extends GutterMarker {
  toDOM(): Node {
    const el = document.createElement('span');
    el.className = 'cm-bp-marker';
    return el;
  }
}
const marker = new BpMarker();

// CodeMirror's gutter (@codemirror/view SingleGutterView ctor) always
// appends the `initialSpacer` marker's element first, hidden, sized to the
// widest real marker so the gutter has a stable width before any line is
// breakpointed. That element carries the same plain `cm-gutterElement` class
// as every real line's element — there is no built-in way to tell it apart
// in a DOM query — so it gets its own marker with a distinguishing
// `elementClass` here. The rendered marker glyph (span.cm-bp-marker) is
// unchanged, so Task 7's width-reservation CSS still applies.
class SpacerMarker extends GutterMarker {
  elementClass = 'cm-bp-spacer';
  toDOM(): Node {
    const el = document.createElement('span');
    el.className = 'cm-bp-marker';
    return el;
  }
}
const spacerMarker = new SpacerMarker();

class Unmappable extends GutterMarker {
  constructor(private readonly title: string) { super(); }
  elementClass = 'cm-bp-unmappable';
  toDOM(): Node {
    const el = document.createElement('span');
    el.className = 'cm-bp-refuse';
    el.title = this.title;
    return el;
  }
}

/**
 * Keeps line-keyed breakpoints attached to the text they were set on.
 * A stored line number names a position in the revision it was set in; an
 * insertion or deletion above it renames the line, so every document change
 * maps the current breakpoint lines through it and reports what moved.
 *
 * A change that spans the whole document (Format, Reset, picking an example)
 * is a new buffer rather than an edit — every old position maps to the end of
 * the inserted text, which would pile every breakpoint onto the last line —
 * so the lines are left as they are and the next Build prunes whatever no
 * longer maps.
 */
function lineRemapper(opts: BreakpointGutterOpts): Extension {
  const { lines, onLinesMapped } = opts;
  if (!lines || !onLinesMapped) return [];
  return EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;
    const oldDoc = update.startState.doc;
    let lo = Infinity;
    let hi = -1;
    update.changes.iterChanges((fromA, toA) => {
      if (fromA < lo) lo = fromA;
      if (toA > hi) hi = toA;
    });
    if (lo === 0 && hi === oldDoc.length) return;
    const next = new Map<number, number>();
    let moved = false;
    for (const n of lines()) {
      if (n < 1 || n > oldDoc.lines) continue;
      // Association 1 keeps a line start pinned to the text that follows it,
      // so a deleted line's breakpoint lands on the line that absorbed it
      // rather than on the one before.
      const to = update.state.doc.lineAt(update.changes.mapPos(oldDoc.line(n).from, 1)).number;
      next.set(n, to);
      if (to !== n) moved = true;
    }
    if (moved) onLinesMapped(next);
  });
}

export function breakpointGutter(opts: BreakpointGutterOpts): Extension {
  const unmappable = new Unmappable(opts.refuseTitle);
  return [lineRemapper(opts), gutter({
    class: 'cm-bp-gutter',
    lineMarker(view, line) {
      const n = view.state.doc.lineAt(line.from).number;
      if (opts.has(n)) return marker;
      return opts.canSet(n) ? null : unmappable;
    },
    lineMarkerChange: (update) => update.transactions.some((tr) => tr.effects.some((e) => e.is(bpRefresh))),
    initialSpacer: () => spacerMarker,
    domEventHandlers: {
      mousedown(view, line, event) {
        const n = view.state.doc.lineAt(line.from).number;
        const target = event.target as HTMLElement | null;
        if (!opts.canSet(n)) {
          if (target) target.title = opts.refuseTitle;
          return true;
        }
        opts.onToggle(n);
        view.dispatch({ effects: bpRefresh.of(null) });
        return true;
      },
    },
  })];
}

export function refreshBreakpoints(view: EditorView): void {
  view.dispatch({ effects: bpRefresh.of(null) });
}
