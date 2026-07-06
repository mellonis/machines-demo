// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import MachineGraph from './MachineGraph.svelte';

// Smoke-level tests for MachineGraph. The mermaid `import('mermaid')` call
// is mocked at the module level — actually rendering an SVG would require
// loading mermaid + its 2 transitive deps (cytoscape, katex) in happy-dom
// which is brittle and slow. Visual smoke pre-merge covers the render path.

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    registerLayoutLoaders: vi.fn(),
    render: vi.fn(async (id: string) => ({
      svg: `<svg data-testid="mock-svg" data-id="${id}"></svg>`,
      bindFunctions: undefined,
    })),
  },
}));

vi.mock('@mermaid-js/layout-elk', () => ({
  default: [],
}));

const STUB_GRAPH = {
  initialId: 0,
  alphabets: [[' ', '*']] as readonly (readonly string[])[],
  nodes: {},
} as never; // structural-cast — the component only forwards to toMermaid

// Minimal two-state graph for the text-alternative test. Shape
// mirrors the engine's `Graph` type — see `@turing-machine-js/machine`'s
// `utilities/graph.d.ts`. `pattern` / `command[].symbol` / `.movement`
// strings are the engine's pre-decoded edge-label vocabulary.
const SUMMARY_GRAPH = {
  initialId: 1,
  alphabets: [[' ', 'a', 'b']],
  nodes: {
    1: {
      id: 1,
      name: 'q0',
      isHalt: false,
      isHaltMarker: false,
      isWrapper: false,
      bareStateId: null,
      frameId: null,
      overriddenHaltStateId: null,
      tags: [],
      transitions: [
        {
          id: '1.0',
          pattern: "'a'",
          command: [{ symbol: "'b'", movement: 'R' }],
          nextStateId: 2,
        },
      ],
    },
    2: {
      id: 2,
      name: 'q1',
      isHalt: false,
      isHaltMarker: false,
      isWrapper: false,
      bareStateId: null,
      frameId: null,
      overriddenHaltStateId: null,
      tags: [],
      transitions: [],
    },
  },
} as never;

describe('MachineGraph (component smoke)', () => {
  afterEach(() => cleanup());

  it('C-graph-header: renders the "Machine graph" title in the header', () => {
    render(MachineGraph, {
      graph: null,
      collapsed: false,
      onToggleCollapsed: () => {},
      onExpand: () => {},
    });
    expect(screen.getByText('Machine graph')).toBeInTheDocument();
  });

  it('C-graph-empty: shows the empty-state hint when graph is null', () => {
    render(MachineGraph, {
      graph: null,
      collapsed: false,
      onToggleCollapsed: () => {},
      onExpand: () => {},
    });
    expect(screen.getByTestId('machine-graph-body')).toHaveTextContent(/Build the machine/);
  });

  it('C-graph-collapsed-hides-body: no body when collapsed=true', () => {
    render(MachineGraph, {
      graph: null,
      collapsed: true,
      onToggleCollapsed: () => {},
      onExpand: () => {},
    });
    expect(screen.queryByTestId('machine-graph-body')).not.toBeInTheDocument();
  });

  it('C-graph-toggle-callback: clicking the toggle calls onToggleCollapsed', async () => {
    const onToggleCollapsed = vi.fn();
    render(MachineGraph, {
      graph: null,
      collapsed: false,
      onToggleCollapsed,
      onExpand: () => {},
    });
    await fireEvent.click(screen.getByText('Machine graph'));
    expect(onToggleCollapsed).toHaveBeenCalledOnce();
  });

  it('C-graph-expand-callback: clicking the expand button calls onExpand', async () => {
    const onExpand = vi.fn();
    render(MachineGraph, {
      graph: STUB_GRAPH,
      collapsed: false,
      onToggleCollapsed: () => {},
      onExpand,
    });
    await fireEvent.click(screen.getByLabelText('Open machine graph in modal'));
    expect(onExpand).toHaveBeenCalledOnce();
  });

  it('C-graph-no-expand-when-collapsed: expand button is hidden when collapsed', () => {
    render(MachineGraph, {
      graph: STUB_GRAPH,
      collapsed: true,
      onToggleCollapsed: () => {},
      onExpand: () => {},
    });
    expect(screen.queryByLabelText('Open machine graph in modal')).not.toBeInTheDocument();
  });

  it('C-graph-sr-summary: renders the screen-reader text alternative', () => {
    render(MachineGraph, {
      graph: SUMMARY_GRAPH,
      collapsed: false,
      onToggleCollapsed: () => {},
      onExpand: () => {},
    });
    const summary = screen.getByLabelText('Machine graph text representation');
    expect(summary).toBeInTheDocument();
    expect(summary).toHaveTextContent(/2 states/);
    expect(summary).toHaveTextContent(/q0/);
    expect(summary).toHaveTextContent(/q1/);
  });

  it('C-graph-sr-summary-collapsed: text alternative stays available when visually collapsed', () => {
    render(MachineGraph, {
      graph: SUMMARY_GRAPH,
      collapsed: true,
      onToggleCollapsed: () => {},
      onExpand: () => {},
    });
    // The visual body is hidden (covered by C-graph-collapsed-hides-body
    // above), but the text alternative must remain — for AT users the
    // collapsed state shouldn't drop the entire structural view.
    expect(screen.getByLabelText('Machine graph text representation')).toBeInTheDocument();
  });
});
