<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import {
    SnippetPlayer,
    applyHighlight,
    bareIdOf,
    indexGraph,
    tapeViewport,
    type GraphHighlight,
    type GraphIndexes,
    type HighlightOps,
    type NodeKey,
    type Snippet,
  } from '@turing-machine-js/visuals';
  import MachineGraph from './MachineGraph.svelte';
  import TapesStack from './TapesStack.svelte';
  import ExecutionTraceTable from './ExecutionTraceTable.svelte';
  import { VIEWPORT_WIDTH } from '../lib/caps.ts';
  import { renderLessonMarkdown } from '../lib/lessonMarkdown.ts';

  // The Vite snippets plugin (`src/vite-plugins/snippets.ts`) attaches
  // `engine` / `id` / `description` / `intervalMs` to each `Snippet` as
  // extension fields — `Snippet` itself has no `engine` field (it's
  // engine-agnostic in `@turing-machine-js/visuals`). SnippetPanel relies
  // on the extensions for caption, deep-link, and timing.
  type SnippetWithMeta = Snippet & {
    engine: 'turing' | 'post';
    id: string;
    description?: string;
    /**
     * Rich learning-oriented prose authored per showcase (markdown subset:
     * paragraphs, bullet lists, inline code). Rendered into the right
     * column of the panel.
     */
    lessonNotes?: string;
    intervalMs?: number;
    // Raw `m.state.id` / `m.nextState.id` per iter (one entry per iter,
    // indexed by `step - 1`). Captured by the snippets Vite plugin via a
    // wrapper around `runStepByStep` so SnippetPanel can rebuild stepped-
    // shaped before-pause highlights — `recordSnippet`'s `Frame.highlight`
    // canonicalizes via `bareIdOf` and loses the wrapper info needed for
    // §2 expansion in `applyHighlight`.
    rawStateIds?: number[];
    rawNextStateIds?: number[];
  };

  type Props = {
    snippet: SnippetWithMeta;
    /**
     * Playback gate — Landing's IntersectionObserver orchestrates which
     * snippet is currently in focus so only one runs at a time. Default
     * `false` means the panel renders at frame 0 statically; flipping to
     * `true` resets the player and starts the timer. Ignored under
     * `prefers-reduced-motion: reduce` (the panel pins to the final frame
     * unconditionally).
     */
    active?: boolean;
  };
  let { snippet, active = false }: Props = $props();

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
  const lessonHtml = untrack(() =>
    snippet.lessonNotes
      ? renderLessonMarkdown(snippet.lessonNotes)
      : `<p>${snippet.description ?? snippet.id}</p>`,
  );
  const rawStateIds: number[] | undefined = untrack(() => snippet.rawStateIds);

  let frameIndex = $state(0);
  let done = $state(false);
  let reducedMotion = $state(false);
  let graphReady = $state(false);
  // True after natural playback end. Nulls out the trace's current-row
  // highlight so a finished panel reads as not-currently-playing — parallels
  // the graph's neutral clear at the same moment.
  let cleared = $state(true);
  // 4-state playback machine driven by `active` (see the "Playback
  // orchestration" $effect below). Plain closure variable — not $state — because the
  // active-toggle $effect reads AND writes it; making it reactive would
  // make the effect re-fire on every transition and loop indefinitely. The
  // template never reads it directly.
  let playbackState: 'idle' | 'playing' | 'paused' | 'done' = 'idle';
  let machineGraphRef = $state<ReturnType<typeof MachineGraph> | undefined>();
  let tapesStackRef = $state<ReturnType<typeof TapesStack> | undefined>();

  // `applyHighlight`'s previous-strong-id thread. Owned per-panel — not
  // shared with the parent `MachineGraph` (which tracks its own
  // `lastPausedStrongId` for live runs).
  let prevStrongId: NodeKey | null = null;

  // Plain closure variable — not $state. The active-toggle $effect calls
  // clearReplayTimer (which reads replayTimerId) AND startTimer (which
  // writes it); making it reactive would form a read/write feedback loop
  // and trip effect_update_depth_exceeded. Timer ID has no rendered
  // consumer, so reactivity is unnecessary.
  let replayTimerId: number | null = null;

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
    const highlight = buildSteppedHighlight(frame.step);
    if (highlight) {
      const { nextPrevStrongId } = applyHighlight(
        highlight,
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

  // Stepped (live) execution emits before-pause highlights — `strong: 'to'`,
  // `paused: true`, with `toId` as the RAW current state id so §2 expansion
  // in `applyHighlight` lights up wrapper + bare for the call-entry iter
  // (the subgraph cluster + `call` edge feel alive during the call). The
  // recorded `Frame.highlight` from `recordSnippet` is the after-iter shape
  // (`strong: 'from'`, bare-canonicalized fromId, no wrapper info) — using
  // it directly leaves the wrapper dim during playback, mismatching the
  // stepped ethalon. We rebuild here from the raw state-id sequence captured
  // by the snippets Vite plugin (`rawStateIds` / `rawNextStateIds`).
  //
  // Step indexing: `step === 0` is frame 0 (initial, no highlight). For
  // iter N (1-based), rawStateIds[N-1] = m.state.id, rawNextStateIds[N-1] =
  // m.nextState.id. Previous iter's bare id (for the `fromId`) is
  // `bareIdOf(rawStateIds[N-2])`, or `'idle'` for the first iter.
  function buildSteppedHighlight(step: number): GraphHighlight | null {
    if (step === 0 || !rawStateIds) {
      // Frame 0 has no highlight by spec; if rawStateIds is absent (snippet
      // produced by an older build) fall back to whatever recordSnippet
      // emitted so playback still shows something reasonable.
      if (step === 0) return null;
      const fallback = player.currentFrame.highlight;
      return fallback ?? null;
    }
    const idx = step - 1;
    if (idx < 0 || idx >= rawStateIds.length) return null;
    const currentRawId = rawStateIds[idx];
    const prevRawId = idx > 0 ? rawStateIds[idx - 1] : null;
    return {
      fromId: prevRawId === null ? 'idle' : bareIdOf(prevRawId, initialGraph),
      toId: currentRawId,
      strong: 'to',
      paused: true,
    };
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
        // before the Replay control sits idle on it.
        clearGraphHighlights();
        cleared = true;
        clearReplayTimer();
        playbackState = 'done';
        return;
      }
      applyFrame();
    }, intervalMs);
  }

  function startFresh(): void {
    cleared = false;
    player.reset();
    machineGraphRef?.recenterOnIdle();
    prevStrongId = null;
    applyFrame();
    startTimer();
    playbackState = 'playing';
  }

  function resumeTimer(): void {
    // Resume mid-playback without touching the player position. The graph +
    // tape state were preserved while paused, so just rearm the interval.
    startTimer();
    playbackState = 'playing';
  }

  function pauseTimer(): void {
    clearReplayTimer();
    playbackState = 'paused';
  }

  function onReplay(): void {
    startFresh();
  }

  function onGraphReady(): void {
    // First-ready paint: render the current frame so the user sees the
    // initial highlight (or final frame under reduced motion) instead of
    // a blank graph.
    if (graphReady) return;
    graphReady = true;
    applyGraph();
  }

  // Landing's IntersectionObserver drives `active`; this $effect is the
  // "Playback orchestration" dispatcher of the 4-state playback machine. Body
  // wrapped in `untrack` so $state reads inside the dispatch helpers
  // (`machineGraphRef`, `tapesStackRef`, `graphReady`) don't become effect
  // deps and trip an infinite update loop. Reduced motion short-circuits
  // entirely — the panel pins to the final frame on mount and ignores
  // active changes.
  $effect(() => {
    const isActive = active;
    const isReduced = reducedMotion;
    untrack(() => {
      if (isReduced) return;
      if (isActive) {
        if (playbackState === 'idle') startFresh();
        else if (playbackState === 'paused') resumeTimer();
        // 'playing' and 'done' → no-op (already playing, or finished and
        // awaiting an explicit Replay click).
      } else {
        if (playbackState === 'playing') pauseTimer();
        // 'idle' / 'paused' / 'done' → no-op.
      }
    });
  });

  onMount(() => {
    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reducedMotion) {
      player.goTo(finalFrameIndex);
      cleared = false;
      applyFrame();
      return () => clearReplayTimer();
    }

    // Initial paint at frame 0; the $effect above will pick up `active` and
    // either keep us at frame 0 (inactive) or kick off playback.
    applyFrame();
    return () => clearReplayTimer();
  });
</script>

<div class="snippet-panel" data-testid="snippet-panel">
  <!-- a11y: page heading hierarchy is <h1> (Landing) → <h2> (per snippet panel). -->
  <h2 class="caption">{caption}</h2>
  <div class="body">
    <div class="player">
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
      <ExecutionTraceTable
        frames={snippet.frames}
        frameIndex={cleared ? null : frameIndex}
        graph={initialGraph}
        {blanks}
      />
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
    <aside class="lesson" aria-label="Lesson notes">
      <!-- Content is build-time author input from `defaultCode.ts` (per the
           demo's existing {@html}-for-build-time-content policy used for SVG
           icons). Renderer in `lib/lessonMarkdown.ts` escapes the source
           first; only paragraphs, bullet lists, and inline code are emitted. -->
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      {@html lessonHtml}
    </aside>
  </div>
</div>

<style>
  .snippet-panel {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 20px;
    background: var(--editor-bg);
    border: 1px solid var(--cell-border);
    border-radius: var(--surface-radius);
    /* Tape's intrinsic width (--visible-cells * cell-width) can exceed the
       column-track width on narrow layouts; clip rather than letting cells
       escape past the panel's border. */
    overflow: hidden;

    /* Showcase context. With the panel now full-width and split into player
       + lesson columns, the player track is wide enough to show more cells
       than the previous narrow grid allowed. 17 desktop / 13 tablet / 9 phone
       lines up with the engine-page Tape defaults at each breakpoint. The
       mask in Tape.svelte fades edge cells, so partial symbols don't pop. */
    :global(.ui-belt) {
      --visible-cells: 17;

      @media (max-width: 768px) {
        --visible-cells: 13;
      }

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

  .body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 24px;
    align-items: start;

    /* Stack on narrow viewports — player on top, lesson notes below. */
    @media (max-width: 768px) {
      grid-template-columns: 1fr;
      gap: 16px;
    }
  }

  .player {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
    /* Base background frames the player as a distinct surface within the
       outer panel — visually separates "the thing running" from the lesson
       prose next to it. `--bg` is the page surface (lighter than the
       panel's `--editor-bg`), which reads as an embedded screen rather
       than a continuation of the card. */
    background: var(--bg);
    border: 1px solid var(--cell-border);
    border-radius: var(--surface-radius);
    padding: 14px;
  }

  .graph {
    /* MachineGraph manages its own height (fixed 360px by default); this
       wrapper lets snippet-panel control the slot without re-styling the
       graph card. */
    min-width: 0;
  }

  .tapes {
    /* Player fills the column at 100% width — let the
       tape stretch the full track rather than centering with slack. */
    min-width: 0;
  }

  .lesson {
    min-width: 0;
    font-size: 0.9375rem;
    line-height: 1.55;
    color: var(--fg);

    :global(p) {
      margin: 0 0 0.85em;
    }

    :global(p:last-child),
    :global(ul:last-child) {
      margin-bottom: 0;
    }

    :global(ul) {
      margin: 0 0 0.85em;
      padding-left: 1.4em;
    }

    :global(ul li) {
      margin: 0.25em 0;
    }

    :global(code) {
      font-family: ui-monospace, 'SF Mono', Consolas, monospace;
      font-size: 0.88em;
      padding: 1px 5px;
      border-radius: 4px;
      background: var(--cell-bg);
      color: color-mix(in srgb, var(--fg) 92%, transparent);
      border: 1px solid color-mix(in srgb, var(--cell-border) 70%, transparent);
    }
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

  /* Sibling-to-Replay button styling: the link sits
     next to the .replay <button> when playback is done, so the underline-
     link look read as mismatched. Keep it an <a> for keyboard / right-click
     / open-in-new-tab semantics — just match the button's surface. */
  .open-in-editor {
    padding: 6px 14px;
    background: var(--cell-bg);
    color: var(--fg);
    border: 1px solid var(--cell-border);
    border-radius: 6px;
    font: inherit;
    text-decoration: none;
  }

  .open-in-editor:hover {
    background: color-mix(in srgb, var(--cell-bg) 80%, var(--fg));
  }
</style>
