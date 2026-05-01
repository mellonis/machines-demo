<script lang="ts">
  import { tick } from 'svelte';
  import type { Command, TapeSnapshot } from '../lib/types.ts';

  // showCaret: render the head ▲ marker and reserve room below the belt.
  // For multi-tape stacks, only the bottom belt sets this true so the heads
  // visually align as one column without a stranded marker between rows.
  // caretColor: per-instance override for the --head CSS var (caret box
  // border + ▲ marker). Undefined falls back to the global --head.
  type Props = { showCaret?: boolean; caretColor?: string };
  let { showCaret = true, caretColor }: Props = $props();

  // Belt geometry. CSS owns dimensions (cell-w, cell-gap, visible-cells); JS
  // only owns counts that matter for indexing the cell array — keeping a
  // single source of truth for cell width avoided a stale-inline-style bug
  // where the responsive CSS calc was overridden by hardcoded JS values.
  // VISIBLE_CELLS is the desktop count; mobile CSS shrinks the viewport to
  // show fewer cells (the rest fade out via the mask). DOM always renders the
  // full TOTAL_CELLS regardless of breakpoint.
  const VISIBLE_CELLS = 19; // odd; head sits at exact middle
  const BUFFER_CELLS = 2;
  const TOTAL_CELLS = VISIBLE_CELLS + BUFFER_CELLS * 2;
  const MIDDLE_INDEX = (TOTAL_CELLS - 1) / 2;

  let symbols = $state<string[]>([]);
  let head = $state(0);
  let blank = $state(' ');

  let stripEl: HTMLDivElement | undefined;

  export function setFromSnapshot(snap: TapeSnapshot | null): void {
    if (!snap) {
      symbols = [];
      head = 0;
      return;
    }
    symbols = [...snap.symbols];
    head = snap.position;
    blank = snap.blank;
  }

  export function clear(): void {
    symbols = [];
    head = 0;
  }

  /**
   * Apply a command. With `animate: true` performs the prep-shift trick:
   * re-render with new head, snap-translate by ±1 cell without transition,
   * force reflow, then translate back to 0 with transition on — produces
   * a smooth slide.
   *
   * `await tick()` ensures the reactive head/symbols update has flushed to
   * the DOM before we manipulate transform; without it Svelte 5's microtask
   * scheduling can prep-shift against stale cell positions.
   */
  export async function apply(
    cmd: Command,
    { animate = false }: { animate?: boolean } = {},
  ): Promise<void> {
    const delta = cmd.movement === 'L' ? -1 : cmd.movement === 'R' ? 1 : 0;
    if (cmd.symbol !== null) {
      const next = [...symbols];
      next[head] = cmd.symbol;
      symbols = next;
    }
    head += delta;

    if (!animate || delta === 0 || !stripEl) return;

    await tick();
    if (!stripEl) return;
    stripEl.classList.remove('transitions-on');
    stripEl.style.transform = `translateX(calc(${delta} * var(--pitch)))`;
    void stripEl.offsetWidth; // force reflow
    stripEl.classList.add('transitions-on');
    stripEl.style.transform = 'translateX(0)';
  }

  export function setTransitionsEnabled(on: boolean): void {
    if (!stripEl) return;
    if (on) {
      stripEl.classList.add('transitions-on');
    } else {
      stripEl.classList.remove('transitions-on');
      stripEl.style.transform = 'translateX(0)';
    }
  }

  function cellInfo(i: number): { display: string; isBlank: boolean; isOutOfRange: boolean } {
    const abs = head + (i - MIDDLE_INDEX);
    const raw = symbols[abs];
    const isOutOfRange = raw === undefined;
    const isBlank = isOutOfRange || raw === blank;
    const display = isBlank ? '␣' : raw;
    return { display, isBlank, isOutOfRange };
  }
</script>

<div
  class="ui-belt"
  class:no-caret={!showCaret}
  style={caretColor ? `--head: ${caretColor};` : undefined}
>
  <div class="viewport">
    <div class="center">
      <div class="strip transitions-on" bind:this={stripEl}>
        {#each Array(TOTAL_CELLS) as _cell, i}
          {@const c = cellInfo(i)}
          <div class="cell" class:out-of-range={c.isOutOfRange}>
            <span class="sym">{c.display}</span>
          </div>
        {/each}
      </div>
    </div>
    <div class="caret"></div>
  </div>
</div>

<style>
  .ui-belt {
    --cell-w: 32px;
    --cell-h: 40px;
    --cell-gap: 4px;
    --visible-cells: 19;
    --fade-cells: 2.5;
    --pitch: calc(var(--cell-w) + var(--cell-gap));
    --width: calc(var(--visible-cells) * var(--cell-w) + (var(--visible-cells) - 1) * var(--cell-gap));
    --fade: calc(var(--fade-cells) * var(--pitch));
    position: relative;
    display: flex;
    justify-content: center;
    font-family: ui-monospace, 'SF Mono', Consolas, monospace;
    padding-bottom: 14px;
  }

  /* ▲ marker below the head cell. CSS-border triangle (not a Unicode glyph)
     so its visible edges exactly match its box — `left:50%; translateX(-50%)`
     then aligns it pixel-perfect with the head-thread line. Lives on the
     outer wrapper because the viewport has overflow:hidden. */
  .ui-belt::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 0;
    height: 0;
    border-left: 5px solid transparent;
    border-right: 5px solid transparent;
    border-bottom: 8px solid var(--head);
  }

  /* Multi-tape stack: non-bottom belts drop the marker and the room reserved
     for it, so the stack reads as one continuous column of heads. */
  .ui-belt.no-caret {
    padding-bottom: 0;
  }

  .ui-belt.no-caret::after {
    content: none;
  }

  .viewport {
    position: relative;
    width: var(--width);
    max-width: 100%;
    height: var(--cell-h);
    overflow: hidden;
    /* Solid bg masks the head-thread behind the stack across the entire
       tape row, including the inter-cell gaps that pass through the head
       column during slide animations. Page bg keeps the inter-cell gaps
       visually identical to the surrounding panel. */
    background: var(--bg);
    -webkit-mask-image: linear-gradient(
      to right,
      transparent 0,
      black var(--fade),
      black calc(100% - var(--fade)),
      transparent 100%
    );
    mask-image: linear-gradient(
      to right,
      transparent 0,
      black var(--fade),
      black calc(100% - var(--fade)),
      transparent 100%
    );
  }

  .center {
    display: flex;
    justify-content: center;
    height: 100%;
  }

  .strip {
    display: flex;
    gap: var(--cell-gap);
    align-items: center;
    height: 100%;
    transform: translateX(0);
  }

  .strip.transitions-on {
    transition: transform var(--anim-belt-slide-ms) ease;
  }

  .cell {
    position: relative;
    flex: 0 0 auto;
    width: var(--cell-w);
    height: var(--cell-h);
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--cell-bg);
    border: 1px solid var(--cell-border);
    border-radius: 4px;
    font-size: 16px;
    white-space: pre;
  }

  .sym {
    pointer-events: none;
  }

  /* Cells beyond the actual tape range — visually dim to hint "infinite blank".
     Dim only border + symbol; the cell bg must stay opaque so the head-thread
     line behind the stack is masked rather than bleeding through. */
  .cell.out-of-range {
    border-color: color-mix(in srgb, var(--cell-border) 40%, var(--cell-bg));
  }
  .cell.out-of-range .sym {
    opacity: 0.4;
  }

  .caret {
    position: absolute;
    left: 50%;
    top: 0;
    transform: translateX(-50%);
    width: var(--cell-w);
    height: var(--cell-h);
    border: 1px solid var(--head);
    border-radius: 4px;
    box-shadow: 0 0 0 1px var(--head) inset;
    pointer-events: none;
  }

  /* Tablet / large mobile (single-column layout, but lots of horizontal room).
     Belt was way too narrow at ~757px under the old phone-tuned mobile rules. */
  @media (max-width: 768px) {
    .ui-belt {
      --cell-w: 28px;
      --cell-h: 36px;
      --visible-cells: 17;
    }
    .cell {
      font-size: 14px;
    }
  }

  /* Phone-sized — fewer cells, smaller cells to actually fit ≤480px viewports. */
  @media (max-width: 480px) {
    .ui-belt {
      --cell-w: 26px;
      --cell-h: 34px;
      --visible-cells: 11;
    }
  }
</style>
