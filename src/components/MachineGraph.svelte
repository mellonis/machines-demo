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
    /** Monotonic per-event counter from the worker (machines-demo#10). Used
     *  as a reactivity tick: when two consecutive paused events have
     *  structurally identical highlights (Copy-tape step-mode looping on
     *  id:1), the $derived wouldn't re-run and this $effect wouldn't
     *  re-fire — so the pulse would never restart. Reading it in the effect
     *  body subscribes the effect to per-event ticks. */
    stepsApplied?: number;
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
    stepsApplied = 0,
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
  // GraphNode.id → containing callable-subtree frameId, derived from the
  // engine's Graph (machines-demo#10). Drives the "frame active" border
  // highlight when the strong state lives inside a subgraph.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const nodeFrameMap = new Map<number, number>();
  // frameId → corresponding `<g class="cluster">` element. Mermaid emits
  // each subgraph as a cluster whose id contains the subgraph token
  // (`w_<frameId>`), so we extract the number once at render time.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const clusterCache = new Map<number, SVGElement>();
  // frameId → list of wrappers calling into that frame, each with the
  // wrapper's GraphNode id and the wrapper's override-target id (the
  // post-return continuation; `null` if the override is the engine's halt
  // singleton). Drives the "return chain" highlight when an in-frame
  // transition halts the bare: light up the return arrow `w_N → wrapper`,
  // the wrapper node, the wrapper-to-override edge, and the override
  // target — so the user sees the full post-pop visual path.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const frameWrappersMap = new Map<number, { wrapperId: number; overrideId: number | null }[]>();

  // Strong-node id from the most recent PAUSED apply (machines-demo#10).
  // The pulse condition is "paused on the same state as the previous
  // paused event" — idles never trigger or update this. Reset to null on
  // highlight-clear so a mode transition doesn't leave stale state matching
  // the next paused event spuriously.
  let lastPausedStrongId: number | 'idle' | null = null;

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
    void graph; // re-run when graph changes (drives nodeFrameMap)
    nodeCache.clear();
    edgeCache.clear();
    nodeFrameMap.clear();
    clusterCache.clear();
    frameWrappersMap.clear();
    if (graph) {
      for (const node of Object.values(graph.nodes)) {
        if (node.frameId !== null) nodeFrameMap.set(node.id, node.frameId);
      }
      // For each wrapper, find which frame it calls into (via its bare's
      // frameId) and append to frameWrappersMap[frameId]. Multiple wrappers
      // can share the same bare with different overrides; we record them all
      // and the apply-highlight effect highlights each — visually surfacing
      // any ambiguity when the engine pops the stack at halt.
      for (const node of Object.values(graph.nodes)) {
        if (!node.isWrapper || node.bareStateId === null) continue;
        const bare = graph.nodes[node.bareStateId];
        if (!bare || bare.frameId === null) continue;
        const entry = { wrapperId: node.id, overrideId: node.overriddenHaltStateId };
        const arr = frameWrappersMap.get(bare.frameId);
        if (arr) arr.push(entry);
        else frameWrappersMap.set(bare.frameId, [entry]);
      }
    }
    if (!svgHostEl) return;
    const root = svgHostEl.querySelector('svg');
    if (!root) return;
    root.querySelectorAll<SVGElement>('g.node').forEach((el) => {
      // id shape: `${renderId}-flowchart-${nodeId}-${suffix}`. Extract `nodeId`.
      // `sN` → numeric state id N. `cN` → halt marker for frame N, keyed as
      // negative -N (engine doc: "halt marker id = -frameId"); the highlight
      // effect retargets `toId === 0` (real halt) to `-frameId` when the
      // source state lives inside frame N, so the visible edge ends at the
      // in-frame marker rather than the outside real-halt singleton.
      // `idle` → synthetic entry sentinel. `w_N` → subgraph wrapper (the
      // cluster IS user-facing for #10 frame-active border, but that lookup
      // uses clusterCache, not nodeCache).
      const m = el.id.match(/-flowchart-(s\d+|idle|c\d+|w_\d+)-/);
      if (!m) return;
      const tok = m[1];
      const key: number | 'idle' | null =
        tok === 'idle' ? 'idle'
        : tok.startsWith('s') ? Number(tok.slice(1))
        : tok.startsWith('c') ? -Number(tok.slice(1))
        : null; // w_N skipped here — clusterCache handles those.
      if (key === null) return;
      if (!nodeCache.has(key)) nodeCache.set(key, el);
    });
    root.querySelectorAll<SVGElement>('[data-id^="L_"]').forEach((el) => {
      const dataId = el.getAttribute('data-id');
      if (!dataId) return;
      // Multiple elements (path + label) share a data-id; first one wins.
      if (!edgeCache.has(dataId)) edgeCache.set(dataId, el);
    });
    // Populate the per-frame cluster cache so the apply-highlight effect
    // can light up the enclosing subgraph border when m.state lives inside
    // a callable subtree. Mermaid v11 stringifies the subgraph's id object
    // as the literal `[object Object]` in the DOM, so we can't extract
    // `w_<n>` from `el.id`. Match by cluster-label text instead — the
    // engine emits a deterministic label per frame (`callable subtree of
    // NAME` for single-bare, `callable scope: A ∪ B …` for union, bare
    // names sorted by id; see `graphFormats.ts`) so we can recompute the
    // expected label from `graph` and map it back to frameId.
    if (graph) {
      // A frame-bare is a non-wrapper, non-halt-marker node that some
      // wrapper points at via `bareStateId`. Build one set so the per-frame
      // pass doesn't re-scan all nodes per check.
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      const bareIds = new Set<number>();
      for (const n of Object.values(graph.nodes)) {
        if (n.isWrapper && n.bareStateId !== null) bareIds.add(n.bareStateId);
      }
      // frameId → sorted-by-id bare names (engine sorts by id, see
      // `graphFormats.ts`).
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      const frameToBareNames = new Map<number, string[]>();
      for (const n of Object.values(graph.nodes).sort((a, b) => a.id - b.id)) {
        if (n.isWrapper || n.isHaltMarker || n.frameId === null) continue;
        if (!bareIds.has(n.id)) continue;
        const arr = frameToBareNames.get(n.frameId) ?? [];
        arr.push(n.name);
        frameToBareNames.set(n.frameId, arr);
      }
      // eslint-disable-next-line svelte/prefer-svelte-reactivity
      const labelToFrameId = new Map<string, number>();
      for (const [frameId, names] of frameToBareNames) {
        const label = names.length > 1
          ? `callable scope: ${names.join(' ∪ ')}`
          : `callable subtree of ${names[0] ?? frameId}`;
        labelToFrameId.set(label, frameId);
      }
      root.querySelectorAll<SVGElement>('g.cluster').forEach((el) => {
        // Cluster label is rendered into `.cluster-label` (a child `<g>`)
        // which holds a `<foreignObject>` with the literal label text.
        const labelText = el.querySelector('.cluster-label')?.textContent?.trim();
        if (!labelText) return;
        const frameId = labelToFrameId.get(labelText);
        if (frameId === undefined) return;
        if (!clusterCache.has(frameId)) clusterCache.set(frameId, el);
      });
    }
    // Materialize highlight-color variants of mermaid's shared markers
    // (machines-demo#10). Mermaid emits one `<marker>` per arrowhead shape
    // and colors them all from `#mg-N .marker { fill: lightgrey; ... }`, so
    // every arrowhead is grey regardless of its referencing edge's stroke.
    // `context-stroke` would fix this declaratively but isn't reliable
    // cross-browser yet; instead clone each marker into a sibling with id
    // suffix `-mg-hl`, tag its inner shape with `mg-hl-arrow-shape` so CSS
    // can fix fill/stroke to `--graph-highlight`, and swap a highlighted
    // path's `marker-end` to the variant at apply-highlight time.
    root.querySelectorAll<SVGMarkerElement>('marker.marker').forEach((marker) => {
      // Skip our own clones from a prior pass through this effect — otherwise
      // each re-fire (graph change + svg change in close succession) clones
      // the clones, layering `-mg-hl-mg-hl-…` indefinitely.
      if (marker.id.endsWith('-mg-hl')) return;
      const hlId = marker.id + '-mg-hl';
      if (root.querySelector(`#${CSS.escape(hlId)}`)) return; // already added
      const clone = marker.cloneNode(true) as SVGMarkerElement;
      clone.id = hlId;
      clone.querySelectorAll('.arrowMarkerPath').forEach((shape) => {
        shape.classList.add('mg-hl-arrow-shape');
      });
      marker.parentNode!.insertBefore(clone, marker.nextSibling);
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
    void stepsApplied; // tick: re-fire on every worker event even when
    // the highlight object is structurally identical to the previous one
    // (Copy-tape step-mode looping on the same state — without this read,
    // Svelte's fine-grained reactivity skips the apply).
    if (!svgHostEl) return;
    const root = svgHostEl.querySelector('svg');
    if (!root) return;
    // Clear previous highlight classes. No inline-style restore needed —
    // we strip the engine's classDef tags at render time so all visuals
    // are author-CSS-driven; toggling classes is enough.
    root.querySelectorAll('.mg-highlight-from, .mg-highlight-to, .mg-highlight-strong, .mg-highlight-edge, .mg-frame-active')
      .forEach((el) => {
        el.classList.remove('mg-highlight-from', 'mg-highlight-to', 'mg-highlight-strong', 'mg-highlight-edge', 'mg-frame-active');
        // Restore the original `marker-end` if we swapped it for the
        // highlight variant. Stored as a plain attribute (not dataset) so
        // we don't need to narrow `Element` to `SVGElement` here.
        if (el.tagName === 'path' && el.hasAttribute('data-mg-orig-marker-end')) {
          el.setAttribute('marker-end', el.getAttribute('data-mg-orig-marker-end')!);
          el.removeAttribute('data-mg-orig-marker-end');
        }
      });
    if (!h) {
      lastPausedStrongId = null;
      return;
    }
    // Retarget halt-bound transitions of in-frame states to that frame's
    // halt-marker node (id = -frameId). The engine reports
    // `nextStateId === 0` (real halt singleton) for any halt-bound
    // transition, but `toGraph` rewrites in-frame halts to the frame's
    // halt-marker (`cN`) and emits the visible edge ending there. Without
    // this translation the highlight would land on the real-halt circle
    // OUTSIDE the frame, and the edge lookup (`L_sX_s0_…`) would miss the
    // actually-emitted edge (`L_sX_cN_…`).
    let toId: number | null = h.toId;
    if (toId === 0 && typeof h.fromId === 'number') {
      const fromFrameId = nodeFrameMap.get(h.fromId);
      if (fromFrameId !== undefined) toId = -fromFrameId;
    }
    const fromEl = nodeCache.get(h.fromId);
    const toEl = toId !== null ? nodeCache.get(toId) : undefined;
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
    //
    // Mermaid emits multiple SVG elements with the same `data-id` for a
    // single edge — at minimum the `<path>` under `g.edgePaths` and the
    // `<g class="edgeLabel">` under `g.edgeLabels`. Walking via
    // querySelectorAll instead of the (first-wins) edgeCache lets us tag
    // both, so the CSS can color the label to match the highlighted edge.
    const highlightEdgeByDataId = (fromTok: string, toTok: string): void => {
      for (let ix = 0; ix < 10; ix++) {
        const els = root.querySelectorAll<SVGElement>(
          `[data-id="L_${fromTok}_${toTok}_${ix}"]`,
        );
        if (els.length === 0) continue;
        els.forEach((el) => {
          el.classList.add('mg-highlight-edge');
          // Swap the arrowhead on the `<path>` to its `-mg-hl` variant so
          // the end-triangle picks up the highlight color (the variants
          // are materialized in the cache-build effect above). Other
          // matching elements (e.g. the `<g class="label">` edge label)
          // have no `marker-end` and are skipped.
          if (el.tagName === 'path') {
            const orig = el.getAttribute('marker-end');
            if (orig && !el.hasAttribute('data-mg-orig-marker-end')) {
              el.setAttribute('data-mg-orig-marker-end', orig);
              el.setAttribute('marker-end', orig.replace(/\)$/, '-mg-hl)'));
            }
          }
        });
        return;
      }
    };
    const fromKey = h.fromId === 'idle' ? 'idle' : `s${h.fromId}`;
    const toKey = toId === null ? null
                : toId < 0 ? `c${-toId}` // halt-marker
                : `s${toId}`;
    if (toKey) highlightEdgeByDataId(fromKey, toKey);

    // Return chain (machines-demo#10): when the just-fired transition lands
    // on a frame's halt-marker (`toId < 0` means in-frame halt, set by the
    // retarget above), the engine will pop the stack and resume at the
    // wrapper's override. Light up the visual path so the user sees the
    // post-pop trajectory before the next iter relocates the strong node:
    //   return-arrow `w_N → wrapper` (dotted) + wrapper node
    //   + wrapper-to-override edge + override target node.
    // If multiple wrappers call into the frame (shared bare), we highlight
    // each — the engine's runtime choice depends on stack state which the
    // demo doesn't track, so surfacing the ambiguity beats picking one.
    if (toId !== null && toId < 0) {
      const frameId = -toId;
      const wrappers = frameWrappersMap.get(frameId) ?? [];
      for (const { wrapperId, overrideId } of wrappers) {
        highlightEdgeByDataId(`w_${frameId}`, `s${wrapperId}`);
        const wrapperEl = nodeCache.get(wrapperId);
        if (wrapperEl) wrapperEl.classList.add('mg-highlight-to');
        if (overrideId !== null) {
          highlightEdgeByDataId(`s${wrapperId}`, `s${overrideId}`);
          const overrideEl = nodeCache.get(overrideId);
          if (overrideEl) overrideEl.classList.add('mg-highlight-to');
        }
      }
    }
    // Frame highlight: when the strong state lives inside a callable-
    // subtree subgraph, mark the enclosing cluster so its border lights
    // up (CSS does border-only — fill stays unchanged so contained nodes
    // don't gain extra visual weight from the frame).
    const strongId = h.strong === 'from' ? h.fromId : h.toId;
    if (typeof strongId === 'number') {
      const frameId = nodeFrameMap.get(strongId);
      if (frameId !== undefined) {
        const clusterEl = clusterCache.get(frameId);
        if (clusterEl) clusterEl.classList.add('mg-frame-active');
      }
    }
    // Pulse only when THIS apply is a paused event AND lands on the same
    // state as the previous paused event. Idles never pulse and never
    // update lastPausedStrongId, so an idle that happens to report the
    // same state doesn't interfere. Web Animations API restarts on each
    // call without class-juggling.
    const strongEl = h.strong === 'from' ? fromEl : toEl;
    const pausedRevisit = h.paused && strongId !== null && strongId === lastPausedStrongId;
    if (strongEl && pausedRevisit) {
      strongEl.animate(
        [{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }],
        { duration: 220, easing: 'ease-in-out' },
      );
    }
    if (h.paused) lastPausedStrongId = strongId;
    // Scroll the strong node into view so users don't have to hunt for
    // it in large graphs. Manual offset math (vs Element.scrollIntoView)
    // keeps full control over the threshold + smooth scroll target and
    // is robust to whatever ancestor sizing/transform decisions the panel
    // adopts in the future.
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
  /* Subgraph (cluster) backgrounds. Mermaid's default emit gives clusters
     the same stroke color as state-node rects, so we restate fill/stroke
     here from our tokens to ensure the cluster reads distinctly from
     contained nodes via fill + a different stroke color, not via a dashed
     pattern. */
  .svg-host :global(g.cluster rect) {
    fill: var(--graph-cluster-fill) !important;
    stroke: var(--graph-cluster-stroke) !important;
    stroke-dasharray: 0 !important;
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

  /* Arrowheads / cross / circle endcaps inherit the referencing path's
     stroke color via `context-stroke`. Mermaid emits a single shared
     marker per shape under `<defs>` and styles it with `#mg-N .marker
     { fill: lightgrey; stroke: lightgrey }` — so without this override
     every endcap stays grey, including on a highlighted edge (the
     triangle reads as detached from its now-amber line). `context-stroke`
     lets one shared marker render in each referencing path's stroke
     color — also a bonus for the dotted enter / thick call edges, whose
     bodies were already colored but whose triangles weren't.
     Requires Chrome 123+ / Firefox / Safari 16.4+. In browsers without
     support this rule is silently dropped — the explicit `.mg-hl-arrow-shape`
     rule below still gives highlighted edges a colored triangle via the
     materialized `-mg-hl` marker variant. */
  .svg-host :global(.marker path.arrowMarkerPath),
  .svg-host :global(.marker circle.arrowMarkerPath),
  .svg-host :global(.marker polygon.arrowMarkerPath) {
    fill: context-stroke !important;
    stroke: context-stroke !important;
  }

  /* Explicit color for the inner shape of the materialized `-mg-hl` marker
     clones. The cache-build effect adds this class to each cloned shape
     so the highlighted edge's arrowhead is amber even in browsers without
     `context-stroke` support. Lower specificity than the `.marker path.arrowMarkerPath`
     rule above, but that rule's `context-stroke` is silently dropped where
     unsupported, leaving this one to apply. */
  .svg-host :global(.mg-hl-arrow-shape) {
    fill: var(--graph-highlight) !important;
    stroke: var(--graph-highlight) !important;
  }

  /* Edge label color when the edge is highlighted — pull text toward
     the highlight stroke color so the label reads as part of the same
     "this transition just fired" visual unit. Mermaid emits the edge
     label as `<g class="edgeLabel"><g class="label" data-id="L_..."><foreignObject>…`
     — the `data-id` lands on the INNER `g.label`, so that's what our
     querySelectorAll sweep tags with `mg-highlight-edge`. `g.label` is
     also used by node labels, but only edge labels carry `data-id` /
     pick up our class, so this selector is safe. */
  .svg-host :global(g.label.mg-highlight-edge),
  .svg-host :global(g.label.mg-highlight-edge *) {
    color: var(--graph-highlight) !important;
    transition: color 150ms ease;
  }

  /* Active callable-subtree frame: when the strong state lives inside a
     subgraph, the apply-highlight effect tags that subgraph's
     `<g class="cluster">` with this class. Border-only — only stroke is
     overridden, so the cluster's fill stays unchanged and contained
     nodes don't gain extra visual weight from the frame. The default
     `g.cluster rect` rule sets `stroke-dasharray: 0`, so the active
     border inherits solid (no need to restate). */
  .svg-host :global(g.cluster.mg-frame-active rect) {
    stroke: var(--graph-highlight) !important;
    stroke-width: 2px !important;
    transition: stroke 150ms ease, stroke-width 150ms ease;
  }

  /* Dim the weak end of the highlighted triple (the node that is NOT
     m.state) so the strong node reads as the focal point. Subtle —
     soft-fill already mutes it; this just adds a slight transparency on
     the whole node group. */
  .svg-host :global(g.node.mg-highlight-from:not(.mg-highlight-strong)),
  .svg-host :global(g.node.mg-highlight-to:not(.mg-highlight-strong)) {
    opacity: 0.65;
    transition: opacity 150ms ease;
  }
</style>
