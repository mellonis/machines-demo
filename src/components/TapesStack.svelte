<script lang="ts">
  import type * as turing from '@turing-machine-js/machine';
  import Tape from './Tape.svelte';

  type Props = {
    tapeCount: number;
    caretColors: readonly string[];
    /** When true, user-facing interactive surfaces on the tape stack are
     *  disabled. Currently `TapesStack` and `Tape` have no interactive
     *  handlers of their own (caret-edit and copy/paste live on
     *  `MachineView`), so this prop is a forward-compat marker for Task 7
     *  (`setTapeViewport`, etc.). The imperative API (`setFromTape`,
     *  `clearAll`, `setTransitionsEnabled`) is unaffected. */
    readOnly?: boolean;
  };
  let { tapeCount, caretColors, readOnly: _readOnly = false }: Props = $props();

  let tapeRefs = $state<Array<ReturnType<typeof Tape> | undefined>>([]);

  // Hard-stop gradient: each tape row is solid color[i]; transitions happen
  // only in the inter-tape gap. Stops are pixel offsets built from the
  // .tapes-stack CSS vars (--cell-h, --tape-gap) so they track breakpoints.
  const headThreadBackground = $derived.by(() => {
    const colors = caretColors.slice(0, tapeCount);
    if (colors.length === 1) return colors[0];
    const stops: string[] = [];
    for (let i = 0; i < colors.length; i++) {
      const top = `calc(${i} * (var(--cell-h) + var(--tape-gap)))`;
      const bot = `calc(${i} * (var(--cell-h) + var(--tape-gap)) + var(--cell-h))`;
      stops.push(`${colors[i]} ${top}`, `${colors[i]} ${bot}`);
    }
    return `linear-gradient(to bottom, ${stops.join(', ')})`;
  });

  // Imperative API — parent advances the mirror, then asks the matching
  // <Tape> child to render its updated viewport. We don't take per-tape
  // refs across the boundary; this stack owns them.
  export function setFromTape(
    i: number,
    tape: turing.Tape | null,
    delta: -1 | 0 | 1 = 0,
    animate = false,
    wrote = false,
  ): void {
    void tapeRefs[i]?.setFromTape(tape, delta, animate, wrote);
  }

  // Render a pre-windowed cell array directly into tape `i`, bypassing
  // `turing.Tape.viewport`. Used by `SnippetPanel` — Frame.tape snapshots
  // are wire-format `TapeSnapshot`s, not live tapes; `tapeViewport()` from
  // `@turing-machine-js/visuals` is called by the caller to derive the
  // window from the snapshot, then handed in here as `cells`. `headIndex`
  // is the head's position within `cells` (currently always the center for
  // centered viewports; kept for future non-centered layouts). `blank` is
  // the alphabet's blank symbol so cell-dim styling stays correct.
  export function setTapeViewport(
    i: number,
    cells: string[],
    headIndex: number,
    blank: string,
  ): void {
    tapeRefs[i]?.setFromCells(cells, headIndex, blank);
  }

  export function clearAll(): void {
    tapeRefs.forEach((r) => void r?.setFromTape(null));
  }

  export function setTransitionsEnabled(on: boolean): void {
    tapeRefs.forEach((r) => r?.setTransitionsEnabled(on));
  }
</script>

<div class="tapes-stack" data-testid="tapes-stack">
  <div class="head-thread" style:background={headThreadBackground}></div>
  {#each Array(tapeCount) as _, i (i)}
    <Tape
      bind:this={tapeRefs[i]}
      showCaret={i === tapeCount - 1}
      caretColor={caretColors[i]}
    />
  {/each}
</div>

<style>
  /* Tight inter-belt spacing for multi-tape stacks; the bottom belt's
     padding-bottom (reserving the ▲ marker) is preserved, while non-bottom
     belts drop their padding (Tape's `.no-caret` rule). */
  .tapes-stack {
    /* --cell-h mirrors Tape.svelte's responsive cell height; --tape-gap is
       the flex gap between belts. Both feed the head-thread gradient stops. */
    --cell-h: 40px;
    --tape-gap: 4px;
    position: relative;
    display: flex;
    flex-direction: column;
    gap: var(--tape-gap);

    /* prefers-reduced-motion: skip the enter slide-in. */
    @media not (prefers-reduced-motion: reduce) {
      animation: enter var(--anim-belt-enter-ms) ease-out backwards;
    }

    @media (max-width: 768px) { --cell-h: 36px; }
    @media (max-width: 480px) { --cell-h: 34px; }
  }

  /* Vertical thread connecting per-tape caret boxes through the inter-belt
     gaps and down to the ▲ marker. Sits behind tapes and is masked by the
     opaque .viewport in each Tape, so visually it only renders in the gap
     regions and the bottom belt's padding-bottom (where the marker lives).
     The thread terminates at the marker's vertical center (CSS triangle is
     8px tall in Tape.svelte, so 4px = half). The marker paints over the
     overlapping segment and shares the gradient's bottom color. */
  .head-thread {
    position: absolute;
    top: 0;
    bottom: 4px;
    left: 50%;
    width: 2px;
    transform: translateX(-50%);
    pointer-events: none;
  }

  @keyframes enter {
    from { opacity: 0; transform: translateY(20px); }
    to   { opacity: 1; transform: translateY(0); }
  }
</style>
