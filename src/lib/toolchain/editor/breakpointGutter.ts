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
    el.title = this.title;
    return el;
  }
}

export function breakpointGutter(opts: BreakpointGutterOpts): Extension {
  const unmappable = new Unmappable(opts.refuseTitle);
  return gutter({
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
  });
}

export function refreshBreakpoints(view: EditorView): void {
  view.dispatch({ effects: bpRefresh.of(null) });
}
