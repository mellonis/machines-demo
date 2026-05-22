<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { toMermaid } from '@turing-machine-js/machine';
  import type { GraphHighlight, TuringGraph } from '../lib/types.ts';
  import { theme } from '../lib/theme.svelte.ts';

  type Props = {
    graph: TuringGraph | null;
    /** `from + edge + to` triple to highlight in the SVG. `null` clears any
     *  active highlight. Driven by MachineView mode + pause-response data
     *  (machines-demo#10). */
    highlight?: GraphHighlight | null;
    collapsed: boolean;
    onToggleCollapsed: () => void;
    onExpand: () => void;
    /** Called when mermaid render fails, so MachineView can surface the
     *  error in the main log (not just in this panel's own error slot).
     *  Optional — caller can omit if they don't need it. */
    onRenderError?: (message: string) => void;
  };

  let {
    graph,
    highlight = null,
    collapsed,
    onToggleCollapsed,
    onExpand,
    onRenderError,
  }: Props = $props();

  const instanceId = `mg-${nextInstanceCounter()}`;
  let mermaidModule: typeof import('mermaid').default | null = $state(null);
  let svg = $state<string>('');
  let renderError = $state<string | null>(null);
  let svgHostEl = $state<HTMLDivElement | undefined>();

  // Element caches built after each render. Keyed by engine GraphNode.id
  // (or `'idle'` for the synthetic sentinel). Walked once per render —
  // subsequent highlight changes look up directly without re-querying
  // the SVG. Deliberately non-reactive: the cache is mutated as a side
  // effect of rendering and consumed imperatively in the highlight
  // effect; SvelteMap would track reads and trigger spurious work.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const nodeCache = new Map<number | 'idle', SVGElement>();
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const edgeCache = new Map<string, SVGElement>();

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
      // Match the demo's :root font stack so the graph reads as part of
      // the app, not a third-party widget. Mermaid's default (trebuchet
      // ms) doesn't sit well with the demo's system-font UI.
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      flowchart: { htmlLabels: true, curve: 'basis' },
      // Don't let mermaid inject an "error bomb" SVG into document.body
      // when parsing fails (mermaid v11 default leaks DOM debris below the
      // page). With this, render() rejects cleanly and our catch handles
      // the message + surfaces it in the log via onRenderError.
      suppressErrorRendering: true,
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
      const source = stripEngineStyling(toMermaid(g));
      const result = await m.render(`${instanceId}-${seq}`, source);
      svg = result.svg;
      renderError = null;
    } catch (err) {
      const msg = `failed to render graph: ${(err as Error).message}`;
      renderError = msg;
      svg = '';
      onRenderError?.(msg);
    }
  }

  // Demo owns its visual layer — strip the engine's `classDef tag_*` rules
  // from the Mermaid source so mermaid doesn't emit hardcoded LIGHT-mode
  // fills/strokes (which it pins via inline `style="...!important"` on
  // every shape, defeating any author CSS). The `class sN tag_<name>`
  // directives stay, so the `<g class="...tag_<name>">` still receives the
  // class — that's what our own CSS (theme-aware via CSS variables) hooks
  // into. Net: engine emits structure + role classes; demo emits visuals.
  function stripEngineStyling(source: string): string {
    return source
      .split('\n')
      .filter((line) => !line.trim().startsWith('classDef tag_'))
      .join('\n');
  }

  // After SVG mounts in the DOM, walk it once to build the node/edge
  // element caches keyed by engine ids. Mermaid v11 emits element ids of
  // the form `${renderId}-flowchart-${nodeId}-${suffix}` (renderId is the
  // unique-per-call id passed to mermaid.render — we set it to
  // `${instanceId}-${seq}`). The `nodeId` chunk is what `toMermaid` wrote
  // into the source: `sN` for engine state id N, `idle` for the synthetic
  // sentinel, `cN` for halt markers, `w_N` for subgraph wrappers — only
  // the first two are user-facing for highlight.
  //
  // Edge `<path>` elements carry both `id="${renderId}-L_${from}_${to}_${ix}"`
  // AND a clean `data-id="L_${from}_${to}_${ix}"` attribute — we cache by
  // `data-id` to sidestep the render-id prefix.
  $effect(() => {
    void svg; // re-run when svg changes
    nodeCache.clear();
    edgeCache.clear();
    if (!svgHostEl) return;
    const root = svgHostEl.querySelector('svg');
    if (!root) return;
    root.querySelectorAll<SVGElement>('g.node').forEach((el) => {
      // id shape: `${renderId}-flowchart-${nodeId}-${suffix}`. Extract `nodeId`.
      const m = el.id.match(/-flowchart-(s\d+|idle|c\d+|w_\d+)-/);
      if (!m) return;
      const tok = m[1];
      const key: number | 'idle' | null =
        tok === 'idle' ? 'idle'
        : tok.startsWith('s') ? Number(tok.slice(1))
        : null; // cN / w_N skipped — not user-facing for #10.
      if (key === null) return;
      if (!nodeCache.has(key)) nodeCache.set(key, el);
    });
    root.querySelectorAll<SVGElement>('[data-id^="L_"]').forEach((el) => {
      const dataId = el.getAttribute('data-id');
      if (!dataId) return;
      // Multiple elements (path + label) share a data-id; first one wins.
      if (!edgeCache.has(dataId)) edgeCache.set(dataId, el);
    });
  });

  // Apply highlight whenever it (or the rendered SVG) changes. Imperative
  // DOM class toggling — faster than re-rendering the SVG, and lets us use
  // `scrollIntoView` directly on the cached element.
  //
  // Reactivity gotcha: every reactive value the effect should re-fire on
  // MUST be read in the effect body before any early `return`. Svelte 5
  // tracks deps by what's actually read during the run. If `highlight` is
  // read only after a `!svgHostEl` early-return, then a later change to
  // `highlight` (e.g. user clicks Step → mode becomes RUNNING_PAUSED →
  // graphHighlight derives a non-null triple) doesn't re-trigger this
  // effect. The first thing we do is read `highlight` and `svg` so both
  // become subscribed deps unconditionally.
  $effect(() => {
    const h = highlight;
    void svg; // track render output too — cache repopulates on re-render
    if (!svgHostEl) return;
    const root = svgHostEl.querySelector('svg');
    if (!root) return;
    // Clear previous highlight classes. No inline-style restore needed —
    // we strip the engine's classDef tags at render time so all visuals
    // are author-CSS-driven; toggling classes is enough.
    root.querySelectorAll('.mg-highlight-from, .mg-highlight-to, .mg-highlight-strong, .mg-highlight-edge')
      .forEach((el) => {
        el.classList.remove('mg-highlight-from', 'mg-highlight-to', 'mg-highlight-strong', 'mg-highlight-edge');
      });
    if (!h) return;
    const fromEl = nodeCache.get(h.fromId);
    const toEl = h.toId !== null ? nodeCache.get(h.toId) : undefined;
    if (fromEl) {
      fromEl.classList.add('mg-highlight-from');
      if (h.strong === 'from') fromEl.classList.add('mg-highlight-strong');
    }
    if (toEl) {
      toEl.classList.add('mg-highlight-to');
      if (h.strong === 'to') toEl.classList.add('mg-highlight-strong');
    }
    // Edge: data-id format is `L_${from}_${to}_${ix}`. We don't know which
    // ix fired (engine doesn't expose it); pick the first matching from→to
    // pair. For self-loops and multi-edge-to-same-target, this can
    // over-highlight — acceptable for v1.
    const fromKey = h.fromId === 'idle' ? 'idle' : `s${h.fromId}`;
    const toKey = h.toId !== null ? `s${h.toId}` : null;
    if (toKey) {
      for (let ix = 0; ix < 10; ix++) {
        const el = edgeCache.get(`L_${fromKey}_${toKey}_${ix}`);
        if (el) {
          el.classList.add('mg-highlight-edge');
          break;
        }
      }
    }
    // Scroll the strong node into view so users don't have to hunt for
    // it in large graphs. Manual offset math (vs Element.scrollIntoView)
    // keeps full control over the threshold + smooth scroll target and
    // is robust to whatever ancestor sizing/transform decisions the panel
    // adopts in the future.
    const strongEl = h.strong === 'from' ? fromEl : toEl;
    if (strongEl) {
      void tick().then(() => {
        const scrollContainer = svgHostEl?.closest<HTMLElement>('.body');
        if (!scrollContainer) return;
        const containerRect = scrollContainer.getBoundingClientRect();
        const elRect = strongEl.getBoundingClientRect();
        // Only scroll if the element is meaningfully outside the visible
        // area — small overlap doesn't need to move (avoids jitter when
        // highlight bounces between two close nodes).
        const margin = 16;
        const fullyAbove = elRect.bottom < containerRect.top + margin;
        const fullyBelow = elRect.top > containerRect.bottom - margin;
        if (!fullyAbove && !fullyBelow) return;
        const elCenter = elRect.top + elRect.height / 2;
        const containerCenter = containerRect.top + containerRect.height / 2;
        scrollContainer.scrollTo({
          top: scrollContainer.scrollTop + (elCenter - containerCenter),
          behavior: 'smooth',
        });
      });
    }
  });
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
        <div class="svg-host" bind:this={svgHostEl}>{@html svg}</div>
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
    /* Symmetric breathing room around the layout-shrunk SVG. */
    padding: 16px;
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
    /* Shrink the whole graph proportionally via real layout (width-based
       cap, aspect-ratio preserved by viewBox). Picked over `transform:
       scale` deliberately: transform changes visual coords but NOT layout
       coords, which breaks getBoundingClientRect-based scrollIntoView math
       — the scroll-to-m.state would under-shoot for nodes near the bottom
       (e.g. halt). With max-width the layout matches the visual, so the
       container's scroll math just works. */
    max-width: 80%;
    height: auto;
  }

  /* Highlight rules (machines-demo#10).
     `!important` is needed here even though we strip engine `classDef`
     tag rules at render time — mermaid still injects per-id selectors
     into the SVG's own <style> block (`#mg-N .node rect { stroke: ... }`)
     with ID specificity (100) that author class-only rules can't beat
     without it. The class additions happen via the DOM cache built
     right after each render (see the highlight effect). */
  .svg-host :global(g.node.mg-highlight-from rect),
  .svg-host :global(g.node.mg-highlight-from polygon),
  .svg-host :global(g.node.mg-highlight-from circle),
  .svg-host :global(g.node.mg-highlight-to rect),
  .svg-host :global(g.node.mg-highlight-to polygon),
  .svg-host :global(g.node.mg-highlight-to circle) {
    stroke: var(--graph-highlight) !important;
    stroke-width: 2px !important;
    transition: stroke 150ms ease, stroke-width 150ms ease;
  }

  .svg-host :global(g.node.mg-highlight-strong rect),
  .svg-host :global(g.node.mg-highlight-strong polygon),
  .svg-host :global(g.node.mg-highlight-strong circle) {
    stroke-width: 4px !important;
    filter: drop-shadow(0 0 6px var(--graph-highlight));
  }

  .svg-host :global(path.mg-highlight-edge),
  .svg-host :global(g.mg-highlight-edge path) {
    stroke: var(--graph-highlight) !important;
    stroke-width: 2.5px !important;
    transition: stroke 150ms ease, stroke-width 150ms ease;
  }

  /* Engine-emitted tag classes (machines-demo owns the palette).
     The engine's `classDef tag_<name>` rules are stripped from the
     Mermaid source at render time (stripEngineStyling). Mermaid still
     adds the `tag_<name>` class to the node's <g>, so we drive the
     visuals from here — theme-aware via CSS custom properties. This
     also keeps the demo's "look" coherent across light/dark and frees
     a future Settings UI to swap palettes without touching the engine.

     Generic catch-all (any tag_*) — gives every tagged node a subtle
     fill so the structural role reads, without per-tag colors that
     might clash. Per-tag overrides (tag_main specifically) layer on
     top. */
  .svg-host :global(g.node[class*='tag_'] rect),
  .svg-host :global(g.node[class*='tag_'] polygon),
  .svg-host :global(g.node[class*='tag_'] circle) {
    fill: var(--graph-tag-fill);
    stroke: var(--graph-tag-stroke);
  }
  .svg-host :global(g.node.tag_main rect),
  .svg-host :global(g.node.tag_main polygon),
  .svg-host :global(g.node.tag_main circle) {
    fill: var(--graph-tag-main-fill);
    stroke: var(--graph-tag-main-stroke);
  }
</style>
