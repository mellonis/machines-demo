<script lang="ts">
  import { icons } from '../lib/icons.ts';
  import type { LogEntry } from '../lib/log.ts';

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
        <div
          class="head"
          style={entry.color && !entry.kind ? `color: ${entry.color};` : undefined}
        >{entry.text}</div>
        {#if entry.rows && entry.rows.length > 0}
          {#each entry.rows as row, j (j)}
            <div class="row" style={row.color ? `color: ${row.color};` : undefined}>
              {row.text}
            </div>
          {/each}
        {/if}
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
    padding: 1px 0;
  }

  .head {
    white-space: pre-wrap;
    word-break: break-word;
  }

  .row {
    white-space: pre-wrap;
    word-break: break-word;
    padding-left: 2px;
  }

  /* Kind-marked entries get a left stripe in addition to header tinting so
     they remain distinguishable even when the tape palette (red/green/…)
     overlaps the kind colors (error/ok/…). The stripe is a structural cue
     that doesn't rely on color uniqueness. */
  .line.error,
  .line.warn,
  .line.ok {
    padding-left: 8px;
    border-left: 3px solid transparent;
  }

  .line.error { border-left-color: var(--error); }
  .line.warn  { border-left-color: var(--warn); }
  .line.ok    { border-left-color: var(--ok); }

  .line.error .head { color: var(--error); }
  .line.warn  .head { color: var(--warn); }
  .line.ok    .head { color: var(--ok); }

  @media (max-width: 768px) {
    .log-panel {
      display: none;
    }
  }
</style>
