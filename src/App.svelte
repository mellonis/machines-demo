<script lang="ts">
  import { onMount } from 'svelte';
  import MachineTab from './components/MachineTab.svelte';
  import { icons } from './lib/icons.ts';
  import { ENGINES, type Engine } from './lib/types.ts';

  function readEngineFromUrl(): Engine {
    try {
      const v = new URL(window.location.href).searchParams.get('machine');
      return (ENGINES as readonly string[]).includes(v ?? '') ? (v as Engine) : 'turing';
    } catch {
      return 'turing';
    }
  }

  let activeEngine = $state<Engine>('turing');

  onMount(() => {
    activeEngine = readEngineFromUrl();
    const onPopState = () => {
      activeEngine = readEngineFromUrl();
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  });

  function selectEngine(engine: Engine): void {
    if (engine === activeEngine) return;
    activeEngine = engine;
    const url = new URL(window.location.href);
    if (engine === 'turing') {
      url.searchParams.delete('machine');
    } else {
      url.searchParams.set('machine', engine);
    }
    history.pushState(null, '', url);
  }
</script>

<header>
  <h1><span class="title-prefix">machines&nbsp;</span>demo</h1>
  <nav class="tabs">
    <button
      type="button"
      class:active={activeEngine === 'turing'}
      onclick={() => selectEngine('turing')}
    >
      Turing
    </button>
    <button
      type="button"
      class:active={activeEngine === 'post'}
      onclick={() => selectEngine('post')}
    >
      Post
    </button>
  </nav>
  <a
    class="repo-link"
    href="https://github.com/mellonis/machines-demo"
    target="_blank"
    rel="noopener"
    title="View source on GitHub"
    aria-label="View source on GitHub"
  >
    {@html icons.github}
  </a>
</header>

<main>
  {#key activeEngine}
    <MachineTab engine={activeEngine} />
  {/key}
</main>

<style>
  header {
    display: flex;
    align-items: center;
    gap: 24px;
    padding: 12px 24px;
    border-bottom: 1px solid var(--cell-border);
  }

  header h1 {
    font-size: 16px;
    margin: 0;
    font-weight: 500;
    letter-spacing: 0.04em;
    color: var(--head-dim);
  }

  .tabs {
    display: flex;
    gap: 4px;
  }

  .tabs button {
    background: transparent;
    border: 1px solid transparent;
    color: var(--muted);
    padding: 4px 14px;
    font: inherit;
    cursor: pointer;
    border-radius: 6px;
  }

  .tabs button.active {
    color: var(--fg);
    background: var(--cell-bg);
    border-color: var(--cell-border);
  }

  .repo-link {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    color: var(--muted);
    text-decoration: none;
    transition: background-color var(--anim-button-hover-ms) ease, color var(--anim-button-hover-ms) ease;
  }

  .repo-link:hover {
    background: rgba(255, 255, 255, 0.06);
    color: var(--fg);
  }

  .repo-link :global(svg) {
    width: 18px;
    height: 18px;
    display: block;
  }

  main {
    flex: 1;
    overflow: hidden;
    display: flex;
  }

  @media (max-width: 768px) {
    header {
      flex-wrap: wrap;
      gap: 12px;
      padding: 10px 14px;
    }

    header h1 .title-prefix {
      display: none;
    }

    main {
      overflow: auto;
    }
  }
</style>
