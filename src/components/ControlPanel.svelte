<script lang="ts">
  import { icons } from '../lib/icons.ts';
  import type { Command, Movement } from '../lib/types.ts';

  type Props = {
    alphabets: readonly (readonly string[])[];
    enabled: boolean;
    visible: boolean;
    applyVisible: boolean;
    /** Show colored dot + "Tape N" label per row. Hidden for inherently
     * single-tape engines (Post) where the label is redundant. */
    showTapeLabels?: boolean;
    caretColors?: readonly string[];
    onApply: (cmds: Command[]) => void;
  };

  let {
    alphabets,
    enabled,
    visible,
    applyVisible,
    showTapeLabels = true,
    caretColors,
    onApply,
  }: Props = $props();

  // Per-tape selection. Lengths follow `alphabets.length`. The $effect below
  // resyncs whenever the tape count changes (new Load with different N).
  let movements = $state<Movement[]>([]);
  let symbols = $state<(string | null)[]>([]);

  $effect(() => {
    const n = alphabets.length;
    if (movements.length !== n) {
      movements = Array.from({ length: n }, () => 'S' as Movement);
      symbols = Array.from({ length: n }, () => null);
    }
  });

  let flashing = $state(false);
  let flashTimer: ReturnType<typeof setTimeout> | null = null;

  export function flashApply(): void {
    flashing = true;
    if (flashTimer !== null) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => {
      flashing = false;
      flashTimer = null;
    }, 240);
  }

  export function reflect(cmds: Command[]): void {
    if (cmds.length !== alphabets.length) return;
    movements = cmds.map((c) => c.movement);
    symbols = cmds.map((c) => c.symbol);
  }

  function selectMovement(i: number, m: Movement): void {
    if (!enabled) return;
    const next = [...movements];
    next[i] = m;
    movements = next;
  }

  function selectSymbol(i: number, s: string | null): void {
    if (!enabled) return;
    const next = [...symbols];
    next[i] = s;
    symbols = next;
  }

  function fireApply(): void {
    if (!enabled) return;
    const cmds: Command[] = movements.map((mv, i) => ({
      movement: mv,
      symbol: symbols[i] ?? null,
    }));
    onApply(cmds);
  }

  const MOVEMENT_BUTTONS: Array<{ code: Movement; svg: string; label: string }> = [
    { code: 'L', svg: icons.left, label: 'left' },
    { code: 'S', svg: icons.stay, label: 'stay' },
    { code: 'R', svg: icons.right, label: 'right' },
  ];
</script>

<div
  class="control-panel"
  class:hidden={!visible}
  class:disabled={!enabled}
  class:no-apply={!applyVisible}
>
  <div class="interactive">
    {#each alphabets as alpha, i (i)}
      <div class="tape-row" class:no-label={!showTapeLabels}>
        {#if showTapeLabels}
          <span
            class="tape-dot"
            style={caretColors?.[i] ? `--dot: ${caretColors[i]};` : undefined}
            aria-hidden="true"
          ></span>
          <span class="tape-label">Tape {i + 1}</span>
        {/if}
        <div class="row symbols">
          <button
            type="button"
            class="cp-btn keep"
            class:selected={symbols[i] === null}
            title="Keep current symbol"
            aria-label={showTapeLabels
              ? `Tape ${i + 1}: keep current symbol`
              : 'Keep current symbol'}
            onclick={() => selectSymbol(i, null)}
          >
            {@html icons.keep}
          </button>
          {#each alpha as sym, j (j)}
            <button
              type="button"
              class="cp-btn"
              class:selected={symbols[i] === sym}
              title={j === 0 ? 'Write blank' : `Write ${sym}`}
              aria-label={showTapeLabels
                ? `Tape ${i + 1}: ${j === 0 ? 'write blank' : `write ${sym}`}`
                : j === 0 ? 'Write blank' : `Write ${sym}`}
              onclick={() => selectSymbol(i, sym)}
            >
              {j === 0 ? '␣' : sym}
            </button>
          {/each}
        </div>
        <div class="row movement">
          {#each MOVEMENT_BUTTONS as b (b.code)}
            <button
              type="button"
              class="cp-btn"
              class:selected={movements[i] === b.code}
              title={`Move ${b.label}`}
              aria-label={showTapeLabels
                ? `Tape ${i + 1}: move ${b.label}`
                : `Move ${b.label}`}
              onclick={() => selectMovement(i, b.code)}
            >
              {@html b.svg}
            </button>
          {/each}
        </div>
      </div>
    {/each}
    <div class="apply-row">
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

  .control-panel.hidden { display: none; }

  .interactive {
    display: flex;
    flex-direction: column;
    gap: 6px;
    transition: opacity 150ms ease;
  }

  .control-panel.disabled .interactive {
    opacity: 0.5;
    pointer-events: none;
  }

  .control-panel.no-apply .apply-row {
    display: none;
  }

  .tape-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 4px 0;
  }

  .tape-row + .tape-row {
    border-top: 1px solid rgba(255, 255, 255, 0.05);
  }

  .tape-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--dot, var(--head));
  }

  .tape-label {
    font-size: 12px;
    color: var(--muted);
    min-width: 50px;
  }

  .row {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }

  .row.symbols {
    flex: 1;
    min-width: 0;
  }

  .row.movement {
    margin-left: auto;
    padding-left: 8px;
    border-left: 1px solid rgba(255, 255, 255, 0.05);
  }

  .apply-row {
    display: flex;
    justify-content: flex-end;
    padding-top: 6px;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
  }

  .cp-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 30px;
    height: 28px;
    padding: 4px 8px;
    background: var(--cell-bg);
    border: 1px solid rgba(255, 255, 255, 0.06);
    color: var(--fg);
    border-radius: 4px;
    cursor: pointer;
    font: inherit;
    font-family: ui-monospace, 'SF Mono', Consolas, monospace;
    font-size: 13px;
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
    width: 16px;
    height: 16px;
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
    .tape-label {
      min-width: 40px;
    }

    .cp-btn {
      min-width: 28px;
      height: 26px;
      padding: 2px 6px;
      font-size: 12px;
    }

    .cp-btn :global(svg) {
      width: 14px;
      height: 14px;
    }

    /* Long alphabets shouldn't wrap a second row in a narrow phone — let the
       symbols row scroll horizontally. */
    .row.symbols {
      flex-wrap: nowrap;
      overflow-x: auto;
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
