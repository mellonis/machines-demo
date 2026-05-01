<script lang="ts">
  import { icons } from '../lib/icons.ts';

  export type LogKind = 'error' | 'warn' | 'ok';
  export type LogEntry = { text: string; kind?: LogKind };

  type Props = {
    entries: LogEntry[];
    onclear: () => void;
  };

  let { entries, onclear }: Props = $props();

  let scrollEl: HTMLDivElement | undefined;

  // Auto-scroll on append.
  $effect(() => {
    void entries.length;
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  });
</script>

<div class="log-panel">
  <button
    type="button"
    class="clear"
    onclick={onclear}
    title="Clear log"
    aria-label="Clear log"
  >
    {@html icons.eraser}
  </button>
  <div class="content" bind:this={scrollEl}>
    {#each entries as entry, i (i)}
      <div class="line" class:error={entry.kind === 'error'} class:warn={entry.kind === 'warn'} class:ok={entry.kind === 'ok'}>
        {entry.text}
      </div>
    {/each}
  </div>
</div>

<style>
  /* Desktop only — on mobile the panel is hidden and the latest entry is
     mirrored as a single-line status in MachineTab.svelte. */

  .log-panel {
    position: relative;
    flex: 1;
    min-height: 80px;
    background: var(--editor-bg);
    border: 1px solid var(--cell-border);
    border-radius: var(--surface-radius);
  }

  .content {
    position: absolute;
    inset: 0;
    overflow-y: auto;
    padding: 8px 10px;
    font-family: ui-monospace, 'SF Mono', Consolas, monospace;
    font-size: 12px;
    color: var(--muted);
  }

  .clear {
    position: absolute;
    top: 6px;
    right: 6px;
    z-index: 1;
    width: 22px;
    height: 22px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--muted);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .clear:hover {
    background: rgba(255, 255, 255, 0.06);
    color: var(--fg);
  }

  .clear :global(svg) {
    width: 14px;
    height: 14px;
    display: block;
  }

  .line {
    white-space: pre-wrap;
    word-break: break-word;
    padding: 1px 0;
  }

  .line.error { color: var(--error); }
  .line.warn  { color: var(--warn); }
  .line.ok    { color: var(--ok); }

  @media (max-width: 768px) {
    .log-panel {
      display: none;
    }
  }
</style>
