// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { breakpointGutter, refreshBreakpoints } from './breakpointGutter.ts';

function make(has: Set<number>, mappable: Set<number>, onToggle: (n: number) => void) {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: 'a\nb\nc\n',
      extensions: [breakpointGutter({ has: (n) => has.has(n), canSet: (n) => mappable.has(n), onToggle, refuseTitle: 'no instruction on this line' })],
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
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(toggled).toEqual([]);
    expect(el.classList.contains('cm-bp-unmappable')).toBe(true);
    expect(el.title).toBe('no instruction on this line');
    view.destroy();
  });
});
