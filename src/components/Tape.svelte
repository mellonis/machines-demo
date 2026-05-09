<script lang="ts">
  import { tick } from 'svelte';
  import * as turing from '@turing-machine-js/machine';
  import { VIEWPORT_WIDTH } from '../lib/caps.ts';

  const MIDDLE_INDEX = (VIEWPORT_WIDTH - 1) / 2;

  // showCaret: render the head ▲ marker and reserve room below the belt.
  // For multi-tape stacks, only the bottom belt sets this true so the heads
  // visually align as one column without a stranded marker between rows.
  // caretColor: per-instance override for the --head CSS var (caret box
  // border + ▲ marker). Undefined falls back to the global --head.
  type Props = { showCaret?: boolean; caretColor?: string };
  let { showCaret = true, caretColor }: Props = $props();

  // Per-cell shape — `sym` is the literal alphabet symbol the user defined
  // (no UI substitution). `blank` flags cells holding the alphabet's blank,
  // so CSS can dim them without conflating with whatever character the user
  // chose for blank.
  type Cell = { sym: string; blank: boolean };

  // The rendered window — exactly `VIEWPORT_WIDTH` reactive cells. DOM
  // always renders all of them; mobile CSS shrinks --visible-cells so the
  // edges fade behind the mask. `setFromTape` reassigns `viewport` to a
  // `VIEWPORT_WIDTH`-long array (length guaranteed because the parent sets
  // `viewportWidth = VIEWPORT_WIDTH` on every tape).
  const blankCell = (): Cell => ({ sym: '', blank: true });
  let viewport = $state<Cell[]>(new Array(VIEWPORT_WIDTH).fill(null).map(blankCell));

  let stripEl: HTMLDivElement | undefined;

  // Single render path. Reads the upstream tape's `.viewport` (the library
  // does the slice/center math; we just copy). `null` clears the window.
  // `delta` (±1/0) drives the prep-shift slide when `animate` is true.
  // `wrote` triggers a flash on the just-written cell (which sits at the
  // visual center at slide-start; with delta we map back to its strip index).
  // `sym` (not `symbol`) avoids shadowing the built-in TS/JS `symbol` type
  // used by the upstream library for movement primitives.
  export async function setFromTape(
    tape: turing.Tape | null,
    delta: -1 | 0 | 1 = 0,
    animate = false,
    wrote = false,
  ): Promise<void> {
    if (!tape) {
      viewport = new Array(VIEWPORT_WIDTH).fill(null).map(blankCell);
      return;
    }
    const blank = tape.alphabet.blankSymbol;
    viewport = tape.viewport.map((sym) => ({ sym, blank: sym === blank }));
    const sliding = animate && delta !== 0;
    if (!wrote && !sliding) return;
    await tick();
    if (wrote) _flashWriteAt(delta);
    if (sliding) _animateSlide(delta);
  }

  function _animateSlide(delta: -1 | 0 | 1): void {
    if (!stripEl) return;
    stripEl.classList.remove('transitions-on');
    stripEl.style.transform = `translateX(calc(${delta} * var(--pitch)))`;
    void stripEl.offsetWidth; // force reflow
    stripEl.classList.add('transitions-on');
    stripEl.style.transform = 'translateX(0)';
  }

  // The just-written cell is at strip index MIDDLE_INDEX - delta in the
  // post-step viewport: with the prep-shift, that cell sits at the visual
  // center at slide-start and rides outward as the strip settles.
  function _flashWriteAt(delta: -1 | 0 | 1): void {
    const cellEl = stripEl?.children[MIDDLE_INDEX - delta] as HTMLElement | undefined;
    if (!cellEl) return;
    cellEl.classList.remove('write-flash');
    void cellEl.offsetWidth; // restart animation across rapid writes
    cellEl.classList.add('write-flash');
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
</script>

<div
  class="ui-belt"
  class:no-caret={!showCaret}
  style={caretColor ? `--head: ${caretColor};` : undefined}
  data-testid="tape"
>
  <div class="viewport">
    <div class="center">
      <div class="strip transitions-on" bind:this={stripEl}>
        {#each viewport as cell, i (i)}
          <div class="cell" class:blank={cell.blank} data-testid="tape-cell" data-blank={cell.blank}>
            <span class="sym">{cell.sym}</span>
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

    /* ▲ marker below the head cell. CSS-border triangle (not a Unicode glyph)
       so its visible edges exactly match its box — `left:50%; translateX(-50%)`
       then aligns it pixel-perfect with the head-thread line. Lives on the
       outer wrapper because the viewport has overflow:hidden. */
    &::after {
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
    &.no-caret {
      padding-bottom: 0;

      &::after {
        content: none;
      }
    }

    /* Tablet / large mobile (single-column layout, lots of horizontal room). */
    @media (max-width: 768px) {
      --cell-w: 28px;
      --cell-h: 36px;
      --visible-cells: 17;
    }

    /* Phone-sized — fewer cells, smaller cells to fit ≤480px viewports. */
    @media (max-width: 480px) {
      --cell-w: 26px;
      --cell-h: 34px;
      --visible-cells: 11;
    }
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

    &.transitions-on {
      transition: transform var(--anim-belt-slide-ms) ease;
    }
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

    /* Visual hint for blank cells — independent of which character the user
       chose for blank. Dimmed border + dimmed symbol distinguish them
       without normalizing the displayed character (so a user-defined `'␣'`
       symbol in the alphabet stays visually distinct from a blank cell). */
    &.blank {
      border-color: color-mix(in srgb, var(--cell-border) 40%, var(--cell-bg));

      .sym { opacity: 0.4; }
    }

    /* One-shot flash on the just-written cell — fades --head-tinted bg back
       to the resting state. Class is toggled imperatively in setFromTape
       (hence `:global` — Svelte's scoper can't see it on the template), and
       a forced reflow restarts the animation across rapid successive writes. */
    &:global(.write-flash) {
      animation: cell-write var(--anim-cell-write-ms) ease-out;
    }

    @media (max-width: 768px) {
      font-size: 14px;
    }
  }

  @keyframes cell-write {
    0% {
      background: color-mix(in srgb, var(--head) 65%, var(--cell-bg));
      border-color: var(--head);
    }
    100% {
      background: var(--cell-bg);
      border-color: var(--cell-border);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .cell:global(.write-flash) {
      animation: none;
    }
  }

  .sym {
    pointer-events: none;
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
</style>
