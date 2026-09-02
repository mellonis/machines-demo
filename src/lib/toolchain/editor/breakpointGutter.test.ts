// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { breakpointGutter, refreshBreakpoints } from './breakpointGutter.ts';

type Extra = {
  doc?: string;
  lines?: () => number[];
  onLinesMapped?: (next: Map<number, number>) => void;
};

function make(has: Set<number>, mappable: Set<number>, onToggle: (n: number) => void, extra: Extra = {}) {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: extra.doc ?? 'a\nb\nc\n',
      extensions: [breakpointGutter({
        has: (n) => has.has(n),
        canSet: (n) => mappable.has(n),
        onToggle,
        refuseTitle: 'no instruction on this line',
        lines: extra.lines,
        onLinesMapped: extra.onLinesMapped,
      })],
    }),
  });
  return { view, parent };
}

// CodeMirror always renders the gutter's `initialSpacer` marker as the first
// `.cm-gutterElement` (@codemirror/view dist/index.js SingleGutterView ctor,
// ~line 11623), hidden, to reserve width. It carries a `.cm-bp-marker` span
// too (same glyph as a real breakpoint), so a plain `.cm-bp-marker` count
// would over-count by one — hence excluding `.cm-bp-spacer`
// (breakpointGutter.ts's dedicated spacer-marker class).
const markers = (parent: HTMLElement) =>
  parent.querySelectorAll('.cm-bp-gutter .cm-gutterElement:not(.cm-bp-spacer) .cm-bp-marker').length;

describe('breakpointGutter', () => {
  it('T-bp-render: one marker per breakpointed line; refresh re-renders', () => {
    const has = new Set<number>([2]);
    const { view, parent } = make(has, new Set([1, 2, 3]), () => {});
    expect(markers(parent)).toBe(1);
    has.add(3);
    refreshBreakpoints(view);
    expect(markers(parent)).toBe(2);
    view.destroy();
  });

  // CodeMirror's gutter mousedown handler resolves the clicked line from a Y
  // coordinate: when the event target is a gutter *child* element, it reads
  // that element's `getBoundingClientRect()`; happy-dom stubs that to an
  // all-zero rect (no layout engine), so a click dispatched on a specific
  // `.cm-gutterElement` cannot be distinguished from any other — every click
  // would resolve to line 1 regardless of which element received it. When
  // the event target is the gutter *container* itself, the handler instead
  // reads `event.clientY` directly — a path real layout doesn't need but
  // that happy-dom's stub makes reliable. So the test dispatches on the
  // container with an explicit `clientY` computed from the target line's
  // real `lineBlockAt` position (which CodeMirror computes from its own line
  // height map, independent of `getBoundingClientRect`), rather than
  // indexing into `.cm-gutterElement` children directly.
  it('T-bp-click: a click on a mappable line calls onToggle with its number', () => {
    const toggled: number[] = [];
    const { view, parent } = make(new Set(), new Set([1, 2, 3]), (n) => toggled.push(n));
    const gutterDom = parent.querySelector('.cm-bp-gutter') as HTMLElement;
    const line2 = view.state.doc.line(2);
    const block = view.lineBlockAt(line2.from);
    const clientY = view.documentTop + block.top + block.height / 2;
    gutterDom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientY }));
    expect(toggled).toEqual([2]);
    view.destroy();
  });

  // Two more CodeMirror behaviors (not happy-dom quirks — both hold in a
  // real browser too) rule out indexing `.cm-gutterElement` by position:
  // the spacer described above always occupies index 0, and a line whose
  // marker is `null` (mappable, unbreakpointed) renders no element at all
  // by default (`renderEmptyElements` defaults to false — dist/index.js
  // ~line 11573), so element count doesn't track document line count. The
  // unmappable marker's own `elementClass` already tags its wrapping
  // `.cm-gutterElement` with `cm-bp-unmappable` (breakpointGutter.ts), so
  // that class is the reliable way to find it.
  it('T-bp-refuse: an unmappable line is not toggled and carries the refuse title', () => {
    const toggled: number[] = [];
    const { view, parent } = make(new Set(), new Set([2]), (n) => toggled.push(n));
    const el = parent.querySelector('.cm-bp-gutter .cm-gutterElement.cm-bp-unmappable') as HTMLElement;
    // Pre-click: the tooltip must already be reachable on hover, before any
    // click. `Unmappable.toDOM()` puts the `title` on its inner
    // `.cm-bp-refuse` span (not on the wrapper `.cm-gutterElement`), and
    // Editor.svelte's `.cm-bp-refuse` rule stretches that span to fill the
    // cell so it is the actual hover/pointer target.
    expect(el.classList.contains('cm-bp-unmappable')).toBe(true);
    const refuse = el.querySelector('.cm-bp-refuse') as HTMLElement;
    expect(refuse.title).toBe('no instruction on this line');
    // Click: still refused, and the wrapper title is set too (belt-and-braces).
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(toggled).toEqual([]);
    expect(el.classList.contains('cm-bp-unmappable')).toBe(true);
    expect(el.title).toBe('no instruction on this line');
    view.destroy();
  });
});

// Breakpoints are stored by line number, but a line number is only a name
// for a position in *some* revision of the document. Every edit that adds
// or removes lines above a breakpoint renames it, so the gutter maps the
// stored lines through each change and reports the result — otherwise a
// breakpoint set before an insertion silently names a different instruction
// after the next Build (docs/execution-model.md (toolchain engines)).
describe('breakpointGutter line mapping', () => {
  it('T-bp-map-insert-above: inserting a line above a breakpoint reports the shifted number', () => {
    const bps = [3];
    const calls: Map<number, number>[] = [];
    const { view } = make(new Set(bps), new Set([1, 2, 3]), () => {}, {
      lines: () => bps,
      onLinesMapped: (next) => calls.push(next),
    });
    view.dispatch({ changes: { from: 0, insert: 'x\n' } });
    expect(calls).toHaveLength(1);
    expect([...calls[0]]).toEqual([[3, 4]]);
    view.destroy();
  });

  it('T-bp-map-delete-line: a deleted breakpointed line maps onto its successor, with no duplicate', () => {
    const bps = [2, 3];
    const calls: Map<number, number>[] = [];
    const { view } = make(new Set(bps), new Set([1, 2, 3, 4]), () => {}, {
      doc: 'a\nb\nc\nd\n',
      lines: () => bps,
      onLinesMapped: (next) => calls.push(next),
    });
    const from = view.state.doc.line(2).from;
    const to = view.state.doc.line(3).from;
    view.dispatch({ changes: { from, to } });
    expect(calls).toHaveLength(1);
    // Line 2 is gone; its breakpoint lands on the line that absorbed it —
    // the same line 3's breakpoint moved onto. The caller stores lines in a
    // set, so the two collapse into one breakpoint rather than duplicating.
    expect([...calls[0]]).toEqual([[2, 2], [3, 2]]);
    expect([...new Set(calls[0].values())]).toEqual([2]);
    view.destroy();
  });

  it('T-bp-map-edit-within-line: typing inside another line reports nothing', () => {
    const bps = [3];
    const calls: Map<number, number>[] = [];
    const { view } = make(new Set(bps), new Set([1, 2, 3]), () => {}, {
      lines: () => bps,
      onLinesMapped: (next) => calls.push(next),
    });
    // The crux: the mapping compares line *numbers*, not positions. Typing
    // on line 1 does shift line 3's start position, but not its number — so
    // nothing moved and the caller is left alone.
    view.dispatch({ changes: { from: 1, insert: 'XY' } });
    expect(calls).toEqual([]);
    view.destroy();
  });

  it('T-bp-map-whole-doc-replace: replacing the whole document reports nothing', () => {
    const bps = [2, 3];
    const calls: Map<number, number>[] = [];
    const { view } = make(new Set(bps), new Set([1, 2, 3]), () => {}, {
      lines: () => bps,
      onLinesMapped: (next) => calls.push(next),
    });
    // Format / Reset / picking an example replace the buffer wholesale. Every
    // old position maps to the end of the inserted text, which would pile
    // every breakpoint onto the last line — a new buffer is not an edit, so
    // the lines are left as they are and the next Build prunes what no
    // longer maps.
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: 'p\nq\nr\ns\n' } });
    expect(calls).toEqual([]);
    view.destroy();
  });
});
