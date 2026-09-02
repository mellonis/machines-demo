<script lang="ts">
  import { onMount } from 'svelte';
  import SnippetPanel from './SnippetPanel.svelte';
  import snippets from 'virtual:snippets';
  import { readEngineFromLandingQuery } from '../lib/routing';
  import type { JsEngine } from '../lib/types';

  let engine = $state<JsEngine>('turing');

  // Playback orchestration. One IntersectionObserver
  // over all panel slots — the panel with the highest visible ratio becomes
  // `active`; everyone else freezes at frame 0. Reduced motion is checked
  // here too: under prefers-reduced-motion the IO is never created — every
  // panel pins to its final frame on mount and there's nothing to orchestrate.
  let activeSnippetId = $state<string | null>(null);
  // Plain Maps — these are touched only inside imperative callbacks (the
  // panelSlot action and IO entry handler), never read during render, so
  // SvelteMap's reactivity overhead would be wasted. eslint's
  // svelte/prefer-svelte-reactivity is over-eager here.
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const slotEls = new Map<string, HTMLElement>();
  let io: IntersectionObserver | null = null;
  // Tracks the last reported ratio per snippet across IO callbacks (which
  // report only entries that changed, not the global state).
  // eslint-disable-next-line svelte/prefer-svelte-reactivity
  const ratios = new Map<string, number>();

  function recomputeActive() {
    let bestId: string | null = null;
    let bestRatio = 0;
    for (const [id, ratio] of ratios) {
      if (ratio > bestRatio) {
        bestRatio = ratio;
        bestId = id;
      }
    }
    // Leave the current activeSnippetId in place if nothing is intersecting —
    // a panel mid-playback shouldn't be yanked off when its top edge briefly
    // leaves the viewport.
    if (bestId) activeSnippetId = bestId;
  }

  function handleEntries(entries: IntersectionObserverEntry[]) {
    for (const entry of entries) {
      const id = (entry.target as HTMLElement).dataset.snippetId;
      if (id) ratios.set(id, entry.isIntersecting ? entry.intersectionRatio : 0);
    }
    recomputeActive();
  }

  // Svelte action: registers a snippet-slot's DOM element with the parent
  // map AND observes it via the shared IO. Tears down both on destroy.
  function panelSlot(node: HTMLElement, id: string) {
    slotEls.set(id, node);
    io?.observe(node);
    return {
      destroy() {
        io?.unobserve(node);
        ratios.delete(id);
        slotEls.delete(id);
      },
    };
  }

  onMount(() => {
    engine = readEngineFromLandingQuery(window.location.search);
    const onPopState = () => { engine = readEngineFromLandingQuery(window.location.search); };
    window.addEventListener('popstate', onPopState);

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reducedMotion) {
      io = new IntersectionObserver(handleEntries, {
        threshold: [0.25, 0.5, 0.75, 1.0],
      });
      // Observe panels that registered before IO was created (children mount
      // before the parent's onMount).
      for (const el of slotEls.values()) io.observe(el);
    }

    return () => {
      window.removeEventListener('popstate', onPopState);
      io?.disconnect();
      io = null;
    };
  });

  function setEngine(next: JsEngine) {
    if (next === engine) return;
    engine = next;
    // Engine switch remounts the panel slots; the action's destroy clears
    // each slot's entry. Reset activeSnippetId so the new engine's snippets
    // get a fresh IO claim.
    activeSnippetId = null;
    ratios.clear();
    const url = new URL(window.location.href);
    if (next === 'turing') url.searchParams.delete('engine');
    else url.searchParams.set('engine', next);
    history.pushState(null, '', url);
  }

  const currentSnippets = $derived(snippets[engine] ?? []);
</script>

<section class="landing">
  <header>
    <h1>Turing &amp; Post machines, visualised</h1>
    <p>Each panel is a small program that runs to halt. Click <em>Open in editor</em> to step through it yourself.</p>
  </header>

  <nav class="engine-switcher">
    <button
      type="button"
      class:active={engine === 'turing'}
      aria-current={engine === 'turing' ? 'page' : undefined}
      onclick={() => setEngine('turing')}
    >Turing snippets</button>
    <button
      type="button"
      class:active={engine === 'post'}
      aria-current={engine === 'post' ? 'page' : undefined}
      onclick={() => setEngine('post')}
    >Post snippets</button>
  </nav>

  <div class="snippet-grid">
    {#each currentSnippets as snippet (snippet.id)}
      <div
        class="snippet-slot"
        data-snippet-id={snippet.id}
        use:panelSlot={snippet.id}
      >
        <SnippetPanel {snippet} active={activeSnippetId === snippet.id} />
      </div>
    {/each}
  </div>
</section>

<style>
  .landing {
    flex: 1;
    /* Same min-height:0 rationale as App.svelte's main — bounds .landing
       inside main's flex allotment so overflow-y:auto scrolls inside
       .landing rather than the body. */
    min-height: 0;
    overflow-y: auto;
    padding: 32px 24px;
    display: flex;
    flex-direction: column;
    gap: 32px;
    max-width: 1200px;
    margin: 0 auto;
    width: 100%;
    box-sizing: border-box;

    @media (max-width: 768px) {
      padding: 20px 14px;
      gap: 24px;
    }
  }

  header {
    display: flex;
    flex-direction: column;
    gap: 8px;

    h1 {
      margin: 0;
      font-size: 1.5rem;
      font-weight: 600;
      color: var(--fg);

      @media (max-width: 768px) {
        font-size: 1.25rem;
      }
    }

    p {
      margin: 0;
      color: var(--muted);
      font-size: 0.9375rem;
      line-height: 1.5;
    }
  }

  .engine-switcher {
    display: flex;
    gap: 4px;

    button {
      background: transparent;
      border: 1px solid transparent;
      color: var(--muted);
      padding: 4px 14px;
      font: inherit;
      cursor: pointer;
      border-radius: 6px;
      transition: background-color var(--anim-button-hover-ms) ease,
                  color var(--anim-button-hover-ms) ease,
                  border-color var(--anim-button-hover-ms) ease;

      &.active {
        color: var(--fg);
        background: var(--cell-bg);
        border-color: var(--cell-border);
      }

      &:hover:not(.active) {
        color: var(--fg);
        background: var(--hover-bg);
      }
    }
  }

  .snippet-grid {
    /* One panel per row. Each SnippetPanel hosts an internal two-column
       layout (player + lesson notes) that needs the full content width. */
    display: flex;
    flex-direction: column;
    gap: 24px;
  }
</style>
