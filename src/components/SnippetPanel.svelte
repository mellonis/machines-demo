<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import {
    SnippetPlayer,
    applyHighlight,
    indexGraph,
    tapeViewport,
    type GraphIndexes,
    type HighlightOps,
    type NodeKey,
    type Snippet,
  } from '@turing-machine-js/visuals';
  import MachineGraph from './MachineGraph.svelte';
  import TapesStack from './TapesStack.svelte';
  import { VIEWPORT_WIDTH } from '../lib/caps.ts';

  // The Vite snippets plugin (`src/vite-plugins/snippets.ts`) attaches
  // `engine` / `id` / `description` / `intervalMs` to each `Snippet` as
  // extension fields — `Snippet` itself has no `engine` field (it's
  // engine-agnostic in `@turing-machine-js/visuals`). SnippetPanel relies
  // on the extensions for caption, deep-link, and timing.
  type SnippetWithMeta = Snippet & {
    engine: 'turing' | 'post';
    id: string;
    description?: string;
    intervalMs?: number;
  };

  type Props = { snippet: SnippetWithMeta };
  let { snippet }: Props = $props();

  // Showcase palette mirrors MachineView's; only the first slot is used in
  // single-tape snippets (Phase 1 ships only single-tape). Kept inline to
  // keep SnippetPanel self-contained — promoting to a shared module is a
  // refactor for the day a snippet showcases multi-tape Turing programs.
  const CARET_COLORS: readonly string[] = [
    '#6ea8fe', '#ff6b6b', '#5fd068', '#c084fc', '#ffd166',
  ];

  const DEFAULT_INTERVAL_MS = 800;
  // Each SnippetPanel instance binds to one snippet for its lifetime (the
  // parent `Landing` uses `{#each snippets as s (s.id)}` — keyed iteration
  // remounts on id change, never swaps `snippet` in-place). Reading the
  // prop in initializers via `untrack` acknowledges the intentional
  // one-time read and silences Svelte 5's reactive-prop warning.
  const intervalMs = untrack(() => snippet.intervalMs ?? DEFAULT_INTERVAL_MS);
  const player = untrack(() => new SnippetPlayer(snippet));
  const graphIndexes: GraphIndexes = untrack(() => indexGraph(snippet.graph));
  // Per-tape blank symbol. The snippets plugin sets
  // `alphabets[i] = [...tape.alphabet.symbols]`; `Alphabet`'s symbols list
  // starts with the blank by codebase convention, so `[i][0]` is the blank.
  // Fallback to space matches the bundled Turing examples' default.
  const blanks: string[] = untrack(() => snippet.alphabets.map((a) => a[0] ?? ' '));
  const tapeCount = untrack(() => snippet.frames[0]?.tape.length ?? 1);
  const initialGraph = untrack(() => snippet.graph);
  const finalFrameIndex = untrack(() => snippet.frames.length - 1);
  const engine = untrack(() => snippet.engine);
  const snippetId = untrack(() => snippet.id);
  const caption = untrack(() => snippet.description ?? snippet.id);

  let frameIndex = $state(0);
  let done = $state(false);
  let reducedMotion = $state(false);
  let graphReady = $state(false);

  let panelEl: HTMLDivElement | undefined = $state();
  let machineGraphRef = $state<ReturnType<typeof MachineGraph> | undefined>();
  let tapesStackRef = $state<ReturnType<typeof TapesStack> | undefined>();

  // `applyHighlight`'s previous-strong-id thread. Owned per-panel — not
  // shared with the parent `MachineGraph` (which tracks its own
  // `lastPausedStrongId` for live runs).
  let prevStrongId: NodeKey | null = null;

  // Replay timer is hoisted into a $state so it's clearable from both the
  // AbortController abort listener (unmount during playback) AND `onReplay`
  // (avoids stacking timers when the user spams Replay).
  let replayTimerId: number | null = $state(null);

  function clearReplayTimer(): void {
    if (replayTimerId !== null) {
      window.clearInterval(replayTimerId);
      replayTimerId = null;
    }
  }

  function applyTapes(): void {
    const frame = player.currentFrame;
    frame.tape.forEach((snap, i) => {
      const blank = blanks[i] ?? ' ';
      const { cells, headIndex } = tapeViewport(snap, VIEWPORT_WIDTH, blank);
      tapesStackRef?.setTapeViewport(i, cells, headIndex, blank);
    });
  }

  function applyGraph(): void {
    if (!machineGraphRef) return;
    const ops: HighlightOps | null = machineGraphRef.getOps();
    if (!ops) return;
    machineGraphRef.clearHighlights();
    const frame = player.currentFrame;
    if (frame.highlight) {
      const { nextPrevStrongId } = applyHighlight(
        frame.highlight,
        initialGraph,
        graphIndexes,
        prevStrongId,
        ops,
      );
      prevStrongId = nextPrevStrongId;
    } else {
      prevStrongId = null;
    }
  }

  function applyFrame(): void {
    frameIndex = player.frameIndex;
    done = player.done;
    applyTapes();
    if (graphReady) applyGraph();
  }

  function clearGraphHighlights(): void {
    machineGraphRef?.clearHighlights();
    prevStrongId = null;
  }

  function startTimer(): void {
    clearReplayTimer();
    replayTimerId = window.setInterval(() => {
      if (!player.forward()) {
        // Playback reached the last frame on the previous tick. Clear the
        // residual highlight from that frame so the graph returns to neutral
        // before the Replay control sits idle on it (#108).
        clearGraphHighlights();
        clearReplayTimer();
        return;
      }
      applyFrame();
    }, intervalMs);
  }

  function onReplay(): void {
    player.reset();
    prevStrongId = null;
    applyFrame();
    if (!reducedMotion) startTimer();
  }

  function onGraphReady(): void {
    // First-ready paint: render the current frame so the user sees the
    // initial highlight (or final frame under reduced motion) instead of
    // a blank graph.
    if (graphReady) return;
    graphReady = true;
    applyGraph();
  }

  onMount(() => {
    const controller = new AbortController();
    const { signal } = controller;

    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reducedMotion) {
      player.goTo(finalFrameIndex);
      applyFrame();
      signal.addEventListener('abort', () => clearReplayTimer(), { once: true });
      return () => controller.abort();
    }

    // Frame 0 visible immediately before any scroll-in.
    applyFrame();

    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        startTimer();
      },
      { threshold: 0.5 },
    );
    if (panelEl) io.observe(panelEl);
    signal.addEventListener('abort', () => {
      io.disconnect();
      clearReplayTimer();
    }, { once: true });

    return () => controller.abort();
  });
</script>

<div class="snippet-panel" bind:this={panelEl} data-testid="snippet-panel">
  <!-- a11y: page heading hierarchy is <h1> (Landing) → <h2> (per snippet panel). -->
  <h2 class="caption">{caption}</h2>
  <div class="graph">
    <MachineGraph
      bind:this={machineGraphRef}
      graph={initialGraph}
      collapsed={false}
      onToggleCollapsed={() => {}}
      onReady={onGraphReady}
      readOnly
    />
  </div>
  <div class="tapes">
    <TapesStack
      bind:this={tapesStackRef}
      {tapeCount}
      caretColors={CARET_COLORS}
      readOnly
    />
  </div>
  <div class="meta" data-testid="snippet-frame-index">{frameIndex}</div>
  <div class="controls">
    {#if done}
      <button type="button" class="replay" onclick={onReplay}>
        {reducedMotion ? 'Play' : 'Replay'}
      </button>
    {/if}
    <a href={`/${engine}?example=${snippetId}`} class="open-in-editor">
      Open in editor
    </a>
  </div>
</div>

<style>
  .snippet-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    background: var(--editor-bg);
    border: 1px solid var(--cell-border);
    border-radius: var(--surface-radius);
    /* Tape's intrinsic width (--visible-cells * cell-width) can exceed the
       grid-track width on narrow layouts; clip rather than letting cells
       escape past the panel's border. */
    overflow: hidden;

    /* Showcase context — fewer cells visible than the engine pages (default
       --visible-cells is 19 desktop / 17 tablet / 11 phone). 13 fits a
       400-pixel-min grid track comfortably with room for head context on
       both sides. The mask in Tape.svelte fades edge cells, so partial
       symbols don't pop in/out as the head moves. */
    :global(.ui-belt) {
      --visible-cells: 13;

      @media (max-width: 480px) {
        --visible-cells: 9;
      }
    }
  }

  .caption {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--fg);
  }

  .graph {
    /* MachineGraph manages its own height (fixed 360px by default); this
       wrapper lets snippet-panel control the slot without re-styling the
       graph card. */
    min-width: 0;
  }

  .tapes {
    min-width: 0;
    display: flex;
    justify-content: center;
  }

  .meta {
    font-size: 0.75rem;
    color: color-mix(in srgb, var(--fg) 60%, transparent);
    font-family: ui-monospace, 'SF Mono', Consolas, monospace;
  }

  .controls {
    display: flex;
    align-items: center;
    gap: 12px;
    justify-content: flex-end;
  }

  .replay {
    padding: 6px 14px;
    background: var(--cell-bg);
    color: var(--fg);
    border: 1px solid var(--cell-border);
    border-radius: 6px;
    cursor: pointer;
    font: inherit;
  }

  .replay:hover {
    background: color-mix(in srgb, var(--cell-bg) 80%, var(--fg));
  }

  .open-in-editor {
    color: var(--fg);
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, var(--fg) 40%, transparent);
    font-size: 0.875rem;
  }

  .open-in-editor:hover {
    text-decoration-color: var(--fg);
  }
</style>
