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

describe('MachineGraph (component smoke)', () => {
  afterEach(() => cleanup());

  it('C-graph-header: renders the "State graph" title in the header', () => {
    render(MachineGraph, {
      graph: null,
      collapsed: false,
      onToggleCollapsed: () => {},
      onExpand: () => {},
    });
    expect(screen.getByText('State graph')).toBeInTheDocument();
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
    await fireEvent.click(screen.getByText('State graph'));
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
    await fireEvent.click(screen.getByLabelText('Open state graph in modal'));
    expect(onExpand).toHaveBeenCalledOnce();
  });

  it('C-graph-no-expand-when-collapsed: expand button is hidden when collapsed', () => {
    render(MachineGraph, {
      graph: STUB_GRAPH,
      collapsed: true,
      onToggleCollapsed: () => {},
      onExpand: () => {},
    });
    expect(screen.queryByLabelText('Open state graph in modal')).not.toBeInTheDocument();
  });
});
