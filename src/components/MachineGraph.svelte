<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { toMermaid, type Graph } from '@turing-machine-js/machine';
    import {
    applyHighlight,
    applyIndicator,
    bareIdOf,
    equivalentIds,
    indexGraph,
    type GraphHighlight,
    type GraphIndexes,
    type HighlightOps,
    type NodeKey,
  } from '@turing-machine-js/visuals';
  import type { BreakpointKind } from '../lib/types.ts';
  import { theme } from '../lib/theme.svelte.ts';
  import { icons } from '../lib/icons.ts';
  import { summariseGraph } from '../lib/graphSummary.ts';
  import { computeCenterScroll, computeFitZoom } from '../lib/scrollCenter.ts';

  type Props = {
    graph: Graph | null;
    /** `from + edge + to` triple to highlight in the SVG. `null` clears any
     *  active highlight. Driven by MachineView mode + pause-response
     *  data. */
    highlight?: GraphHighlight | null;
    /** Monotonic per-event counter from the worker. Used
     *  as a reactivity tick: when two consecutive paused events have
     *  structurally identical highlights (Copy-tape step-mode looping on
     *  id:1), the $derived wouldn't re-run and this $effect wouldn't
     *  re-fire — so the pulse would never restart. Reading it in the effect
     *  body subscribes the effect to per-event ticks. */
    stepsApplied?: number;
    collapsed: boolean;
    onToggleCollapsed: () => void;
    /** When true, the demo-shaped affordances disappear: the collapse
     *  chevron is hidden (showcase panels always stay open), and the
     *  breakpoint right-click context menu is suppressed (no debugger
     *  flow in a prerecorded panel). Zoom / aim / pan / wheel-zoom stay
     *  available — the user still wants to look around big showcase
     *  graphs. The imperative render pipeline is
     *  unaffected. Default `false` preserves the full interactive
     *  behaviour for `MachineView`. */
    readOnly?: boolean;
    /** When true, the panel detaches into a fixed-position 80vw×80vh
     *  overlay (single-instance: same mermaid render, no DOM move).
     *  Backdrop + click-out closing are managed by the parent so this
     *  component stays presentational. */
    expanded?: boolean;
    /** When provided, the header shows an expand / collapse toggle. The
     *  same icon button switches between maximize (inline) and minimize
     *  (expanded) glyphs. Omit to hide the toggle entirely. */
    onExpand?: () => void;
    /** Called when mermaid render fails, so MachineView can surface the
     *  error in the main log (not just in this panel's own error slot).
     *  Optional — caller can omit if they don't need it. */
    onRenderError?: (message: string) => void;
    /** Set of canonical bare ids with at least one active breakpoint
     *  kind. Read by the indicator effect to render the
     *  visual mark on toggled nodes; reactive via SvelteSet. Empty /
     *  omitted when the parent hasn't wired breakpoints yet. */
    breakpoints?: ReadonlySet<number>;
    /** Per-state kinds for the context menu's checkmarks. Keyed by the
     *  same canonical bare ids as `breakpoints`. Reads the `before` and
     *  `after` bits to show ☑/☐ next to each menu item. Required when
     *  `onToggleBreakpoint` is set. */
    breakpointKinds?: ReadonlyMap<number, { before: boolean; after: boolean }>;
    /** Called with the engine `GraphNode.id` + kind when the user picks a
     *  context-menu item over a state node. Halt-marker
     *  (negative ids) and the halt singleton (id 0) are filtered out before
     *  this fires — the consumer can assume `stateId` references a regular,
     *  bare, or wrapper State. Omitted when the parent doesn't want clicks
     *  routed (e.g., view-only contexts). */
    onToggleBreakpoint?: (stateId: number, kind: BreakpointKind) => void;
    /** Fired when the rendered SVG has mounted and the internal `nodeCache`
     *  is populated — i.e., the moment imperative consumers (`SnippetPanel`)
     *  can usefully call `getOps()` / `clearHighlights()` and see the
     *  highlights actually render. May fire multiple times across re-renders
     *  (theme swap, direction swap, graph change). Optional. */
    onReady?: () => void;
  };

  let {
    graph,
    highlight = null,
    stepsApplied = 0,
    collapsed,
    onToggleCollapsed,
    expanded = false,
    onExpand,
    onRenderError,
    breakpoints,
    breakpointKinds,
    onToggleBreakpoint,
    readOnly = false,
    onReady,
  }: Props = $props();

  // Screen-reader-friendly summary of the graph.
  // The rendered SVG carries no text alternative; this is the parallel
  // structural view AT users get. Rendered into the `.sr-only` block
  // below — visible UI unchanged.
  const summary = $derived(graph ? summariseGraph(graph) : null);

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

  // User-controlled zoom level applied to the rendered SVG via the
  // `--mg-zoom` CSS custom property (see `.svg-host :global(svg)`).
  // CSS `zoom` was picked over `transform: scale` because it affects
  // both visual AND layout box, so `.body`'s overflow:auto scrollbars
  // track the zoomed content size correctly. Applied DIRECTLY on the
  // svg (not the host wrapper) — Chrome computes child intrinsic
  // sizing oddly when the parent itself has CSS zoom, which would
  // cancel out the size change at certain widths.
  let zoom = $state(1);
  const ZOOM_MIN = 0.25;
  const ZOOM_MAX = 4;
  const ZOOM_STEP = 1.2; // multiplicative — each button click is 20% bigger / smaller

  function clampZoom(z: number): number {
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
  }

  // Zoom by a multiplicative factor, keeping the point at (anchorClientX,
  // anchorClientY) — in viewport coords — fixed under the cursor / on
  // screen. When no anchor is given, defaults to the panel viewport
  // center, so button clicks zoom toward the visible middle. Wheel /
  // pinch passes the pointer position so the content under the cursor
  // stays put.
  //
  // Implementation reads the SVG's bounding rect rather than computing
  // body-space scroll math directly. The reason: the body's scrollable
  // content is `padding-top + SVG + padding-bottom` (the virtual pan
  // canvas), and only the SVG portion scales with zoom — the padding
  // is constant. A naïve "scale all content by ratio" formula drifts
  // by the padding contribution. Instead:
  //   1. capture the SVG-space coord under the anchor (pre-zoom):
  //        sv = (anchor - svgRect) / z0
  //   2. apply the new zoom (synchronously updates `--mg-zoom`)
  //   3. after layout (tick), the SVG has a new rect at its new size
  //      and untouched position; the same SVG point now renders at
  //        viewport pos = svgRectNew.{left|top} + sv * z1
  //      shift body scroll by the delta to align it back to the anchor.
  function zoomBy(factor: number, anchorClientX?: number, anchorClientY?: number): void {
    const body = svgHostEl?.closest<HTMLElement>('.body');
    if (!body) { zoom = clampZoom(zoom * factor); return; }
    const z0 = zoom;
    const z1 = clampZoom(z0 * factor);
    if (z0 === z1) return;
    // Close any open context menu — the menu is positioned at fixed
    // viewport coords, but the node it anchors to is about to move
    // under the zoom. Re-opening at the new location would require
    // tracking the SVG point; closing is the simpler / clearer UX.
    if (menuStateId !== null) closeMenu();
    const rect = body.getBoundingClientRect();
    const ax = anchorClientX ?? rect.left + rect.width / 2;
    const ay = anchorClientY ?? rect.top + rect.height / 2;

    const svgEl = svgHostEl?.querySelector('svg');
    let svX: number | null = null;
    let svY: number | null = null;
    if (svgEl) {
      const svgRect = svgEl.getBoundingClientRect();
      // SVG-space coord under the cursor — divide out the CURRENT zoom
      // (svgRect dimensions already include the CSS `zoom` transform).
      svX = (ax - svgRect.left) / z0;
      svY = (ay - svgRect.top) / z0;
    }

    zoom = z1;

    void tick().then(() => {
      if (svgEl && svX !== null && svY !== null) {
        const svgRectNew = svgEl.getBoundingClientRect();
        // Post-zoom viewport position the same SVG point now occupies;
        // delta-add to scroll so it lands back at the anchor.
        body.scrollLeft += svgRectNew.left + svX * z1 - ax;
        body.scrollTop += svgRectNew.top + svY * z1 - ay;
      }
    });
  }

  function zoomIn(): void { zoomBy(ZOOM_STEP); }
  function zoomOut(): void { zoomBy(1 / ZOOM_STEP); }
  function zoomReset(): void { zoomBy(1 / zoom); }

  // Aim: scroll the current highlight target into view; fall back to
  // the `idle` entry node when nothing is currently highlighted (e.g.
  // before first Step). Always centers in the panel viewport (smooth)
  // — the user explicitly asked, so don't do the "skip if already in
  // view" check the `scrollIntoView` op uses.
  function aim(): void {
    const body = svgHostEl?.closest<HTMLElement>('.body');
    if (!body) return;
    let targetEl: SVGElement | undefined;
    if (highlight) {
      const id = highlight.strong === 'from' ? highlight.fromId : highlight.toId;
      if (typeof id === 'number' || id === 'idle') {
        targetEl = nodeCache.get(id);
      }
    }
    if (!targetEl) targetEl = nodeCache.get('idle');
    if (targetEl) {
      centerInScroller(body, targetEl, 'smooth');
    } else {
      body.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
    }
  }

  // Pan-availability flag: only show the grab cursor / accept pan
  // gestures when the body has something to scroll. Recomputed on
  // `svg` change (new graph) and `zoom` change (zoom can introduce or
  // eliminate overflow). Without this, small graphs show a grab cursor
  // and let users drag for no visible effect — misleading UX.
  let canPan = $state(false);

  // Drag-to-pan state. Single concurrent pan only (panPointerId), so a
  // second pointer landing mid-pan is ignored — touch-zoom is left to
  // the browser's native pinch + the wheel handler below.
  let panActive = $state(false);
  let panBody: HTMLElement | null = null;
  let panPointerId: number | null = null;
  let panStartX = 0;
  let panStartY = 0;
  let panStartScrollLeft = 0;
  let panStartScrollTop = 0;

  function onBodyPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return; // left mouse only; right is reserved for the BP context menu
    if (!canPan) return; // nothing to scroll → ignore drag (cursor reflects this too)
    if (panActive) return;
    // Suppress the browser's default mousedown action — specifically,
    // starting a text selection. Without this, dragging across the
    // panel and out into surrounding chrome (editor, log) would
    // extend the selection into those regions; `.body.panning` only
    // applies `user-select: none` to descendants of .body. preventDefault
    // here stops the selection from beginning at all, no matter where
    // the cursor travels.
    e.preventDefault();
    const body = e.currentTarget as HTMLElement;
    panActive = true;
    panBody = body;
    panPointerId = e.pointerId;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panStartScrollLeft = body.scrollLeft;
    panStartScrollTop = body.scrollTop;
    // Pointer capture routes subsequent move / up events to the body
    // even if the cursor leaves the element — prevents stuck "grabbing"
    // cursor when releasing outside the panel.
    body.setPointerCapture(e.pointerId);
  }
  function onBodyPointerMove(e: PointerEvent): void {
    if (!panActive || panBody === null || e.pointerId !== panPointerId) return;
    panBody.scrollLeft = panStartScrollLeft - (e.clientX - panStartX);
    panBody.scrollTop = panStartScrollTop - (e.clientY - panStartY);
  }
  function onBodyPointerUp(e: PointerEvent): void {
    if (!panActive || e.pointerId !== panPointerId) return;
    panBody?.releasePointerCapture(e.pointerId);
    panActive = false;
    panBody = null;
    panPointerId = null;
  }

  // Wheel-zoom: `ctrlKey` is fired by both ctrl+scroll (mouse wheel) and
  // trackpad pinch (browsers synthesize ctrl+wheel for pinch gestures),
  // so one handler covers both. Plain wheel (no modifier) falls through
  // to the browser's default vertical scroll on .body.
  //
  // Continuous factor via `exp(-deltaY * k)` so trackpad pinch (tiny
  // deltaY per event, fired rapidly) feels snappy and mouse-wheel
  // ticks (typically ±100 deltaY) zoom in big steps. k = 0.012 — a
  // single mouse-wheel tick gives ≈3× / ÷3 zoom; trackpad pinch
  // reaches the clamp in a flick or two. Anchor at the cursor so the
  // content under the pointer stays put (clamping at ZOOM_MIN /
  // ZOOM_MAX absorbs any single-event overshoot).
  function onBodyWheel(e: WheelEvent): void {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const factor = Math.exp(-e.deltaY * 0.012);
    zoomBy(factor, e.clientX, e.clientY);
  }

  // Element caches built after each render. Keyed by engine GraphNode.id
  // (or `'idle'` for the synthetic sentinel). Walked once per render —
  // subsequent highlight changes look up directly without re-querying
  // the SVG. Deliberately non-reactive: the cache is mutated as a side
  // effect of rendering and consumed imperatively in the highlight
  // effect; SvelteMap would track reads and trigger spurious work.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const nodeCache = new Map<NodeKey, SVGElement>();
  // frameId → corresponding `<g class="cluster">` element. Mermaid emits
  // each subgraph as a cluster whose id stringifies as `[object Object]`
  // (mermaid v11 bug), so we match on the cluster-label text instead and
  // map back via the engine-derived `indexes.frameLabelToId`.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const clusterCache = new Map<number, SVGElement>();
  // Derived from the engine graph by `indexGraph` once per cache-build
  // pass: nodeFrameMap, frameWrappersMap, frameLabelToId. Read-only here.
  // See `src/lib/graphIndexes.ts` and `applyHighlight.ts` for usage.
  let indexes: GraphIndexes = { nodeFrameMap: new Map(), frameWrappersMap: new Map(), frameLabelToId: new Map() };

  // Aborts the previous cache-build pass's contextmenu listeners before the
  // next pass attaches new ones. Mermaid's render cache (`lastSource`) skips
  // the SVG re-render when the source is byte-identical, so the same DOM
  // elements persist across cache-build re-fires — without this controller,
  // `addEventListener` calls stack up on the same `g.node` and a single
  // user right-click would fire N menu handlers.
  let clickListenersController: AbortController | null = null;

  // Context-menu state. When set, the menu is open over
  // the state node identified by `menuStateId` at viewport coordinates
  // (menuX, menuY). Closing happens via outside-click, ESC, or item-pick.
  // The clamped position is computed after the menu mounts (we need to
  // measure its size to avoid spilling off the viewport edge).
  let menuStateId = $state<number | null>(null);
  let menuX = $state(0);
  let menuY = $state(0);
  let menuEl = $state<HTMLDivElement | undefined>();
  let menuOutsideController: AbortController | null = null;

  function openMenu(stateId: number, clientX: number, clientY: number): void {
    menuStateId = stateId;
    menuX = clientX;
    menuY = clientY;
  }

  function closeMenu(): void {
    menuStateId = null;
    menuOutsideController?.abort();
    menuOutsideController = null;
  }

  // Install global outside-pointer + ESC handlers while the menu is open.
  // The controller is aborted on close so handlers detach cleanly.
  //
  // `pointerdown` (not `mousedown`) — the body's pan handler calls
  // `e.preventDefault()` on pointerdown to suppress text selection,
  // which ALSO suppresses the compat mousedown that follows. Listening
  // to mousedown would never fire for body-pan clicks and the menu
  // would feel "stuck". Checking on down (not click) is intentional:
  // clicks INSIDE the menu hit the menu's button onclick first; if we
  // closed on click we'd race the pick handler.
  $effect(() => {
    if (menuStateId === null) return;
    menuOutsideController?.abort();
    menuOutsideController = new AbortController();
    const signal = menuOutsideController.signal;
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (menuEl && e.target instanceof Node && menuEl.contains(e.target)) return;
        closeMenu();
      },
      { signal },
    );
    window.addEventListener(
      'keydown',
      (e) => { if (e.key === 'Escape') closeMenu(); },
      { signal },
    );
    // Close on body scroll — covers wheel-scroll, scrollbar drag,
    // grab-pan (the pan handler mutates scrollLeft/scrollTop, which
    // fires this), and programmatic scrolls from the aim button.
    // Anything that moves the SVG under the (fixed-positioned) menu
    // makes the anchor stale, so dismiss rather than leave it dangling.
    const body = svgHostEl?.closest<HTMLElement>('.body');
    if (body) {
      body.addEventListener('scroll', () => closeMenu(), { signal, passive: true });
    }
  });

  // Clamp the menu position to the viewport after it renders so it never
  // spills off the right or bottom edge. Re-runs whenever menuEl mounts
  // or the requested coords change. The clamped values feed the inline
  // `left`/`top` style on the menu element below.
  let menuClampedX = $state(0);
  let menuClampedY = $state(0);
  $effect(() => {
    if (!menuEl || menuStateId === null) return;
    // Read coords now so the effect re-fires when they change.
    void menuX; void menuY;
    const rect = menuEl.getBoundingClientRect();
    const margin = 8;
    let x = menuX;
    let y = menuY;
    if (x + rect.width + margin > window.innerWidth) x = window.innerWidth - rect.width - margin;
    if (y + rect.height + margin > window.innerHeight) y = window.innerHeight - rect.height - margin;
    if (x < margin) x = margin;
    if (y < margin) y = margin;
    menuClampedX = x;
    menuClampedY = y;
  });

  // Strong-node id from the most recent PAUSED apply.
  // The pulse condition is "paused on the same state as the previous
  // paused event" — idles never trigger or update this. Reset to null on
  // highlight-clear so a mode transition doesn't leave stale state matching
  // the next paused event spuriously. Owned by the apply-highlight effect
  // here; the rule logic lives in `applyHighlight` (returns next value).
  let lastPausedStrongId: NodeKey | null = null;
  // The frame currently carrying `mg-frame-active`. Tracked separately
  // from the rest of the highlight classes so we can SKIP the
  // strip-then-re-add cycle on the cluster element — that cycle's
  // intermediate "no class" state is briefly painted by the browser
  // even with no CSS transition, reading as a frame "pulse" each iter.
  // For nodes/edges the strip-all is fine (the set of highlighted
  // elements changes per iter); for the frame, the active cluster
  // usually persists across many iters within the same callable
  // subtree, so toggling on actual change is a clean win.
  let lastFrameActiveId: number | null = null;

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
      clickListenersController?.abort();
      clickListenersController = null;
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

  // Center an element inside a scrollable ancestor on both axes,
  // unconditionally. Used by the post-render effect to land the user on
  // the `idle` entry node; no visibility check because we want a fresh
  // build to actively reset the viewport regardless of prior scroll.
  function centerInScroller(scroller: HTMLElement, el: Element, behavior: ScrollBehavior = 'auto'): void {
    const containerRect = scroller.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const elCenterY = elRect.top + elRect.height / 2;
    const containerCenterY = containerRect.top + containerRect.height / 2;
    const elCenterX = elRect.left + elRect.width / 2;
    const containerCenterX = containerRect.left + containerRect.width / 2;
    scroller.scrollTo({
      top: scroller.scrollTop + (elCenterY - containerCenterY),
      left: scroller.scrollLeft + (elCenterX - containerCenterX),
      behavior,
    });
  }

  // Center an element inside the scrollable ancestor when it isn't sitting
  // comfortably inside the viewport. "Comfortable" means
  // fully inside the inner 80% of the body (10% inset on each side); a node
  // that drifts into the edge band or off-screen gets pulled back to the
  // center on that axis. Per-axis check is independent — a node fine
  // vertically but slipping past the right edge gets a horizontal-only
  // recenter, leaving the user's vertical scroll alone. Pure math lives in
  // `lib/scrollCenter.ts`; this is the DOM-touching wrapper.
  //
  // Previous policy (`scrollIntoViewIfNeeded`) only fired when the node was
  // FULLY outside the body — a node sitting at the edge with a sliver still
  // visible never triggered, so showcase snippet playback "looked frozen"
  // for big graphs.
  function centerIfNeeded(scroller: HTMLElement, el: Element, behavior: ScrollBehavior = 'smooth'): void {
    const target = computeCenterScroll(
      scroller.getBoundingClientRect(),
      { left: scroller.scrollLeft, top: scroller.scrollTop },
      el.getBoundingClientRect(),
    );
    if (target === null) return;
    scroller.scrollTo({ ...target, behavior });
  }

  // Resolve the scroll behavior honoring `prefers-reduced-motion`. Users who
  // opt out of animation get an instant jump instead of a sliding viewport,
  // matching the rest of the demo (SnippetPanel's playback already gates on
  // the same media query).
  function preferredScrollBehavior(): ScrollBehavior {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'smooth';
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth';
  }

  // Replace mermaid's `width="100%"` + inline `max-width: <intrinsic>px`
  // on the returned SVG with an explicit pixel width derived from the
  // viewBox. With width="100%" present, Chrome computes the SVG's
  // intrinsic content size as 0, so a CSS rule like
  // `min-width: max-content` evaluates to 0 and won't act as a floor.
  // Stripping it and writing a concrete pixel width makes max-content
  // resolve to the actual viewBox width, so CSS can express the rule
  // "scale up to fill big containers, scroll in narrow ones" as
  // `width: 100%; min-width: max-content`.
  //
  // Implementation note: we stage the SVG in a throwaway hidden div and
  // read `svg.viewBox.baseVal` — the typed DOM API — instead of regexing
  // the markup. The regex would work and is half the code, but it locks
  // us into mermaid's exact emit shape (attribute order, quoting,
  // self-closing). The DOM API is what the browser uses to interpret
  // viewBox, so by definition our reading matches whatever the SVG
  // actually means. The cost is one document-fragment-style allocation
  // we discard immediately. The visible host never sees this stage.
  function rewriteSvgSizing(svgMarkup: string): string {
    const stage = document.createElement('div');
    stage.style.cssText = 'position:fixed;left:-10000px;top:-10000px;visibility:hidden;pointer-events:none;';
    document.body.appendChild(stage);
    try {
      stage.innerHTML = svgMarkup;
      const el = stage.querySelector('svg');
      if (!el) return svgMarkup;
      const vb = el.viewBox.baseVal;
      if (vb.width <= 0 || vb.height <= 0) return svgMarkup;
      el.setAttribute('width', `${vb.width}px`);
      el.setAttribute('height', `${vb.height}px`);
      // Mermaid's inline `style="max-width: <intrinsic>px"` would cap the
      // CSS `width: 100%` upscale at the intrinsic width — defeat it at
      // the source so the visible CSS doesn't need !important fights.
      el.removeAttribute('style');
      return el.outerHTML;
    } finally {
      document.body.removeChild(stage);
    }
  }

  async function renderGraph(
    m: typeof import('mermaid').default,
    g: Graph,
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
    // Clear the prior SVG immediately so the template falls through to
    // the "Rendering…" placeholder while `m.render()` is in flight.
    // Without this, a new build (or theme / direction swap) keeps the
    // stale graph on screen for the duration of the async render and
    // the user perceives Build itself as slow. The cache-build effect
    // tracks `svg` and tears down its listener controller; on the new
    // SVG it rebuilds the node / cluster caches.
    svg = '';
    lastSource = null;
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
      svg = rewriteSvgSizing(result.svg);
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
    void graph; // re-run when graph changes (drives indexes)
    nodeCache.clear();
    clusterCache.clear();
    // Cluster elements are new after the rebuild — any old reference
    // would point at a detached cluster (no-op classList ops). Reset
    // the tracker so the next apply re-fetches from the fresh cache.
    lastFrameActiveId = null;
    // Derived graph lookups — pure transformation of `graph`, see
    // `src/lib/graphIndexes.ts`. Stored read-only for use by the
    // apply-highlight + indicator effects below.
    indexes = indexGraph(graph);
    // Detach the previous pass's listeners before we re-attach below.
    clickListenersController?.abort();
    clickListenersController = new AbortController();
    const listenerSignal = clickListenersController.signal;
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
      // cluster IS user-facing for the frame-active border, but that lookup
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
      // Attach a contextmenu (right-click) listener for
      // breakpoint-eligible nodes. Left-click stays native (text selection,
      // focus, etc); the menu opens at cursor coords with per-kind items.
      // Skip only the `'idle'` sentinel (no underlying State). Halt
      // singleton (id 0) and halt markers (negative ids) ARE clickable —
      // they all map to the haltState class via `bareIdOf`, surfacing the
      // global breakpoint info in the menu.
      if (!readOnly && onToggleBreakpoint && typeof key === 'number') {
        el.style.cursor = 'context-menu';
        el.classList.add('node-clickable');
        el.addEventListener(
          'contextmenu',
          (e) => {
            e.preventDefault();
            openMenu(key, e.clientX, e.clientY);
          },
          { signal: listenerSignal },
        );
      }
    });
    // Populate the per-frame cluster cache. Mermaid v11 stringifies the
    // subgraph's id object as the literal `[object Object]` in the DOM, so
    // we can't extract `w_<n>` from `el.id`. Match by cluster-label text
    // (`indexes.frameLabelToId` is the engine-side reconstruction of those
    // labels — same construction as `toMermaid`'s emit).
    root.querySelectorAll<SVGElement>('g.cluster').forEach((el) => {
      const labelText = el.querySelector('.cluster-label')?.textContent?.trim();
      if (!labelText) return;
      const frameId = indexes.frameLabelToId.get(labelText);
      if (frameId === undefined) return;
      if (!clusterCache.has(frameId)) clusterCache.set(frameId, el);
    });
    // Materialize highlight-color variants of mermaid's shared
    // markers. Mermaid emits one `<marker>` per arrowhead shape
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

  // After each new render: pick a zoom that keeps ≥60% of the SVG's area
  // visible inside the body, then center the `idle` entry node so the user
  // lands on the diagram's start.
  //
  // Why both passes share an effect:
  //   - The zoom adjustment changes `.svg-host`'s laid-out width / height,
  //     which moves every node's bounding rect — centering before the
  //     zoom settles would aim at stale coordinates.
  //   - Resetting to 1 first gives `getBoundingClientRect` a known scale
  //     to read the SVG's intrinsic viewBox dimensions against the body's
  //     padding-deducted content box.
  //
  // Sequence: zoom = 1 → await tick (cache-build + layout) → measure +
  // computeFitZoom → set zoom if smaller than 1 → await tick → center.
  // The same idle-centered initial view applies to engine pages and
  // readOnly showcase panels — earlier the showcase opened on the SVG's
  // content centroid (which on callable-subtree graphs landed between the
  // main flow and the subgraph, looking empty).
  $effect(() => {
    void svg;
    if (!svg || !svgHostEl) return;
    zoom = 1;
    void tick().then(async () => {
      const body = svgHostEl?.closest<HTMLElement>('.body');
      const svgEl = svgHostEl?.querySelector('svg');
      if (!body || !svgEl) return;
      // viewBox is the intrinsic SVG size at zoom = 1; body's clientWidth /
      // clientHeight reflect the scroll-area box. Padding is excluded so
      // the fit math compares "visible area" against "true SVG area".
      const vb = svgEl.viewBox.baseVal;
      const cs = window.getComputedStyle(body);
      const padH = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const padV = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
      const fitZoom = computeFitZoom(
        vb.width,
        vb.height,
        Math.max(0, body.clientWidth - padH),
        Math.max(0, body.clientHeight - padV),
      );
      const clamped = clampZoom(fitZoom);
      if (clamped !== zoom) {
        zoom = clamped;
        await tick();
      }
      const idle = nodeCache.get('idle');
      if (idle) {
        centerInScroller(body, idle, 'auto');
      } else {
        body.scrollTo({ left: 0, top: 0 });
      }
    });
  });

  // Track whether the body actually has scrollable overflow. Drives the
  // `cursor: grab` cue + the pointerdown gate so a fits-in-panel graph
  // doesn't pretend to be draggable. Re-runs on svg AND zoom changes;
  // zoom can introduce overflow (zoom in) or remove it (zoom out).
  // The +1px tolerance absorbs sub-pixel rounding in scrollWidth /
  // clientWidth comparisons.
  $effect(() => {
    void svg;
    void zoom;
    if (!svg || !svgHostEl) { canPan = false; return; }
    void tick().then(() => {
      const body = svgHostEl?.closest<HTMLElement>('.body');
      if (!body) { canPan = false; return; }
      canPan = body.scrollWidth > body.clientWidth + 1
        || body.scrollHeight > body.clientHeight + 1;
    });
  });

  // Shared highlight-clear pass: strips the four highlight classes and
  // restores arrowhead markers. Used by the internal apply-highlight effect
  // AND the exported `clearHighlights()` method (which `SnippetPanel` calls
  // before each `applyHighlight` since the visuals contract requires
  // additive ops over an already-cleared canvas).
  function _clearHighlightsImpl(root: SVGSVGElement): void {
    root
      .querySelectorAll('.mg-highlight-from, .mg-highlight-to, .mg-highlight-strong, .mg-highlight-edge')
      .forEach((el) => {
        el.classList.remove(
          'mg-highlight-from',
          'mg-highlight-to',
          'mg-highlight-strong',
          'mg-highlight-edge',
        );
        if (el.tagName === 'path' && el.hasAttribute('data-mg-orig-marker-end')) {
          el.setAttribute('marker-end', el.getAttribute('data-mg-orig-marker-end')!);
          el.removeAttribute('data-mg-orig-marker-end');
        }
      });
  }

  /**
   * Imperative API: wipe previously-applied highlight classes + marker swaps
   * from the rendered SVG. Required before each `applyHighlight` call per
   * the visuals contract (`HighlightOps` is purely additive). No-op if the
   * SVG hasn't mounted yet. Also clears any active frame cluster.
   *
   * Used by `SnippetPanel` for prerecorded playback; the internal
   * apply-highlight effect uses `_clearHighlightsImpl` directly and skips
   * the frame-active strip (it diffs frame transitions separately).
   */
  export function clearHighlights(): void {
    if (!svgHostEl) return;
    const root = svgHostEl.querySelector('svg');
    if (!root) return;
    _clearHighlightsImpl(root);
    // External callers don't track lastFrameActiveId, so wipe the active
    // cluster too — they'll re-set it from the next frame's highlight.
    root.querySelectorAll('.mg-frame-active').forEach((el) => {
      el.classList.remove('mg-frame-active');
    });
  }

  /**
   * Imperative API: scroll the synthetic `idle` entry node to the center of
   * the body viewport. Called by `SnippetPanel.onReplay`
   * so a Replay-clicked panel rewinds the scroll position to the same view
   * the user got on first mount, instead of resuming from wherever the last
   * frame's highlight had pushed the viewport. No-op when the SVG / cache
   * isn't ready or `idle` was somehow stripped. Honors
   * `prefers-reduced-motion` via `preferredScrollBehavior`.
   */
  export function recenterOnIdle(): void {
    if (!svgHostEl) return;
    const body = svgHostEl.closest<HTMLElement>('.body');
    if (!body) return;
    const idle = nodeCache.get('idle');
    if (!idle) return;
    centerInScroller(body, idle, preferredScrollBehavior());
  }

  /**
   * Imperative API: a fresh `HighlightOps` bound to the current SVG, for
   * external callers (`SnippetPanel`) that drive `applyHighlight` on their
   * own schedule. Each call returns a new object — cheap (closes over
   * cached DOM refs); call before each `applyHighlight` so it picks up any
   * post-render cache rebuild. Returns `null` when the SVG isn't mounted.
   *
   * Unlike the internal apply-highlight effect, this ops impl toggles
   * `mg-frame-active` directly (no diff against a prior frame) — the
   * external caller is expected to pair each `applyHighlight` with a
   * preceding `clearHighlights()`.
   */
  export function getOps(): HighlightOps | null {
    if (!svgHostEl) return null;
    const root = svgHostEl.querySelector('svg');
    if (!root) return null;
    return {
      addNodeClass(id, cls) {
        nodeCache.get(id)?.classList.add(cls);
      },
      highlightEdge(fromKey, toKey) {
        for (let ix = 0; ix < 10; ix++) {
          const els = root.querySelectorAll<SVGElement>(
            `[data-id="L_${fromKey}_${toKey}_${ix}"]`,
          );
          if (els.length === 0) continue;
          els.forEach((el) => {
            el.classList.add('mg-highlight-edge');
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
      },
      markFrameActive(frameId) {
        clusterCache.get(frameId)?.classList.add('mg-frame-active');
      },
      pulse(id) {
        nodeCache.get(id)?.animate(
          [{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }],
          { duration: 220, easing: 'ease-in-out' },
        );
      },
      scrollIntoView(id) {
        const el = nodeCache.get(id);
        if (!el) return;
        void tick().then(() => {
          const scrollContainer = svgHostEl?.closest<HTMLElement>('.body');
          if (!scrollContainer) return;
          centerIfNeeded(scrollContainer, el, preferredScrollBehavior());
        });
      },
    };
  }

  // Fire `onReady` when the SVG has mounted AND the cache is populated —
  // the moment external imperative callers can usefully start applying
  // frames. Re-fires per render (graph / theme / direction swap).
  $effect(() => {
    void svg;
    if (!svg || !svgHostEl) return;
    if (nodeCache.size === 0) return;
    onReady?.();
  });

  // Breakpoint indicator effect. Runs on
  // `breakpoints` change AND on `svg` change (cache repopulates on SVG
  // re-render). Delegates the rule logic to `applyIndicator`; the ops
  // object below is a thin DOM adapter that toggles `mg-breakpoint` per
  // node. See the rules doc `docs/graph-highlight-and-breakpoints.md`
  // shipped in `@turing-machine-js/visuals`, §2 + §12.
  $effect(() => {
    const bps = breakpoints;
    void svg;
    if (!svgHostEl) return;
    applyIndicator(bps ?? new Set(), graph, nodeCache.keys(), {
      setBreakpoint(id, on) {
        const el = nodeCache.get(id);
        if (!el) return;
        if (on) el.classList.add('mg-breakpoint');
        else el.classList.remove('mg-breakpoint');
      },
    });
  });

  // Apply highlight whenever it (or the rendered SVG) changes. The rule
  // logic lives in the pure `applyHighlight` function (see
  // `src/lib/applyHighlight.ts` + `docs/graph-highlight-and-breakpoints.md`);
  // this effect is a thin DOM adapter — it clears previous classes,
  // builds a DOM-backed `HighlightOps`, calls the pure function, and
  // stores the returned next-prev for the pulse comparison.
  //
  // Reactivity gotcha: every reactive value the effect should re-fire on
  // MUST be read in the effect body before any early `return`. Svelte 5
  // tracks deps by what's actually read during the run. The first thing
  // we do is read `highlight`, `svg`, and `stepsApplied` so all three
  // become subscribed deps unconditionally.
  $effect(() => {
    const h = highlight;
    void svg; // track render output — cache repopulates on re-render
    void stepsApplied; // tick: re-fire on every worker event even when
    // the highlight object is structurally identical to the previous one
    // (Copy-tape step-mode looping on the same state — without this read,
    // Svelte's fine-grained reactivity skips the apply).
    if (!svgHostEl) return;
    const root = svgHostEl.querySelector('svg');
    if (!root) return;
    // Clear previous highlight classes + marker-end restore via the shared
    // `clearHighlights()` helper. `mg-frame-active` is INTENTIONALLY
    // excluded from the strip — it's toggled below based on what
    // applyHighlight actually requests, so the active cluster's class
    // persists across consecutive in-frame iters (no visible blink).
    _clearHighlightsImpl(root);

    // Capture the frame the rule evaluator wants active (if any) so we
    // can diff against `lastFrameActiveId` and toggle only on change.
    let requestedFrameId: number | null = null;

    // Apply via the pure rule evaluator. The ops impl below is the only
    // DOM-touching code; the function decides WHICH ops to call.
    const { nextPrevStrongId } = applyHighlight(h, graph, indexes, lastPausedStrongId, {
      addNodeClass(id, cls) {
        nodeCache.get(id)?.classList.add(cls);
      },
      highlightEdge(fromKey, toKey) {
        // Mermaid emits `L_${from}_${to}_${ix}` per edge; we don't know
        // which ix fired (engine doesn't expose it). Walk 0..9 and take
        // the first match — for self-loops + multi-edge-to-same-target
        // this can over-highlight, acceptable for v1. Multiple elements
        // (path + label) share a data-id; tag all of them so CSS can color
        // the label to match the highlighted edge.
        for (let ix = 0; ix < 10; ix++) {
          const els = root.querySelectorAll<SVGElement>(
            `[data-id="L_${fromKey}_${toKey}_${ix}"]`,
          );
          if (els.length === 0) continue;
          els.forEach((el) => {
            el.classList.add('mg-highlight-edge');
            // Swap arrowhead to the `-mg-hl` variant materialized in the
            // cache-build effect, so the end-triangle picks up
            // `--graph-highlight`. Non-path elements (edge label `<g>`)
            // have no marker-end and are skipped.
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
      },
      markFrameActive(frameId) {
        // Just record the request — the actual DOM toggle happens
        // post-apply, diff'd against `lastFrameActiveId` so the cluster
        // doesn't get a remove+add cycle on every in-frame iter.
        requestedFrameId = frameId;
      },
      pulse(id) {
        nodeCache.get(id)?.animate(
          [{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }],
          { duration: 220, easing: 'ease-in-out' },
        );
      },
      scrollIntoView(id) {
        const el = nodeCache.get(id);
        if (!el) return;
        // Delegates to `centerIfNeeded` (defined above) so a paused state
        // sitting in the edge band gets pulled back to the center
        // — the previous "fully outside" policy left
        // partially-visible nodes alone, which read as a frozen viewport
        // on long subroutine chains. Manual offset math (vs
        // `Element.scrollIntoView`) avoids browser quirks around scrolling
        // SVG-contained elements and respects `prefers-reduced-motion` via
        // `preferredScrollBehavior`.
        void tick().then(() => {
          const scrollContainer = svgHostEl?.closest<HTMLElement>('.body');
          if (!scrollContainer) return;
          centerIfNeeded(scrollContainer, el, preferredScrollBehavior());
        });
      },
    });
    lastPausedStrongId = nextPrevStrongId;

    // Post-apply frame toggle — only mutate the cluster's classList when
    // the active frame actually changed since last apply. Skipping the
    // strip-and-re-add cycle for the (common) consecutive-in-frame case
    // removes the visible frame "pulse" the user reported.
    if (requestedFrameId !== lastFrameActiveId) {
      if (lastFrameActiveId !== null) {
        clusterCache.get(lastFrameActiveId)?.classList.remove('mg-frame-active');
      }
      if (requestedFrameId !== null) {
        clusterCache.get(requestedFrameId)?.classList.add('mg-frame-active');
      }
      lastFrameActiveId = requestedFrameId;
    }
  });
</script>

<section class="machine-graph" class:expanded aria-label="Machine graph">
  <header class="header">
    {#if expanded || readOnly}
      <!-- In expanded (modal) mode the chevron collapse toggle is hidden:
           collapsing while the modal is open would leave a header-only
           strip floating with no content — a confusing dead state. The
           minimize button (header-actions, right side) is the single
           way out of modal mode.
           In readOnly mode the toggle is also hidden — showcase panels
           are always expanded and their collapsed state is controlled by
           the parent. -->
      <span class="title">Machine graph</span>
    {:else}
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
    {/if}
    {#if !collapsed}
      <div class="header-actions">
        <button
          type="button"
          class="action"
          onclick={zoomOut}
          disabled={zoom <= ZOOM_MIN || !svg}
          title="Zoom out (Ctrl/Cmd + scroll down)"
          aria-label="Zoom out"
        >{@html icons.zoomOut}</button>
        <button
          type="button"
          class="action zoom-reset"
          onclick={zoomReset}
          disabled={zoom === 1 || !svg}
          title="Reset zoom to 100%"
          aria-label="Reset zoom"
        >{@html icons.zoomReset}</button>
        <button
          type="button"
          class="action"
          onclick={zoomIn}
          disabled={zoom >= ZOOM_MAX || !svg}
          title="Zoom in (Ctrl/Cmd + scroll up)"
          aria-label="Zoom in"
        >{@html icons.zoomIn}</button>
        {#if !readOnly}
          <!-- "Scroll to current state" reads the `highlight` prop to find
               the target. Showcase panels (SnippetPanel) drive the
               highlight imperatively via `getOps` instead of passing the
               prop, so the button would always fall back to scrolling to
               idle — misleading given the label. The Replay-time
               `recenterOnIdle()` call already covers the "back to entry"
               UX for those panels; the aim affordance is engine-only. -->
          <button
            type="button"
            class="action"
            onclick={aim}
            disabled={!svg}
            title="Scroll to current state (or entry if none)"
            aria-label="Scroll to current state"
          >{@html icons.target}</button>
        {/if}
        {#if onExpand}
          <button
            type="button"
            class="action"
            onclick={onExpand}
            title={expanded ? 'Collapse machine graph' : 'Open machine graph in modal'}
            aria-label={expanded ? 'Collapse machine graph' : 'Open machine graph in modal'}
          >{@html expanded ? icons.collapse : icons.expand}</button>
        {/if}
      </div>
    {/if}
  </header>

  {#if summary}
    <!-- a11y: text alternative for the rendered SVG.
         Always rendered when a graph exists — must remain available when
         visually collapsed, since the rendered SVG is the only path for
         sighted users and this is the only path for AT users. Derived
         purely from the engine `Graph` snapshot via `summariseGraph`. -->
    <section class="sr-only" aria-label="Machine graph text representation">
      <p>
        State diagram with {summary.stateCount}
        {summary.stateCount === 1 ? 'state' : 'states'}{#if summary.haltCount > 0}, {summary.haltCount} halt {summary.haltCount === 1 ? 'node' : 'nodes'}{/if}.
      </p>
      {#if summary.states.length > 0}
        <ol>
          {#each summary.states as state (state.id)}
            <li>
              <strong>{state.name}</strong>{#if state.isWrapper}
                — wrapper, calls subroutine
              {/if}
              {#if state.transitions.length === 0}
                <span> — no outgoing transitions</span>
              {:else}
                <ul>
                  {#each state.transitions as t, ix (ix)}
                    <li>
                      On {t.readsPhrase}: {t.commandsPhrase}, then goes to <strong>{t.targetName}</strong>.
                    </li>
                  {/each}
                </ul>
              {/if}
            </li>
          {/each}
        </ol>
      {/if}
    </section>
  {/if}

  {#if !collapsed}
    <!-- role="application" tells AT this region has its own keyboard /
         pointer model (pan + zoom) and isn't a generic text region. -->
    <div
      class="body"
      class:panning={panActive}
      class:can-pan={canPan}
      data-testid="machine-graph-body"
      role="application"
      aria-label="Machine graph viewport (drag to pan, Ctrl+scroll to zoom)"
      onpointerdown={onBodyPointerDown}
      onpointermove={onBodyPointerMove}
      onpointerup={onBodyPointerUp}
      onpointercancel={onBodyPointerUp}
      onwheel={onBodyWheel}>
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
        <div class="svg-host" class:menu-open={menuStateId !== null} bind:this={svgHostEl} style:--mg-zoom={zoom}>{@html svg}</div>
      {:else}
        <div class="loading">Rendering…</div>
      {/if}
    </div>
  {/if}
</section>

{#if menuStateId !== null && breakpointKinds && onToggleBreakpoint && graph}
  {@const canonicalId = bareIdOf(menuStateId, graph)}
  {@const kinds = breakpointKinds.get(canonicalId) ?? { before: false, after: false }}
  {@const isHaltClass = canonicalId === 0}
  {@const nodeName = graph.nodes[menuStateId]?.name ?? ''}
  {@const sharedNames =
    isHaltClass
      ? []
      : equivalentIds(menuStateId, graph)
          .filter((id) => id !== menuStateId)
          .map((id) => graph.nodes[id]?.name)
          .filter((n): n is string => typeof n === 'string' && n.length > 0)}
  <div
    bind:this={menuEl}
    role="menu"
    tabindex="-1"
    class="bp-menu"
    style:left="{menuClampedX}px"
    style:top="{menuClampedY}px"
  >
    <!-- Menu stays open after a kind toggle so the user can flip the
         other kind in the same gesture without re-opening. Dismiss
         channels are still: outside-click, Esc, or selecting another
         node (which opens a new menu at the new position). -->
    <!-- For halt: a single "Pause" checkbox — the engine collapsed
         haltState.debug to a boolean (one meaningful pause moment, fires on
         the AFTER side of the halt-triggering iter). The toggle still routes
         through the `before` kind name in the worker protocol for backward
         compatibility with the breakpoint-coordination plumbing — the worker
         translates this to `haltState.debug = true/false` rather than the
         per-side DebugConfig shape used by non-halt states. -->
    <button
      type="button"
      role="menuitem"
      class="bp-menu-item"
      onclick={() => onToggleBreakpoint(menuStateId!, 'before')}
    >
      <span class="bp-menu-check" class:on={kinds.before} aria-hidden="true">
        {@html kinds.before ? icons.checkboxChecked : icons.checkboxEmpty}
      </span>
      <span>{isHaltClass ? 'Pause' : 'Pause before'}</span>
    </button>
    {#if !isHaltClass}
      <button
        type="button"
        role="menuitem"
        class="bp-menu-item"
        onclick={() => onToggleBreakpoint(menuStateId!, 'after')}
      >
        <span class="bp-menu-check" class:on={kinds.after} aria-hidden="true">
          {@html kinds.after ? icons.checkboxChecked : icons.checkboxEmpty}
        </span>
        <span>Pause after</span>
      </button>
    {/if}
    {#if nodeName}
      <button
        type="button"
        role="menuitem"
        class="bp-menu-item bp-menu-action"
        onclick={() => { void navigator.clipboard.writeText(nodeName); closeMenu(); }}
      >
        <span class="bp-menu-check" aria-hidden="true">
          {@html icons.copy}
        </span>
        <span>Copy name</span>
      </button>
    {/if}
    {#if isHaltClass}
      <div class="bp-menu-info">
        Global — affects all halts in the runtime
      </div>
    {:else if sharedNames.length > 0}
      <div class="bp-menu-info">
        Shared with: {sharedNames.join(', ')}
      </div>
    {/if}
  </div>
{/if}

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

  /* Expanded ("modal") mode: the parent renders this component inside a
     native <dialog>. The dialog provides the
     centered 80vw × 80vh box, focus trap, Escape, and ::backdrop dimmer;
     all this component does in expanded mode is fill its container and
     drop the inline 360px body cap so the graph uses the modal's full
     height. */
  .machine-graph.expanded .body {
    height: auto;
    flex: 1 1 auto;
    min-height: 0;
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

  /* Header action cluster: zoom out / reset / in + expand toggle.
     Shared `.action` button style (was `.expand` before zoom landed). */
  .header-actions {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .action {
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

    &:hover:not(:disabled) {
      background: var(--hover-bg);
      color: var(--fg);
    }
    &:disabled {
      opacity: 0.4;
      cursor: default;
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
    /* The grab cursor + drag gesture are gated on `.can-pan` so a
       fits-in-panel graph doesn't pretend to be draggable. While the
       user drags, switch to grabbing and suppress text selection so
       the gesture reads as "I'm dragging the canvas" rather than
       "I'm trying to select an SVG label". Pointer capture (see
       onBodyPointerDown) routes the move events back to .body even
       when the cursor leaves the panel mid-drag. */
    &.can-pan { cursor: grab; }
    &.panning {
      cursor: grabbing;
      user-select: none;
    }
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
    /* Block (NOT flex). With `display: flex; justify-content: center`,
       a child wider than the parent overflows symmetrically on both
       sides, but parent `overflow: auto` can only scroll into positive
       offsets — the left half of an overflowing SVG becomes unreachable.
       Using block + `margin: 0 auto` on the SVG centers it when it fits
       and falls back to left-aligned + horizontal scroll on .body when
       it doesn't (`margin: auto` resolves to 0 if content exceeds
       container width). */
    display: block;
    /* Virtual pan canvas: extend the host's layout box beyond the body
       viewport so even fits-in-panel graphs always overflow on BOTH
       axes and become grabbable. Two mechanisms because the axes are
       constrained differently:
       - Vertical via `padding: 25vmin 0` — padding always contributes
         to `scrollHeight`, independent of how the parent's height was
         computed. We need that path specifically because in expanded
         mode the body is a `flex: 1 1 auto` column item and Chrome
         doesn't treat flex-grow-derived heights as definite for
         percent resolution; `min-height` based on `100%` collapsed
         to ~0 there.
       - Horizontal via `min-width: calc(100% + 50vmin)` — host's
         layout width is always ≥ body + 50vmin, so even a tiny SVG
         produces 50vmin of horizontal pan room. A plain `min-width:
         100%` clamps the host to body width and the horizontal
         padding ends up INSIDE the host (contributing nothing to
         body's scrollable extent); the explicit `+ 50vmin` is what
         makes the body actually overflow horizontally.
       The SVG inside centers via `margin: 0 auto`; the post-render
       scroll-to-idle lands the entry node in the panel center. */
    padding: 25vmin 0;
    min-width: calc(100% + 50vmin);
  }

  /* While the context menu is open, suppress the `cursor: context-menu`
     affordance we set imperatively on breakpoint-eligible nodes — right-
     click is no longer the action (the menu is already showing), and the
     pointer-shape change reads as a stale hint. Inline `style.cursor`
     wins by default, so `!important` is required to override. */
  .svg-host.menu-open :global(g.node) {
    cursor: default !important;
  }

  /* Hover affordance for breakpoint-eligible nodes (class `node-clickable`
     attached imperatively when the contextmenu listener is wired). Thicken
     the outline rather than tinting the fill so the cue is theme-agnostic
     and doesn't fight with the per-tag / halt / highlight palette. Skipped
     while the menu is open — the hover hint reads as stale once the menu
     is already showing. */
  .svg-host :global(g.node.node-clickable rect),
  .svg-host :global(g.node.node-clickable polygon),
  .svg-host :global(g.node.node-clickable circle),
  .svg-host :global(g.node.node-clickable path) {
    transition: stroke-width var(--anim-button-hover-ms);
  }
  .svg-host:not(.menu-open) :global(g.node.node-clickable:hover rect),
  .svg-host:not(.menu-open) :global(g.node.node-clickable:hover polygon),
  .svg-host:not(.menu-open) :global(g.node.node-clickable:hover circle),
  .svg-host:not(.menu-open) :global(g.node.node-clickable:hover path:not([stroke='none'])) {
    stroke-width: 2px !important;
  }

  .svg-host :global(svg) {
    /* Intrinsic sizing: render at the explicit pixel width set by
       `rewriteSvgSizing` (i.e. viewBox width). When the SVG is wider
       than the panel, `.body`'s `overflow: auto` produces a horizontal
       scrollbar. When narrower, `margin: 0 auto` centers it; the auto
       margin collapses to 0 when content exceeds the parent so the
       left edge stays scrollable.
       Zoom is applied DIRECTLY on the SVG via the `--mg-zoom` custom
       property (driven from script). Putting zoom on the SVG (not the
       host) avoids a Chrome quirk where parent `zoom` cancels out the
       child's intrinsic sizing rules — that's why the previous
       "smart sizing + zoom-on-host" combo showed the graph at the
       same size regardless of zoom level. */
    display: block;
    width: auto;
    max-width: none;
    margin: 0 auto;
    zoom: var(--mg-zoom, 1);
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

  /* Highlight rules.
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

  /* Breakpoint indicator. A red stroke on the
     node's outer shape signals an active `state.debug.before = true`
     breakpoint. Decoupled from `--graph-highlight` (which is amber/orange
     for the running-machine cue) and from `--head` (the tape head marker)
     so the three runtime indicators stay visually distinct. The dot/●
     glyph from the issue's UX proposal is layer 2 work — for layer 1 the
     stroke-only indicator is enough to surface "this state has a
     breakpoint" without DOM injection into mermaid's foreignObject
     labels. */
  .svg-host :global(g.node.mg-breakpoint rect),
  .svg-host :global(g.node.mg-breakpoint polygon),
  .svg-host :global(g.node.mg-breakpoint circle),
  .svg-host :global(g.node.mg-breakpoint path[stroke]:not([stroke='none'])) {
    stroke: var(--graph-breakpoint) !important;
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
    /* No transition — the frame's activate/deactivate would otherwise
       pulse twice per call (once on enter, once on exit), reading as
       visual noise. State pulses (§11 via Element.animate on the strong
       node) are unaffected — those are intentional same-state-revisit
       cues. */
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

  /* Breakpoint context menu. Positioned fixed at the
     viewport coordinates the right-click reported (clamped by the
     `menuClampedX/Y` effect so it never spills off an edge). Floats above
     everything else via a high z-index; matches the demo's surface tokens
     so it reads as part of the panel family. */
  .bp-menu {
    position: fixed;
    z-index: 1000;
    min-width: 160px;
    padding: 4px 0;
    background: var(--editor-bg);
    border: 1px solid var(--cell-border);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgb(0 0 0 / 0.25);
    font-size: 13px;
  }

  .bp-menu-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 10px;
    background: none;
    border: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background var(--anim-button-hover-ms);

    &:hover,
    &:focus-visible {
      background: var(--hover-bg);
    }
  }

  .bp-menu-check {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    color: inherit;

    :global(svg) {
      width: 16px;
      height: 16px;
      display: block;
    }
  }

  /* Secondary menu actions (Copy name) sit below the breakpoint toggles
     with a thin separator above so the action types read as distinct
     groups. */
  .bp-menu-action {
    margin-top: 4px;
    border-top: 1px solid var(--cell-border);
  }

  /* Info line under the per-kind menu items. Two uses:
     - Wrapper / bare class: "Shared with: <other class members>" so the
       user can see at a glance that flipping this breakpoint also flips
       the sibling node(s) via the engine's shared #debugRef.
     - Halt class: "Global — …" since haltState is an engine-wide
       singleton, not a per-graph state. */
  .bp-menu-info {
    /* Symmetric padding all around: horizontal matches `.bp-menu-item`
       (10px each side), vertical matches the items' 6px so the text
       sits in the same visual rhythm as the items above. `margin-top`
       gives the separator (border-top) a small breathing gap from the
       last item's bottom edge. */
    margin-top: 4px;
    padding: 6px 10px;
    border-top: 1px solid var(--cell-border);
    color: var(--muted);
    font-size: 12px;
    line-height: 1.4;
  }

</style>
