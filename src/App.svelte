<script lang="ts">
  import { onMount } from 'svelte';
  import { turingVersion, postVersion, visualsVersion, appVersion } from 'virtual:lib-versions';
  import MachineView from './components/MachineView.svelte';
  import { icons } from './lib/icons.ts';
  import { theme } from './lib/theme.svelte.ts';
  import { ENGINES, type Engine } from './lib/types.ts';

  // Engine lives in the URL path (`/turing`, `/post`). The first path segment
  // is the engine; anything else (`/`, `/foo`) normalises to the default
  // engine. Requires SPA-fallback routing on the server (nginx
  // `try_files $uri $uri/ /index.html;` for prod; Vite's default in dev).
  function readEngineFromUrl(): Engine {
    try {
      const seg = window.location.pathname.replace(/^\/+/, '').split('/')[0];
      return (ENGINES as readonly string[]).includes(seg) ? (seg as Engine) : 'turing';
    } catch {
      return 'turing';
    }
  }

  let activeEngine = $state<Engine>('turing');

  onMount(() => {
    // Backwards-compat: legacy `?machine=<engine>` → `/<engine>`. Rewrite the
    // URL once on mount so old bookmarks/links don't silently lose context.
    const url = new URL(window.location.href);
    const legacy = url.searchParams.get('machine');
    if (legacy !== null) {
      url.searchParams.delete('machine');
      if ((ENGINES as readonly string[]).includes(legacy)) {
        url.pathname = '/' + legacy;
      }
      history.replaceState(null, '', url);
    }

    // Normalise unknown/root paths to `/<default-engine>` so the URL always
    // reflects the active engine (no silent fallback discrepancy).
    const seg = window.location.pathname.replace(/^\/+/, '').split('/')[0];
    if (!(ENGINES as readonly string[]).includes(seg)) {
      const normalised = new URL(window.location.href);
      normalised.pathname = '/turing';
      history.replaceState(null, '', normalised);
    }

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
    // Drop existing query params: they are engine-scoped (e.g. `?snippet=`)
    // and don't carry over to the other engine's namespace.
    history.pushState(null, '', '/' + engine);
  }

  const themeIcon = $derived(
    theme.current === 'system'
      ? icons.deviceDesktop
      : theme.current === 'light' ? icons.sun : icons.moon,
  );
  const themeNext = $derived(
    theme.current === 'system' ? 'light' : theme.current === 'light' ? 'dark' : 'system',
  );
  const themeLabel = $derived(`Theme: ${theme.current} — click to switch to ${themeNext}`);
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
  <button
    type="button"
    class="theme-toggle"
    onclick={() => theme.cycle()}
    title={themeLabel}
    aria-label={themeLabel}
  >
    {@html themeIcon}
  </button>
</header>

<main>
  {#key activeEngine}
    <MachineView engine={activeEngine} />
  {/key}
</main>

<footer>
  <span class="app-version" title="machines-demo version">v{appVersion}</span>
  <span class="sep" aria-hidden="true">·</span>
  <span class="lib-versions">
    <a
      href="https://www.npmjs.com/package/@turing-machine-js/machine"
      target="_blank"
      rel="noopener"
      title="@turing-machine-js/machine on npm"
    >turing v{turingVersion}</a>
    <span class="sep" aria-hidden="true">·</span>
    <a
      href="https://www.npmjs.com/package/@post-machine-js/machine"
      target="_blank"
      rel="noopener"
      title="@post-machine-js/machine on npm"
    >post v{postVersion}</a>
    <span class="sep" aria-hidden="true">·</span>
    <a
      href="https://www.npmjs.com/package/@turing-machine-js/visuals"
      target="_blank"
      rel="noopener"
      title="@turing-machine-js/visuals on npm"
    >visuals v{visualsVersion}</a>
  </span>
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
</footer>

<style>
  header {
    display: flex;
    align-items: center;
    gap: 24px;
    padding: 12px 24px;
    border-bottom: 1px solid var(--cell-border);

    h1 {
      font-size: 16px;
      margin: 0;
      font-weight: 500;
      letter-spacing: 0.04em;
      color: var(--accent);

      .title-prefix {
        @media (max-width: 768px) {
          display: none;
        }
      }
    }

    @media (max-width: 768px) {
      flex-wrap: wrap;
      gap: 12px;
      padding: 10px 14px;
    }
  }

  .tabs {
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

      &.active {
        color: var(--fg);
        background: var(--cell-bg);
        border-color: var(--cell-border);
      }
    }
  }

  /* Theme toggle sits at the right end of the header — pushed there by
     `margin-left: auto` since the lib-versions chunk that previously held
     that role moved to the footer. */
  .theme-toggle {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    color: var(--muted);
    background: transparent;
    border: none;
    padding: 0;
    cursor: pointer;
    font: inherit;
    transition: background-color var(--anim-button-hover-ms) ease, color var(--anim-button-hover-ms) ease;

    &:hover {
      background: var(--hover-bg);
      color: var(--fg);
    }

    :global(svg) {
      width: 18px;
      height: 18px;
      display: block;
    }
  }

  main {
    flex: 1;
    overflow: hidden;
    display: flex;

    @media (max-width: 768px) {
      overflow: auto;
    }
  }

  /* Bottom-right meta strip: app + lib versions + GitHub link. Compact and
     low-emphasis; mirrors the header's muted treatment. */
  footer {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    font-size: 11px;
    color: var(--muted);
    border-top: 1px solid var(--cell-border);

    a {
      color: inherit;
      text-decoration: none;
      transition: color var(--anim-button-hover-ms) ease;

      &:hover {
        color: var(--fg);
      }
    }

    .sep {
      opacity: 0.6;
    }
  }

  .lib-versions {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .repo-link {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    margin-left: 4px;
    border-radius: 4px;
    color: var(--muted);
    transition: background-color var(--anim-button-hover-ms) ease, color var(--anim-button-hover-ms) ease;

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
</style>
