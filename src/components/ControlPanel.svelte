<script lang="ts">
  import { icons } from '../lib/icons.ts';
  import type { Alphabets, Command, Movement } from '../lib/types.ts';

  type Props = {
    alphabets: Alphabets;
    enabled: boolean;
    applyVisible: boolean;
    /** Show colored dot + "Tape N" label per row. Hidden for inherently
     * single-tape engines (Post) where the label is redundant. */
    showTapeLabels?: boolean;
    caretColors?: readonly string[];
    onApply: (commands: Command[]) => void;
  };

  let {
    alphabets,
    enabled,
    applyVisible,
    showTapeLabels = true,
    caretColors,
    onApply,
  }: Props = $props();

  // Per-tape selection. Lengths follow `alphabets.length`. The $effect below
  // resyncs whenever the tape count changes (new Build with different N).
  let movements = $state<Movement[]>([]);
  let symbols = $state<(string | null)[]>([]);

  $effect(() => {
    const n = alphabets.length;
    if (movements.length !== n) {
      movements = Array.from({ length: n }, () => 'S' as Movement);
      symbols = Array.from({ length: n }, () => null);
    }
  });

  // How long the Apply button stays in the `.pressed` (flash) state after a
  // demo-driven apply. Long enough to read as a press, short enough to fall
  // well within DEMO_REFLECT_DELAY_MS (700) so each tick's flash resolves
  // before the next reflect.
  const APPLY_FLASH_MS = 240;

  let flashing = $state(false);
  let flashTimeoutId: ReturnType<typeof setTimeout> | null = null;

  export function flashApply(): void {
    flashing = true;
    if (flashTimeoutId !== null) clearTimeout(flashTimeoutId);
    flashTimeoutId = setTimeout(() => {
      flashing = false;
      flashTimeoutId = null;
    }, APPLY_FLASH_MS);
  }

  export function reflect(commands: Command[]): void {
    if (commands.length !== alphabets.length) return;
    movements = commands.map((c) => c.movement);
    symbols = commands.map((c) => c.symbol);
  }

  function selectMovement(i: number, m: Movement): void {
    if (!enabled) return;
    movements = movements.with(i, m);
  }

  function selectSymbol(i: number, s: string | null): void {
    if (!enabled) return;
    symbols = symbols.with(i, s);
  }

  function fireApply(): void {
    if (!enabled) return;
    const commands: Command[] = movements.map((movement, i) => ({
      movement,
      symbol: symbols[i] ?? null,
    }));
    onApply(commands);
  }

  const MOVEMENT_BUTTONS: Array<{ code: Movement; svg: string; label: string }> = [
    { code: 'L', svg: icons.left, label: 'left' },
    { code: 'S', svg: icons.stay, label: 'stay' },
    { code: 'R', svg: icons.right, label: 'right' },
  ];

  // Svelte action: tracks horizontal scroll position on the symbols row and
  // toggles `can-scroll-left` / `can-scroll-right` classes. CSS uses these
  // classes to drive a mask-image fade so the edges of the row hint at
  // off-screen content only when there's actually content there to scroll
  // to. Fires on scroll and on resize (alphabet length / panel width).
  function scrollEdgeIndicator(node: HTMLElement) {
    const update = () => {
      const atLeft = node.scrollLeft <= 0;
      const atRight = node.scrollLeft + node.clientWidth >= node.scrollWidth - 1;
      node.classList.toggle('can-scroll-left', !atLeft);
      node.classList.toggle('can-scroll-right', !atRight);
    };
    update();
    node.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(node);
    return {
      destroy() {
        node.removeEventListener('scroll', update);
        ro.disconnect();
      },
    };
  }
</script>

<div
  class="control-panel"
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
          <div class="symbols-scroll" use:scrollEdgeIndicator>
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
            <!-- `sym` not `symbol` — the latter shadows the built-in TS/JS
                 `symbol` type the upstream library uses for movement primitives.
                 No UI substitution: the button shows the literal alphabet
                 symbol, including whatever the user picked for blank. -->
            {#each alpha as sym, j (j)}
              <button
                type="button"
                class="cp-btn"
                class:blank={j === 0}
                class:selected={symbols[i] === sym}
                title={j === 0 ? 'Write blank' : `Write ${sym}`}
                aria-label={showTapeLabels
                  ? `Tape ${i + 1}: ${j === 0 ? 'write blank' : `write ${sym}`}`
                  : j === 0 ? 'Write blank' : `Write ${sym}`}
                onclick={() => selectSymbol(i, sym)}
              >
                {sym}
              </button>
            {/each}
          </div>
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

    &.disabled .interactive {
      opacity: 0.5;
      pointer-events: none;
    }

    &.no-apply .apply-row {
      display: none;
    }
  }

  .interactive {
    display: flex;
    flex-direction: column;
    gap: 6px;
    transition: opacity 150ms ease;
  }

  .tape-row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 4px 0;

    & + & {
      border-top: 1px solid var(--divider);
    }
  }

  .tape-dot {
    /* Class-level default keeps `var(--dot)` resolvable without a fallback;
       the inline `style="--dot: …"` from caretColors[i] overrides it when
       a per-tape color is provided. */
    --dot: var(--head);
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--dot);
  }

  .tape-label {
    font-size: 12px;
    color: var(--muted);
    min-width: 50px;

    @media (max-width: 768px) {
      min-width: 40px;
    }
  }

  .row {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;

    &.symbols {
      /* Outer is the flex item that participates in .tape-row layout.
         Splitting layout (outer) from overflow (inner .symbols-scroll)
         is required: a single element doing both didn't scroll because
         the flex algorithm derives its width from content, defeating
         the overflow clip. */
      flex: 1;
      min-width: 0;
      display: block;
    }

    &.movement {
      margin-left: auto;
      padding-left: 8px;
      border-left: 1px solid var(--divider);
    }
  }

  /* Inner scroll container for the symbols row — owns the overflow.
     Long alphabets scroll horizontally instead of wrapping, so each
     tape's row height stays constant and chips line up across tapes.

     Edge fades: the `can-scroll-*` classes are toggled by the
     scrollEdgeIndicator action; `mask-image` softens whichever edge
     has off-screen content so the user sees an affordance for scroll. */
  .symbols-scroll {
    --edge-fade: 20px;
    display: flex;
    flex-wrap: nowrap;
    gap: 4px;
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;

    &::-webkit-scrollbar {
      display: none;
    }

    .cp-btn {
      flex-shrink: 0;
    }

    /* `can-scroll-*` classes are toggled at runtime by the
       scrollEdgeIndicator action — Svelte's CSS scoper can't see
       them in the template, hence :global(...). */
    &:global(.can-scroll-left.can-scroll-right) {
      -webkit-mask-image: linear-gradient(
        to right,
        transparent 0,
        black var(--edge-fade),
        black calc(100% - var(--edge-fade)),
        transparent 100%
      );
      mask-image: linear-gradient(
        to right,
        transparent 0,
        black var(--edge-fade),
        black calc(100% - var(--edge-fade)),
        transparent 100%
      );
    }

    &:global(.can-scroll-left:not(.can-scroll-right)) {
      -webkit-mask-image: linear-gradient(
        to right,
        transparent 0,
        black var(--edge-fade),
        black 100%
      );
      mask-image: linear-gradient(
        to right,
        transparent 0,
        black var(--edge-fade),
        black 100%
      );
    }

    &:global(.can-scroll-right:not(.can-scroll-left)) {
      -webkit-mask-image: linear-gradient(
        to right,
        black 0,
        black calc(100% - var(--edge-fade)),
        transparent 100%
      );
      mask-image: linear-gradient(
        to right,
        black 0,
        black calc(100% - var(--edge-fade)),
        transparent 100%
      );
    }
  }

  .apply-row {
    display: flex;
    justify-content: flex-end;
    padding-top: 6px;
    border-top: 1px solid var(--divider);
  }

  .cp-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 30px;
    height: 28px;
    padding: 4px 8px;
    background: var(--cell-bg);
    border: 1px solid var(--hover-bg);
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

    &:hover {
      border-color: color-mix(in srgb, var(--accent) 50%, transparent);
      color: var(--accent);
    }

    /* Blank-symbol chip — matches Tape.svelte's `.cell.blank`: dim border +
       dim glyph so the chip is recognisably "blank" regardless of which
       character the user chose. Min-width keeps the chip a clickable size
       even when the blank symbol is an invisible space. */
    &.blank {
      min-width: 30px;
      border-color: color-mix(in srgb, var(--hover-bg) 40%, var(--cell-bg));
      color: color-mix(in srgb, var(--fg) 40%, var(--cell-bg));
    }

    &.selected {
      background: color-mix(in srgb, var(--accent) 20%, transparent);
      border-color: var(--accent);
      color: var(--accent);
    }

    &.pressed {
      background: color-mix(in srgb, var(--accent) 40%, transparent);
      border-color: var(--accent);
      color: var(--accent);
      transform: scale(0.96);
      transition: background-color 80ms ease, transform 80ms ease;
    }

    :global(svg) {
      width: 16px;
      height: 16px;
      display: block;
    }

    @media (max-width: 768px) {
      min-width: 28px;
      height: 26px;
      padding: 2px 6px;
      font-size: 12px;

      :global(svg) {
        width: 14px;
        height: 14px;
      }
    }
  }

  .apply {
    min-width: 64px;
  }

  @keyframes enter {
    from { opacity: 0; transform: translateY(20px); }
    to   { opacity: 1; transform: translateY(0); }
  }
</style>
