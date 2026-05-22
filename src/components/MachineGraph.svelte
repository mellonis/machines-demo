<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { toMermaid } from '@turing-machine-js/machine';
  import type { GraphHighlight, TuringGraph } from '../lib/types.ts';
  import { theme } from '../lib/theme.svelte.ts';
  import { icons } from '../lib/icons.ts';

  type Props = {
    graph: TuringGraph | null;
    /** `from + edge + to` triple to highlight in the SVG. `null` clears any
     *  active highlight. Driven by MachineView mode + pause-response data
     *  (machines-demo#10). */
    highlight?: GraphHighlight | null;
    collapsed: boolean;
    onToggleCollapsed: () => void;
    /** When provided, the header shows an expand-to-modal button. Omit to
     *  hide it (used by the modal instance — it's already expanded). */
    onExpand?: () => void;
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
  // Hidden offscreen container passed to mermaid.render so it doesn't
  // append its temporary <div + svg> to document.body during a render —
  // without this, mermaid v11's default (`root = select("body")`,
  // mermaidAPI render fn) briefly extends the page height with the
  // measurement SVG and pops the page footer down a few hundred pixels
  // until removeTempElements() fires. Symptom: visible "footer jump" on
  // each Build with the graph open.
  let measureEl: HTMLDivElement | undefined;
  // Responsive flowchart direction: LR on wide screens (the demo's
  // tape + graph row sits horizontally — LR makes the graph read along
  // the same axis), TD on narrow screens (vertical phone layout has
  // more height than width to spend). Threshold matches the existing
  // mobile breakpoint used in MachineView's grid swap.
  let isNarrow = $state(initialNarrow());

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
  // Cache of the last successfully-rendered mermaid source. Repeated Builds
  // on the same machine produce byte-identical source — skip the render to
  // avoid the visible SVG-replacement repaint flash.
  let lastSource: string | null = null;

  // Lazy-import mermaid on mount, plus the ELK layout loader so the state
  // graph uses ELK's hierarchical layout (better for the v7 callable-subtree
  // subgraphs and wrapper/bare composition than mermaid's default dagre).
  // Both become their own bundle chunks — kept off the initial payload.
  onMount(() => {
    // Hidden offscreen measurement container. Mermaid writes its
    // temporary div+svg here instead of document.body, eliminating the
    // brief page-height extension that pushed the footer down on each
    // Build. Position-fixed offscreen so it never affects layout.
    measureEl = document.createElement('div');
    measureEl.setAttribute('aria-hidden', 'true');
    measureEl.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:1px;height:1px;overflow:hidden;pointer-events:none;visibility:hidden;';
    document.body.appendChild(measureEl);

    void (async () => {
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
    })();

    // Watch the breakpoint; re-render effect picks up the change because it
    // reads `isNarrow` (added below) as a tracked dep.
    const mq = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(`(max-width: ${NARROW_BREAKPOINT_PX - 1}px)`)
      : null;
    const onChange = (e: MediaQueryListEvent) => { isNarrow = e.matches; };
    mq?.addEventListener('change', onChange);
    return () => {
      mq?.removeEventListener('change', onChange);
      measureEl?.remove();
      measureEl = undefined;
    };
  });

  function initialNarrow(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(`(max-width: ${NARROW_BREAKPOINT_PX - 1}px)`).matches;
  }

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

  // Re-render whenever any of mermaidModule / graph / collapsed / theme /
  // direction changes. Reading the reactive values here (even if unused
  // locally) is what makes this effect re-fire on each — strictly tracked.
  $effect(() => {
    if (!mermaidModule || !graph || collapsed) return;
    // Track theme.resolved so a theme change re-renders with the just-
    // re-initialized mermaid config from the effect above.
    void theme.resolved;
    const narrow = isNarrow;
    const m = mermaidModule;
    const g = graph;
    void renderGraph(m, g, narrow ? 'TD' : 'LR');
  });

  async function renderGraph(
    m: typeof import('mermaid').default,
    g: TuringGraph,
    direction: 'LR' | 'TD',
  ): Promise<void> {
    const source = applyDirection(stripEngineStyling(toMermaid(g)), direction);
    // Cache key includes theme: same source under a different theme produces
    // different mermaid-emitted colors in the SVG's style block, so we still
    // need a re-render after a theme swap even though the .mmd source is
    // byte-identical. Our author CSS overrides (.svg-host :global ... vars)
    // re-color everything live anyway, but the embedded style block is what
    // mermaid uses as a fallback when our overrides don't match a class.
    const cacheKey = `${theme.resolved}::${source}`;
    if (cacheKey === lastSource && svg) return;
    renderSeq += 1;
    const seq = renderSeq;
    try {
      // Pass `measureEl` as the third arg (svgContainingElement) so
      // mermaid renders into our hidden offscreen div instead of
      // appending its temporary <div + svg> to document.body. The
      // returned `svg` string is what we ultimately mount via
      // {@html svg} into the visible svg-host.
      const result = await m.render(`${instanceId}-${seq}`, source, measureEl);
      // Stale-render guard: a newer renderGraph call may have started
      // (e.g., user mashed Build, or theme/direction changed mid-render).
      // Writing the older SVG would flash the panel between two graphs.
      // Drop the result; the newer call will land its own SVG.
      if (seq !== renderSeq) return;
      svg = result.svg;
      lastSource = cacheKey;
      renderError = null;
    } catch (err) {
      if (seq !== renderSeq) return;
      const msg = `failed to render graph: ${(err as Error).message}`;
      renderError = msg;
      svg = '';
      lastSource = null;
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

  // Swap the `flowchart <DIR>` directive at the top of the source so the
  // demo can flip orientation per viewport (LR desktop / TD mobile)
  // without forking the engine's toMermaid output.
  function applyDirection(source: string, direction: 'LR' | 'TD'): string {
    return source.replace(/^(\s*flowchart)\s+(LR|RL|TB|TD|BT)/m, `$1 ${direction}`);
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

<section class="machine-graph" aria-label="Machine graph">
  <header class="header">
    <button
      type="button"
      class="toggle"
      aria-expanded={!collapsed}
      onclick={onToggleCollapsed}
      title={collapsed ? 'Expand machine graph' : 'Collapse machine graph'}
    >
      <span class="chevron" aria-hidden="true">
        {@html collapsed ? icons.chevronRight : icons.chevronDown}
      </span>
      <span class="title">Machine graph</span>
    </button>
    {#if !collapsed && onExpand}
      <button
        type="button"
        class="expand"
        onclick={onExpand}
        title="Open machine graph in modal"
        aria-label="Open machine graph in modal"
      >{@html icons.expand}</button>
    {/if}
  </header>

  {#if !collapsed}
    <div class="body" data-testid="machine-graph-body">
      {#if renderError}
        <div class="error" role="alert">{renderError}</div>
      {:else if !graph}
        <div class="empty">Build the machine to see its graph.</div>
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
  // Matches MachineView's grid breakpoint — narrow viewports stack the
  // tape + editor vertically and render the graph TD; wider viewports
  // render LR so the diagram reads along the same axis as the tape row.
  const NARROW_BREAKPOINT_PX = 768;

  let instanceCounter = 0;
  function nextInstanceCounter(): number {
    instanceCounter += 1;
    return instanceCounter;
  }
</script>

<style>
  /* Site-style surface: matches .log-panel / .editor (var(--editor-bg)
     fill, var(--cell-border) outline, var(--surface-radius) corners) so
     the State graph reads as part of the app, not a third-party widget. */
  .machine-graph {
    display: flex;
    flex-direction: column;
    background: var(--editor-bg);
    border: 1px solid var(--cell-border);
    border-radius: var(--surface-radius);
    overflow: hidden;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px;
    background: var(--surface-bg);
    border-bottom: 1px solid transparent;
  }

  .machine-graph:has(.body) .header {
    border-bottom-color: var(--cell-border);
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
    display: inline-flex;
    align-items: center;
    color: var(--muted);

    :global(svg) {
      width: 14px;
      height: 14px;
      display: block;
    }
  }

  .title {
    font-weight: 500;
  }

  .expand {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    background: none;
    border: 1px solid var(--cell-border);
    color: var(--muted);
    border-radius: 4px;
    cursor: pointer;
    transition:
      background var(--anim-button-hover-ms),
      color var(--anim-button-hover-ms);

    &:hover {
      background: var(--hover-bg);
      color: var(--fg);
    }

    :global(svg) {
      width: 14px;
      height: 14px;
      display: block;
    }
  }

  .body {
    /* Fixed-height scroll area: the panel keeps a stable footprint across
       Builds even when the rendered SVG's intrinsic size varies (ELK
       layout isn't byte-stable across builds, and different machines
       produce wildly different graph sizes). Without a fixed height, the
       page below — control panel, log, footer — jumped on each Build. */
    padding: 16px;
    overflow: auto;
    height: 360px;
  }

  .empty,
  .loading {
    color: var(--muted);
    opacity: 0.7;
    font-style: italic;
    text-align: center;
    padding: 24px 0;
  }

  .error {
    color: var(--error);
    padding: 8px 12px;
    background: color-mix(in srgb, var(--error) 12%, transparent);
    border-radius: 4px;
  }

  .svg-host {
    display: flex;
    justify-content: center;
    /* No width cap — let the SVG render at its intrinsic size and the
       parent .body scroll if it exceeds the viewport. */
  }

  .svg-host :global(svg) {
    /* `zoom: 0.8` shrinks both visual AND layout box (vs `transform:
       scale`, which only changes visuals and breaks scroll math). Wider
       cross-browser support landed for `zoom` in Firefox 126 (2024-05).
       getBoundingClientRect returns zoom-transformed coords, so the
       scroll-into-view math against `.body` stays accurate. */
    zoom: 0.8;
  }

  /* All graph colors come from CSS vars (defined in app.css) so a theme
     swap re-colors the diagram instantly — no re-render needed. `!important`
     beats mermaid's per-id style block (`#mg-X-Y .marker {fill:#333}`,
     specificity 1,1,0) and inline attrs (`fill="..."`, `stroke="..."`)
     which mermaid emits with baked-in light/dark colors.

     Selectors target the class hooks mermaid v11 reliably emits:
     - `.flowchart-link` — edge paths
     - `.marker` / `.marker.cross` — arrowheads (also used in line junctions)
     - `.nodeLabel`, `.edgeLabel`, `.label` — foreignObject HTML labels
     - `.labelBkg` — edge-label background rectangle
     - `.cluster rect` — subgraph background */
  .svg-host :global(svg) {
    color: var(--graph-text);
    background: transparent !important;
  }
  /* All state shapes (default + tagged + halt + idle) share the Control
     Panel's surface fill so the graph reads as one family with the rest
     of panel-tape. Per-tag stroke overrides below convey role distinctions
     (entry-point, etc.) without changing the surface itself.

     Mermaid v11's classic look uses <path> for nodes (not <rect>) and its
     per-id <style> block forces fill/stroke colors even on paths whose
     inline attrs say "none" (the bg path has stroke="none", the outline
     path has fill="none"; mermaid still paints both purple). We
     unconditionally apply themed fill+stroke to all node shapes, then
     restore "none" via the higher-specificity attribute selectors so the
     bg path stays stroke-free and the outline path stays fill-free. */
  .svg-host :global(g.node rect),
  .svg-host :global(g.node polygon),
  .svg-host :global(g.node circle),
  .svg-host :global(g.node path) {
    fill: var(--graph-node-fill) !important;
    stroke: var(--graph-node-stroke) !important;
  }
  .svg-host :global(g.node path[fill='none']) {
    fill: none !important;
  }
  .svg-host :global(g.node path[stroke='none']) {
    stroke: none !important;
  }
  /* Node + edge text */
  .svg-host :global(.nodeLabel),
  .svg-host :global(.nodeLabel p),
  .svg-host :global(.edgeLabel),
  .svg-host :global(.edgeLabel p),
  .svg-host :global(.label),
  .svg-host :global(.label p) {
    color: var(--graph-text) !important;
    fill: var(--graph-text) !important;
  }
  /* Edge paths */
  .svg-host :global(.flowchart-link),
  .svg-host :global(path.flowchart-link) {
    stroke: var(--graph-edge) !important;
  }
  /* Arrow markers + line markers (cross etc.) */
  .svg-host :global(.marker) {
    fill: var(--graph-edge) !important;
    stroke: var(--graph-edge) !important;
  }
  .svg-host :global(.marker.cross) {
    stroke: var(--graph-edge) !important;
  }
  /* Edge-label background so edge lines don't show through the text.
     Mermaid renders edge labels inside foreignObject as HTML divs/spans
     that get `background-color` (not SVG `fill`). Restricted to the
     `g.edgeLabel` subtree so node labels (which sit on their own node
     surface) aren't given a second background. */
  .svg-host :global(g.edgeLabel foreignObject div),
  .svg-host :global(g.edgeLabel span.edgeLabel),
  .svg-host :global(g.edgeLabel .labelBkg),
  .svg-host :global(g.edgeLabel p) {
    background-color: var(--graph-edge-label-bg) !important;
  }
  /* SVG-side fallback for older mermaid render paths that use <rect>. */
  .svg-host :global(rect.labelBkg) {
    fill: var(--graph-edge-label-bg) !important;
  }
  /* Strip mermaid's stale rgba(232,232,232,0.8) from the outer g.edgeLabel
     so it doesn't paint a second bg below our themed one. */
  .svg-host :global(g.edgeLabel) {
    background-color: transparent !important;
  }
  /* Subgraph (cluster) backgrounds. Force dashed stroke so the cluster
     container reads as "structural wrapper", not "another state node" —
     Mermaid's default emit leaves stroke-dasharray="none" on cluster
     rects, making them visually identical to state rects. */
  .svg-host :global(g.cluster rect) {
    fill: var(--graph-cluster-fill) !important;
    stroke: var(--graph-cluster-stroke) !important;
    stroke-dasharray: 6 4 !important;
    stroke-width: 1px !important;
  }
  .svg-host :global(g.cluster .cluster-label),
  .svg-host :global(g.cluster .nodeLabel) {
    color: var(--graph-text) !important;
    fill: var(--graph-text) !important;
  }

  /* Engine-emitted tag classes (machines-demo owns the palette).
     The engine v7 can emit per-tag hash colors via classDef; the demo
     overrides that with ONE coherent treatment across any `tag_*` so
     tagged states all read as the same role (entry-point + any user-
     applied tag). Mermaid still adds the `tag_<name>` class to the
     node's <g> even after stripEngineStyling removes the engine's
     classDefs — that's what we hook into here. */
  .svg-host :global(g.node[class*='tag_'] rect),
  .svg-host :global(g.node[class*='tag_'] polygon),
  .svg-host :global(g.node[class*='tag_'] circle),
  .svg-host :global(g.node[class*='tag_'] path) {
    fill: var(--graph-node-tagged-fill) !important;
    stroke: var(--graph-node-tagged-stroke) !important;
    stroke-width: 1.5px !important;
  }
  .svg-host :global(g.node[class*='tag_'] path[fill='none']) {
    fill: none !important;
  }
  .svg-host :global(g.node[class*='tag_'] path[stroke='none']) {
    stroke: none !important;
  }

  /* Halt node — preserve the double-stroke "terminal" affordance.
     Mermaid emits halt as an outer-circle (ring) + inner-circle (disc);
     style them as a hollow ring + solid disc so terminal states read
     distinctly from regular circles. */
  .svg-host :global(g.node .outer-circle) {
    fill: none !important;
    stroke: var(--graph-node-halt-stroke) !important;
    stroke-width: 1.5px !important;
  }
  .svg-host :global(g.node .inner-circle) {
    fill: var(--graph-node-halt-inner-fill) !important;
    stroke: var(--graph-node-halt-stroke) !important;
  }

  /* Thick (==>) edges = stack-push call; mermaid emits class
     `edge-thickness-thick`. We unify color with regular edges and let
     the natural stroke-width carry the weight differentiation. */
  .svg-host :global(.edge-thickness-thick.flowchart-link),
  .svg-host :global(path.edge-thickness-thick) {
    stroke: var(--graph-edge-thick) !important;
  }
  /* Dotted (-. enter / onHalt .->) — synthetic / structural arrows. */
  .svg-host :global(.edge-pattern-dotted.flowchart-link),
  .svg-host :global(path.edge-pattern-dotted),
  .svg-host :global(.edge-pattern-dashed.flowchart-link),
  .svg-host :global(path.edge-pattern-dashed) {
    stroke: var(--graph-edge-dotted) !important;
  }

  /* Highlight rules (machines-demo#10).
     Listed AFTER the tag + edge rules so source order wins on fill.
     `!important` still required on stroke / stroke-width to beat
     mermaid's per-id selectors injected into the SVG's own <style>
     block (`#mg-N .node rect { stroke: ... }`) with ID specificity
     (100) that author class-only rules can't beat without it. */
  .svg-host :global(g.node.mg-highlight-from rect),
  .svg-host :global(g.node.mg-highlight-from polygon),
  .svg-host :global(g.node.mg-highlight-from circle),
  .svg-host :global(g.node.mg-highlight-from path[fill]:not([fill='none'])),
  .svg-host :global(g.node.mg-highlight-to rect),
  .svg-host :global(g.node.mg-highlight-to polygon),
  .svg-host :global(g.node.mg-highlight-to circle),
  .svg-host :global(g.node.mg-highlight-to path[fill]:not([fill='none'])) {
    fill: var(--graph-highlight-soft-fill) !important;
  }
  .svg-host :global(g.node.mg-highlight-from rect),
  .svg-host :global(g.node.mg-highlight-from polygon),
  .svg-host :global(g.node.mg-highlight-from circle),
  .svg-host :global(g.node.mg-highlight-from path[stroke]:not([stroke='none'])),
  .svg-host :global(g.node.mg-highlight-to rect),
  .svg-host :global(g.node.mg-highlight-to polygon),
  .svg-host :global(g.node.mg-highlight-to circle),
  .svg-host :global(g.node.mg-highlight-to path[stroke]:not([stroke='none'])) {
    stroke: var(--graph-highlight) !important;
    stroke-width: 2px !important;
    transition: fill 150ms ease, stroke 150ms ease, stroke-width 150ms ease;
  }

  .svg-host :global(g.node.mg-highlight-strong rect),
  .svg-host :global(g.node.mg-highlight-strong polygon),
  .svg-host :global(g.node.mg-highlight-strong circle),
  .svg-host :global(g.node.mg-highlight-strong path[fill]:not([fill='none'])) {
    fill: var(--graph-highlight-strong-fill) !important;
  }
  .svg-host :global(g.node.mg-highlight-strong rect),
  .svg-host :global(g.node.mg-highlight-strong polygon),
  .svg-host :global(g.node.mg-highlight-strong circle),
  .svg-host :global(g.node.mg-highlight-strong path[stroke]:not([stroke='none'])) {
    stroke-width: 4px !important;
    filter: drop-shadow(0 0 6px var(--graph-highlight));
  }

  /* Qualified with `.flowchart-link` so this beats the dotted/thick
     edge rules (which use two-class selectors at specificity 0,3,1) —
     without the extra class qualifier the single-class highlight rule
     loses to the dotted rule on the dotted "enter" arrow. */
  .svg-host :global(path.flowchart-link.mg-highlight-edge),
  .svg-host :global(path.mg-highlight-edge),
  .svg-host :global(.mg-highlight-edge path) {
    stroke: var(--graph-highlight) !important;
    stroke-width: 2.5px !important;
    transition: stroke 150ms ease, stroke-width 150ms ease;
  }
</style>
