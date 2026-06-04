<script lang="ts">
  import { onMount } from 'svelte';
  import SnippetPanel from './SnippetPanel.svelte';
  import snippets from 'virtual:snippets';
  import { readEngineFromLandingQuery } from '../lib/routing';
  import type { Engine } from '../lib/types';

  let engine = $state<Engine>('turing');

  onMount(() => {
    engine = readEngineFromLandingQuery(window.location.search);
    const onPopState = () => { engine = readEngineFromLandingQuery(window.location.search); };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  });

  function setEngine(next: Engine) {
    if (next === engine) return;
    engine = next;
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
      <SnippetPanel {snippet} />
    {/each}
  </div>
</section>

<style>
  .landing {
    flex: 1;
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
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 400px), 1fr));
    gap: 20px;
    align-items: start;

    @media (max-width: 480px) {
      grid-template-columns: 1fr;
    }
  }
</style>
