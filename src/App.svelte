<script lang="ts">
  import { onMount } from 'svelte';
  import { turingVersion, postVersion, visualsVersion, appVersion, toolchainsVersion } from 'virtual:lib-versions';
  import Landing from './components/Landing.svelte';
  import MachineView from './components/MachineView.svelte';
  import ToolchainView from './components/ToolchainView.svelte';
  import SettingsPanel from './components/SettingsPanel.svelte';
  import { icons } from './lib/icons.ts';
  import { legacyMachineRewrite, readRouteFromUrl } from './lib/routing.ts';
  import { theme } from './lib/theme.svelte.ts';
  import { ENGINES, isToolchainEngine, type Engine, type Route } from './lib/types.ts';

  const TAB_LABELS: Record<Engine, string> = { turing: 'Turing', post: 'Post', pm1: 'PM-1', tm1: 'TM-1' };

  // Route lives in the URL path: `/` is the Landing page, `/turing` and
  // `/post` mount the engine-specific MachineView. Anything else falls back
  // to Landing. Requires SPA-fallback routing on the server (nginx
  // `try_files $uri $uri/ /index.html;` for prod; Vite's default in dev).
  let route = $state<Route>({ kind: 'landing' });

  onMount(() => {
    // Backwards-compat: legacy `?machine=<engine>` → `/<engine>`. Rewrite the
    // URL once on mount so old bookmarks/links don't silently lose context.
    const url = legacyMachineRewrite(new URL(window.location.href));
    if (url.href !== window.location.href) {
      history.replaceState(null, '', url);
    }

    route = readRouteFromUrl(window.location.pathname);
    const onPopState = () => {
      route = readRouteFromUrl(window.location.pathname);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  });

  function selectRoute(next: Route): void {
    // Noop on same-route navigation — don't push history entries that don't
    // change anything.
    if (route.kind === next.kind) {
      if (next.kind === 'landing') return;
      if (route.kind === 'engine' && route.engine === next.engine) return;
    }
    route = next;
    // Engine paths drop existing query params: they are engine-scoped (e.g.
    // `?snippet=`) and don't carry over to the other engine's namespace or
    // to the landing page.
    history.pushState(null, '', next.kind === 'landing' ? '/' : '/' + next.engine);
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
  <!-- a11y: the brand title is a persistent navigation control (returns to /),
       not a page heading. The per-page <h1> lives in Landing or MachineView. -->
  <div class="brand">
    <button
      type="button"
      class="home-link"
      onclick={() => selectRoute({ kind: 'landing' })}
      title="Back to landing"
      aria-label="Back to landing"
    ><span class="title-prefix">machines&nbsp;</span>demo</button>
  </div>
  <nav class="tabs">
    {#each ENGINES as engine (engine)}
      <button
        type="button"
        class:active={route.kind === 'engine' && route.engine === engine}
        aria-current={route.kind === 'engine' && route.engine === engine ? 'page' : undefined}
        onclick={() => selectRoute({ kind: 'engine', engine })}
      >{TAB_LABELS[engine]}</button>
    {/each}
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
  <SettingsPanel />
</header>

<main>
  {#if route.kind === 'landing'}
    <Landing />
  {:else}
    {#key route.engine}
      {#if isToolchainEngine(route.engine)}
        <ToolchainView engine={route.engine} />
      {:else}
        <MachineView engine={route.engine} />
      {/if}
    {/key}
  {/if}
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
    <span class="sep" aria-hidden="true">·</span>
    <a
      href="https://github.com/mellonis/machine-toolchains"
      target="_blank"
      rel="noopener"
      title="machine-toolchains on GitHub"
    >toolchains v{toolchainsVersion}</a>
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

    .brand {
      font-size: 16px;
      margin: 0;
      font-weight: 500;
      letter-spacing: 0.04em;
      color: var(--accent);

      .home-link {
        background: transparent;
        border: none;
        padding: 0;
        margin: 0;
        font: inherit;
        letter-spacing: inherit;
        color: inherit;
        cursor: pointer;
        transition: opacity var(--anim-button-hover-ms) ease;

        &:hover {
          opacity: 0.8;
        }
      }

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
    /* min-height:0 lets Landing's internal overflow-y:auto actually scroll
       its content instead of pushing main beyond its flex allotment — the
       flex-item min-height:auto default would otherwise let tall snippet
       grids spill into the body's scroll. */
    min-height: 0;
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
