<script lang="ts">
  import type { DiagnosticsCounter } from '../lib/diagnosticsCounter.svelte.ts';

  type Props = { counter: DiagnosticsCounter };
  const { counter }: Props = $props();
</script>

<div class="diag-counter" aria-live="polite" aria-label="Diagnostic counts">
  {#if counter.errors > 0}
    <span class="pill pill-error" title="{counter.errors} error{counter.errors === 1 ? '' : 's'}">
      <span class="pill-label">E</span>
      <span class="pill-count">{counter.errors}</span>
    </span>
  {/if}
  {#if counter.warnings > 0}
    <span class="pill pill-warning" title="{counter.warnings} warning{counter.warnings === 1 ? '' : 's'}">
      <span class="pill-label">W</span>
      <span class="pill-count">{counter.warnings}</span>
    </span>
  {/if}
  {#if counter.info > 0}
    <span class="pill pill-info" title="{counter.info} info">
      <span class="pill-label">I</span>
      <span class="pill-count">{counter.info}</span>
    </span>
  {/if}
</div>

<style>
  .diag-counter {
    position: absolute;
    bottom: 6px;
    right: 6px;
    display: flex;
    gap: 4px;
    z-index: 5;
    pointer-events: none; /* read-only in Phase 1 — don't intercept editor clicks */
  }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 1px 6px;
    font-family: var(--mono, ui-monospace, 'SF Mono', Consolas, monospace);
    font-size: 11px;
    line-height: 1.4;
    color: var(--bg);
    background: var(--fg);
    border-radius: 10px;
  }

  .pill-error { background: var(--diag-error); }
  .pill-warning { background: var(--diag-warning); }
  .pill-info { background: var(--diag-info); }

  .pill-label {
    font-weight: 700;
  }

  .pill-count {
    font-variant-numeric: tabular-nums;
  }
</style>
