// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import type { Frame, Snippet } from '@turing-machine-js/visuals';
import ExecutionTraceTable from './ExecutionTraceTable.svelte';

afterEach(() => cleanup());

type Props = {
  frames: Frame[];
  frameIndex: number;
  graph: Snippet['graph'];
  blanks: string[];
};

const SINGLE_TAPE_GRAPH = {
  initialId: 1,
  alphabets: [[' ', 'a', 'b']],
  nodes: {
    0: { id: 0, name: 'halt' },
    1: { id: 1, name: 'S' },
    2: { id: 2, name: 'T' },
  },
} as unknown as Snippet['graph'];

function singleTapeFrames(): Frame[] {
  return [
    { step: 0, tape: [{ symbols: ['a', 'b'], position: 0 }], highlight: null },
    {
      step: 1,
      tape: [{ symbols: ['b', 'b'], position: 1 }],
      commands: [{ movement: 'R', read: 'a', write: 'b' }],
      highlight: { fromId: 1, toId: 2, strong: 'from', paused: false },
    },
    {
      step: 2,
      tape: [{ symbols: ['b', 'b'], position: 1 }],
      // write === read → "keep"
      commands: [{ movement: 'L', read: 'b', write: 'b' }],
      highlight: { fromId: 2, toId: 1, strong: 'from', paused: false },
    },
    {
      step: 3,
      tape: [{ symbols: ['b', ' '], position: 1 }],
      // read is the blank
      commands: [{ movement: 'S', read: ' ', write: ' ' }],
      highlight: { fromId: 1, toId: 0, strong: 'from', paused: false },
    },
  ];
}

function renderTable(props: Partial<Props> = {}) {
  return render(ExecutionTraceTable, {
    frames: singleTapeFrames(),
    frameIndex: 0,
    graph: SINGLE_TAPE_GRAPH,
    blanks: [' '],
    ...props,
  });
}

describe('ExecutionTraceTable', () => {
  it('T-trace-skips-frame-0: emits one row per iter, not per frame', () => {
    renderTable();
    const rows = screen.getAllByTestId('trace-row');
    // 4 frames → 3 rows (skip frame 0).
    expect(rows).toHaveLength(3);
    expect(rows[0].dataset.step).toBe('1');
    expect(rows[2].dataset.step).toBe('3');
  });

  it('T-trace-current-row: highlights the row matching frameIndex via aria-current', () => {
    renderTable({ frameIndex: 2 });
    const current = document.querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect((current[0] as HTMLElement).dataset.step).toBe('2');
  });

  it('T-trace-no-current-on-frame-0: when frameIndex is 0 no row is current', () => {
    renderTable({ frameIndex: 0 });
    expect(document.querySelector('[aria-current="step"]')).toBeNull();
  });

  it('T-trace-state-and-goto: looks up names from graph; halt resolves via node 0', () => {
    renderTable({ frameIndex: 3 });
    const halting = document.querySelector<HTMLTableRowElement>(
      '[data-testid="trace-row"][data-step="3"]',
    );
    expect(halting).not.toBeNull();
    const cells = halting!.querySelectorAll('td');
    // Columns: step, state, reads, write, move, goto
    expect(cells[1].textContent).toBe('S');
    expect(cells[5].textContent).toBe('halt');
  });

  it('T-trace-abort-goto: an abort-terminal transition resolves the goto cell to "abort"', () => {
    const frames = singleTapeFrames();
    frames[3] = {
      ...frames[3],
      highlight: { fromId: 1, toId: -1, strong: 'from', paused: false },
    };
    renderTable({ frames });
    const aborting = document.querySelector<HTMLTableRowElement>(
      '[data-testid="trace-row"][data-step="3"]',
    );
    const cells = aborting!.querySelectorAll('td');
    expect(cells[1].textContent).toBe('S');
    expect(cells[5].textContent).toBe('abort');
  });

  it('T-trace-write-keep: write === read renders "keep"', () => {
    renderTable();
    const row = document.querySelector<HTMLTableRowElement>(
      '[data-testid="trace-row"][data-step="2"]',
    );
    const cells = row!.querySelectorAll('td');
    // Write column index 3
    expect(cells[3].textContent?.trim()).toBe('keep');
  });

  it('T-trace-blank-class: blank symbol cells carry the .blank class for dimming', () => {
    renderTable();
    const blankRow = document.querySelector<HTMLTableRowElement>(
      '[data-testid="trace-row"][data-step="3"]',
    );
    // Reads column (index 2): inner span should have .blank
    const readsSpan = blankRow!.querySelectorAll('td')[2].querySelector('.cell');
    expect(readsSpan?.classList.contains('blank')).toBe(true);
  });

  it('T-trace-move: emits the literal movement letter', () => {
    renderTable();
    const row = document.querySelector<HTMLTableRowElement>(
      '[data-testid="trace-row"][data-step="1"]',
    );
    const cells = row!.querySelectorAll('td');
    expect(cells[4].textContent?.trim()).toBe('R');
  });

  it('T-trace-multi-tape-brackets: K>1 wraps cells in [a, b] form', () => {
    const frames: Frame[] = [
      {
        step: 0,
        tape: [
          { symbols: ['a'], position: 0 },
          { symbols: ['_'], position: 0 },
        ],
        highlight: null,
      },
      {
        step: 1,
        tape: [
          { symbols: ['a'], position: 0 },
          { symbols: ['_'], position: 0 },
        ],
        commands: [
          { movement: 'R', read: 'a', write: 'b' },
          { movement: 'L', read: '_', write: '_' },
        ],
        highlight: { fromId: 1, toId: 0, strong: 'from', paused: false },
      },
    ];
    renderTable({ frames, frameIndex: 1, blanks: [' ', '_'] });
    const row = document.querySelector<HTMLTableRowElement>(
      '[data-testid="trace-row"][data-step="1"]',
    );
    const cells = row!.querySelectorAll('td');
    // Reads cell: brackets around per-tape values, comma separator.
    const readsText = cells[2].textContent?.replace(/\s+/g, '');
    expect(readsText).toBe('[a,_]');
    // Move cell: brackets around per-tape moves.
    const moveText = cells[4].textContent?.replace(/\s+/g, '');
    expect(moveText).toBe('[R,L]');
  });

  it('T-trace-unknown-node: falls back to #id when graph has no matching node', () => {
    const sparseGraph = {
      initialId: 1,
      alphabets: [[' ']],
      nodes: { 0: { id: 0, name: 'halt' } },
    } as unknown as Snippet['graph'];
    const frames: Frame[] = [
      { step: 0, tape: [{ symbols: [' '], position: 0 }], highlight: null },
      {
        step: 1,
        tape: [{ symbols: [' '], position: 0 }],
        commands: [{ movement: 'S', read: ' ', write: ' ' }],
        // fromId 99 isn't in nodes — should render as #99.
        highlight: { fromId: 99, toId: 0, strong: 'from', paused: false },
      },
    ];
    renderTable({ frames, frameIndex: 1, graph: sparseGraph });
    const row = document.querySelector<HTMLTableRowElement>(
      '[data-testid="trace-row"][data-step="1"]',
    );
    expect(row!.querySelectorAll('td')[1].textContent).toBe('#99');
  });
});
