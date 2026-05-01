<script lang="ts">
  import { icons } from '../lib/icons.ts';
  import type { Command, Movement } from '../lib/types.ts';

  type Props = {
    alphabet: readonly string[];
    enabled: boolean;
    visible: boolean;
    applyVisible: boolean;
    onApply: (cmd: Command) => void;
  };

  let { alphabet, enabled, visible, applyVisible, onApply }: Props = $props();

  // Internal selection. `symbol === null` represents the "keep" choice.
  // No more KEEP Symbol indirection — one canonical Command shape (D8).
  let movement = $state<Movement>('S');
  let symbol = $state<string | null>(null);

  // flashApply() is imperative — exported for parent (e.g. demo loop) to call.
  let flashTimer: ReturnType<typeof setTimeout> | null = null;
  let flashing = $state(false);

  export function flashApply(): void {
    flashing = true;
    if (flashTimer !== null) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      flashing = false;
      flashTimer = null;
    }, 240);
  }

  export function reflect(cmd: Command): void {
    movement = cmd.movement;
    symbol = cmd.symbol;
  }

  function selectMovement(m: Movement): void {
    if (!enabled) return;
    movement = m;
  }

  function selectSymbol(s: string | null): void {
    if (!enabled) return;
    symbol = s;
  }

  function fireApply(): void {
    if (!enabled) return;
    onApply({ movement, symbol });
  }

  const MOVEMENT_BUTTONS: Array<{ code: Movement; svg: string; label: string }> = [
    { code: 'L', svg: icons.left, label: 'Move head left' },
    { code: 'S', svg: icons.stay, label: 'Stay (no head movement)' },
    { code: 'R', svg: icons.right, label: 'Move head right' },
  ];
</script>

<div class="control-panel" class:hidden={!visible} class:disabled={!enabled} class:no-apply={!applyVisible}>
  <div class="interactive">
    <div class="row symbols">
      <button
        type="button"
        class="cp-btn keep"
        class:selected={symbol === null}
        title="Keep current symbol"
        aria-label="Keep current symbol"
        onclick={() => selectSymbol(null)}
      >
        {@html icons.keep}
      </button>
      {#each alphabet as sym, i}
        <button
          type="button"
          class="cp-btn"
          class:selected={symbol === sym}
          title={i === 0 ? 'Write blank' : `Write ${sym}`}
          aria-label={i === 0 ? 'Write blank' : `Write ${sym}`}
          onclick={() => selectSymbol(sym)}
        >
          {i === 0 ? '␣' : sym}
        </button>
      {/each}
    </div>

    <div class="row movement-apply">
      {#each MOVEMENT_BUTTONS as b}
        <button
          type="button"
          class="cp-btn"
          class:selected={movement === b.code}
          title={b.label}
          aria-label={b.label}
          onclick={() => selectMovement(b.code)}
        >
          {@html b.svg}
        </button>
      {/each}
      <button
        type="button"
        class="cp-btn apply"
        class:pressed={flashing}
        title="Apply"
        aria-label="Apply"
        onclick={fireApply}
      >
        {@html icons.apply}
      </button>
    </div>
  </div>
</div>

<style>
  .control-panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px;
    border: 1px solid var(--surface-border);
    border-radius: var(--surface-radius);
    background: var(--surface-bg);
    animation: enter var(--anim-belt-enter-ms) ease-out var(--anim-belt-enter-delay-panel-ms) backwards;
  }

  .control-panel.hidden {
    display: none;
  }

  .interactive {
    display: flex;
    flex-direction: column;
    gap: 8px;
    transition: opacity 150ms ease;
  }

  .interactive .row + .row {
    padding-top: 8px;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
  }

  .control-panel.disabled .interactive {
    opacity: 0.5;
    pointer-events: none;
  }

  .control-panel.no-apply .apply {
    display: none;
  }

  /* Visual breather between movement triplet and apply button. */
  .row.movement-apply .apply {
    margin-left: 12px;
  }

  .row {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: center;
  }

  .cp-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 36px;
    height: 32px;
    padding: 4px 10px;
    background: var(--cell-bg);
    border: 1px solid rgba(255, 255, 255, 0.06);
    color: var(--fg);
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
    font-family: ui-monospace, 'SF Mono', Consolas, monospace;
    font-size: 14px;
    transition:
      background-color var(--anim-button-hover-ms) ease,
      border-color var(--anim-button-hover-ms) ease,
      color var(--anim-button-hover-ms) ease;
  }

  .cp-btn:hover {
    border-color: rgba(110, 168, 254, 0.5);
    color: var(--accent);
  }

  .cp-btn.selected {
    background: rgba(110, 168, 254, 0.2);
    border-color: var(--accent);
    color: var(--accent);
  }

  .cp-btn.pressed {
    background: rgba(110, 168, 254, 0.4);
    border-color: var(--accent);
    color: var(--accent);
    transform: scale(0.96);
    transition: background-color 80ms ease, transform 80ms ease;
  }

  .cp-btn :global(svg) {
    width: 18px;
    height: 18px;
    display: block;
  }

  .apply {
    min-width: 64px;
  }

  @keyframes enter {
    from { opacity: 0; transform: translateY(20px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  @media (max-width: 768px) {
    .cp-btn {
      min-width: 32px;
      height: 28px;
      padding: 2px 8px;
      font-size: 13px;
    }

    .cp-btn :global(svg) {
      width: 16px;
      height: 16px;
    }

    .apply {
      min-width: 56px;
    }

    /* Long alphabets shouldn't wrap to a second row on a narrow screen — let
       the user swipe horizontally. `safe center` centers when content fits,
       falls back to flex-start when it overflows so the leftmost chip stays
       reachable via scroll. Scrollbar is hidden visually (touch-friendly). */
    .row.symbols {
      flex-wrap: nowrap;
      overflow-x: auto;
      justify-content: safe center;
      scrollbar-width: none;
      -webkit-overflow-scrolling: touch;
    }

    .row.symbols::-webkit-scrollbar {
      display: none;
    }

    .row.symbols .cp-btn {
      flex-shrink: 0;
    }
  }
</style>
