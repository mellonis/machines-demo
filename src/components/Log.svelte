<script lang="ts">
  import IconButton from './IconButton.svelte';
  import type { LogEntry } from '../lib/log.ts';

  type Props = {
    entries: LogEntry[];
    onClear: () => void;
  };

  let { entries, onClear }: Props = $props();

  let scrollEl: HTMLDivElement | undefined;

  // Auto-scroll on append.
  $effect(() => {
    void entries.length;
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
  });
</script>

<div class="log-panel">
  {#if entries.length > 0}
    <IconButton icon="eraser" title="Clear log" onClick={onClear} />
  {/if}
  <div class="content" bind:this={scrollEl}>
    {#each entries as entry, i (i)}
      {#if entry.separator}
        <hr class="sep" />
      {:else}
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
      {/if}
    {/each}
  </div>
</div>

<style>
  /* Desktop only — on mobile the panel is hidden and the latest entry is
     mirrored as a single-line status in MachineView.svelte. */

  .log-panel {
    position: relative;
    flex: 1;
    min-height: 80px;
    display: flex;
    flex-direction: column;
    background: var(--editor-bg);
    border: 1px solid var(--cell-border);
    border-radius: var(--surface-radius);

    @media (max-width: 768px) {
      display: none;
    }
  }

  .content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 8px 10px;
    font-family: ui-monospace, 'SF Mono', Consolas, monospace;
    font-size: 12px;
    color: var(--muted);
  }

  /* Kind-marked entries get a left stripe in addition to header tinting so
     they remain distinguishable even when the tape palette (red/green/…)
     overlaps the kind colors (error/ok/…). The stripe is a structural cue
     that doesn't rely on color uniqueness. */
  .line {
    padding: 1px 0;

    &.error,
    &.warn,
    &.ok {
      padding-left: 8px;
      border-left: 3px solid transparent;
    }

    &.error { border-left-color: var(--error); }
    &.warn  { border-left-color: var(--warn); }
    &.ok    { border-left-color: var(--ok); }

    &.error .head { color: var(--error); }
    &.warn  .head { color: var(--warn); }
    &.ok    .head { color: var(--ok); }
  }

  .sep {
    border: none;
    border-top: 1px solid var(--cell-border);
    margin: 6px 0;
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
</style>
