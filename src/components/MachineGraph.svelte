<script lang="ts">
  import { onMount } from 'svelte';
  import { toMermaid } from '@turing-machine-js/machine';
  import type { TuringGraph } from '../lib/types.ts';
  import { theme } from '../lib/theme.svelte.ts';

  type Props = {
    graph: TuringGraph | null;
    collapsed: boolean;
    onToggleCollapsed: () => void;
    onExpand: () => void;
  };

  let {
    graph,
    collapsed,
    onToggleCollapsed,
    onExpand,
  }: Props = $props();

  const instanceId = `mg-${nextInstanceCounter()}`;
  let mermaidModule: typeof import('mermaid').default | null = $state(null);
  let svg = $state<string>('');
  let renderError = $state<string | null>(null);

  // Local non-reactive counter for mermaid render-id uniqueness. mermaid.render
  // requires a unique id per call; reusing an id causes the call to fail or
  // return stale SVG. NOT a $state — incrementing it must not retrigger
  // effects that read it (that's the loop I just removed).
  let renderSeq = 0;

  // Lazy-import mermaid on mount, plus the ELK layout loader so the state
  // graph uses ELK's hierarchical layout (better for the v7 callable-subtree
  // subgraphs and wrapper/bare composition than mermaid's default dagre).
  // Both become their own bundle chunks — kept off the initial payload.
  onMount(async () => {
    try {
      const [m, elk] = await Promise.all([
        import('mermaid'),
        import('@mermaid-js/layout-elk'),
      ]);
      m.default.registerLayoutLoaders(elk.default);
      mermaidModule = m.default;
    } catch (err) {
      renderError = `failed to load mermaid: ${(err as Error).message}`;
    }
  });

  // Re-initialize mermaid when the theme changes (or on first load). Cheap;
  // just sets config. Render effect re-runs separately when theme.resolved
  // changes because IT reads theme.resolved too — no manual counter needed.
  $effect(() => {
    if (!mermaidModule) return;
    mermaidModule.initialize({
      startOnLoad: false,
      theme: theme.resolved === 'dark' ? 'dark' : 'default',
      securityLevel: 'strict', // we never embed user-controlled content
      layout: 'elk', // ELK hierarchical layout — better for v7 subgraphs
      flowchart: { htmlLabels: true, curve: 'basis' },
    });
  });

  // Re-render whenever any of mermaidModule / graph / collapsed / theme
  // changes. Reading `theme.resolved` here (even if unused locally) is
  // what makes this effect re-fire on theme change — strictly tracked.
  $effect(() => {
    if (!mermaidModule || !graph || collapsed) return;
    // Track theme.resolved so a theme change re-renders with the just-
    // re-initialized mermaid config from the effect above.
    void theme.resolved;
    const m = mermaidModule;
    const g = graph;
    void renderGraph(m, g);
  });

  async function renderGraph(
    m: typeof import('mermaid').default,
    g: TuringGraph,
  ): Promise<void> {
    renderSeq += 1;
    const seq = renderSeq;
    try {
      const source = toMermaid(g);
      const result = await m.render(`${instanceId}-${seq}`, source);
      svg = result.svg;
      renderError = null;
    } catch (err) {
      renderError = `failed to render graph: ${(err as Error).message}`;
      svg = '';
    }
  }
</script>

<section class="machine-graph" aria-label="State graph">
  <header class="header">
    <button
      type="button"
      class="toggle"
      aria-expanded={!collapsed}
      onclick={onToggleCollapsed}
      title={collapsed ? 'Expand state graph' : 'Collapse state graph'}
    >
      <span class="chevron" aria-hidden="true">{collapsed ? '▶' : '▼'}</span>
      <span class="title">State graph</span>
    </button>
    {#if !collapsed}
      <button
        type="button"
        class="expand"
        onclick={onExpand}
        title="Open state graph in modal"
        aria-label="Open state graph in modal"
      >⛶</button>
    {/if}
  </header>

  {#if !collapsed}
    <div class="body" data-testid="machine-graph-body">
      {#if renderError}
        <div class="error" role="alert">{renderError}</div>
      {:else if !graph}
        <div class="empty">Build the machine to see its state graph.</div>
      {:else if !mermaidModule}
        <div class="loading">Loading graph renderer…</div>
      {:else if svg}
        <!-- engine-emitted Mermaid source → engine-rendered SVG. No user-controlled
             content reaches this surface (worker is the security boundary; mermaid
             runs in strict securityLevel). -->
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <div class="svg-host">{@html svg}</div>
      {:else}
        <div class="loading">Rendering…</div>
      {/if}
    </div>
  {/if}
</section>

<script lang="ts" module>
  let instanceCounter = 0;
  function nextInstanceCounter(): number {
    instanceCounter += 1;
    return instanceCounter;
  }
</script>

<style>
  .machine-graph {
    display: flex;
    flex-direction: column;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    background: var(--bg-subtle, var(--bg));
    border-bottom: 1px solid transparent;
  }

  .machine-graph:has(.body) .header {
    border-bottom-color: var(--border);
  }

  .toggle {
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font: inherit;
    padding: 0;
  }

  .chevron {
    font-size: 0.75em;
    opacity: 0.7;
  }

  .title {
    font-weight: 500;
  }

  .expand {
    background: none;
    border: 1px solid var(--border);
    color: inherit;
    border-radius: 4px;
    cursor: pointer;
    padding: 2px 8px;
    font-size: 14px;
    transition: background var(--anim-button-hover-ms);
  }

  .expand:hover {
    background: var(--bg-subtle, var(--border));
  }

  .body {
    padding: 12px;
    overflow: auto;
    max-height: 360px;
  }

  .empty,
  .loading {
    color: var(--text-muted, var(--text));
    opacity: 0.7;
    font-style: italic;
    text-align: center;
    padding: 24px 0;
  }

  .error {
    color: var(--error, #c00);
    padding: 8px 12px;
    background: var(--error-bg, #fee);
    border-radius: 4px;
  }

  .svg-host {
    display: flex;
    justify-content: center;
  }

  .svg-host :global(svg) {
    max-width: 100%;
    height: auto;
  }
</style>
