<script lang="ts">
  import type { Frame, GraphHighlight, Snippet } from '@turing-machine-js/visuals';

  type Props = {
    frames: Frame[];
    /**
     * Step number to highlight. `null` clears the highlight entirely —
     * used by SnippetPanel to mirror the graph's neutral state after
     * playback finishes naturally (parallels the graph-highlight clear).
     */
    frameIndex: number | null;
    graph: Snippet['graph'];
    blanks: string[];
  };
  let { frames, frameIndex, graph, blanks }: Props = $props();

  // Frame 0 is the initial state — no transition fired, no row. Each row maps
  // 1:1 to one engine iter (frames.slice(1)).
  const rows = $derived(frames.slice(1));
  const tapeCount = $derived(rows[0]?.tape.length ?? 1);

  function nodeName(id: number | 'idle' | null): string {
    // Halt is always id 0 in the engine's Graph. The literal node name there
    // is an implementation detail (defaults like `id:0`); the table renders
    // the affordance, not the internals.
    if (id === null || id === 0) return 'halt';
    if (id === 'idle') return 'idle';
    return graph.nodes[id]?.name ?? `#${id}`;
  }

  function gotoName(highlight: GraphHighlight | null): string {
    if (!highlight) return '';
    // toId === 0 is the halt singleton; recordSnippet stamps it for halting
    // transitions. graph.nodes[0].name is 'halt' by engine convention.
    return nodeName(highlight.toId);
  }

  function stateName(highlight: GraphHighlight | null): string {
    if (!highlight) return '';
    return nodeName(highlight.fromId);
  }

  // Per-cell rendering. Returns the literal symbol (no UI substitution per
  // CLAUDE.md "No UI substitution of alphabet symbols"); the `blank` flag
  // drives a CSS dim class so blank cells stay visually distinct without
  // overloading a specific glyph (matches Tape.svelte's `.cell.blank` policy).
  type CellPart = { text: string; blank: boolean };

  function readPart(read: string, blank: string): CellPart {
    return { text: read, blank: read === blank };
  }

  function writePart(write: string, read: string, blank: string): CellPart {
    // README convention: 'keep' when write === read. Not blank-flagged — a
    // literal keep is informative on its own.
    if (write === read) return { text: 'keep', blank: false };
    return { text: write, blank: write === blank };
  }

  function movePart(movement: 'L' | 'R' | 'S'): CellPart {
    return { text: movement, blank: false };
  }

  let wrapEl: HTMLDivElement | undefined = $state();
  let tableEl: HTMLTableElement | undefined = $state();

  // Keep the highlighted row inside the trace-wrap viewport — but only
  // scroll the wrap container, never propagate to ancestor scrollers.
  // `Element.scrollIntoView` walks up every overflow ancestor (page included),
  // so a partially-visible panel would yank the whole landing layout each
  // time frameIndex ticked. Manual `scrollTop` adjustment on `.trace-wrap`
  // stays scoped to the table.
  $effect(() => {
    const step = frameIndex;
    if (!wrapEl || !tableEl || step === null || step === 0) return;
    const row = tableEl.querySelector<HTMLTableRowElement>(
      `tr[data-step="${step}"]`,
    );
    if (!row) return;
    const rowRect = row.getBoundingClientRect();
    const wrapRect = wrapEl.getBoundingClientRect();
    if (rowRect.top < wrapRect.top) {
      wrapEl.scrollTop += rowRect.top - wrapRect.top;
    } else if (rowRect.bottom > wrapRect.bottom) {
      wrapEl.scrollTop += rowRect.bottom - wrapRect.bottom;
    }
  });
</script>

<div class="trace-wrap" bind:this={wrapEl} data-testid="snippet-execution-trace">
  <table bind:this={tableEl}>
    <thead>
      <tr>
        <th scope="col">Step</th>
        <th scope="col">State</th>
        <th scope="col">Head reads</th>
        <th scope="col">Write</th>
        <th scope="col">Move</th>
        <th scope="col">Goto</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as row (row.step)}
        {@const isCurrent = row.step === frameIndex}
        {@const cmds = row.commands ?? []}
        <tr
          class:current={isCurrent}
          aria-current={isCurrent ? 'step' : undefined}
          data-testid="trace-row"
          data-step={row.step}
        >
          <td class="num">{row.step}</td>
          <td class="name">{stateName(row.highlight)}</td>
          <td>
            {#if tapeCount > 1}<span class="brace">[</span>{/if}
            {#each cmds as cmd, i (i)}
              {#if i > 0}<span class="sep">, </span>{/if}
              {@const p = readPart(cmd.read, blanks[i] ?? ' ')}
              <span class="cell" class:blank={p.blank}>{p.text}</span>
            {/each}
            {#if tapeCount > 1}<span class="brace">]</span>{/if}
          </td>
          <td>
            {#if tapeCount > 1}<span class="brace">[</span>{/if}
            {#each cmds as cmd, i (i)}
              {#if i > 0}<span class="sep">, </span>{/if}
              {@const p = writePart(cmd.write, cmd.read, blanks[i] ?? ' ')}
              <span class="cell" class:blank={p.blank}>{p.text}</span>
            {/each}
            {#if tapeCount > 1}<span class="brace">]</span>{/if}
          </td>
          <td>
            {#if tapeCount > 1}<span class="brace">[</span>{/if}
            {#each cmds as cmd, i (i)}
              {#if i > 0}<span class="sep">, </span>{/if}
              {@const p = movePart(cmd.movement)}
              <span class="cell">{p.text}</span>
            {/each}
            {#if tapeCount > 1}<span class="brace">]</span>{/if}
          </td>
          <td class="name">{gotoName(row.highlight)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .trace-wrap {
    /* Bundled showcases run short — most fit fully expanded. Longer programs
       (Copy multi-tape and friends) cap here and scroll-into-view keeps the
       current row visible. ~10 rows at the table's row height. */
    max-height: 280px;
    overflow-y: auto;
    border: 1px solid var(--cell-border);
    border-radius: 6px;
    background: var(--editor-bg);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-family: ui-monospace, 'SF Mono', Consolas, monospace;
    font-size: 0.78rem;
    color: var(--fg);
  }

  thead th {
    /* Sticky header inside the scroll container. `background` is mandatory
       so rows don't bleed through during scroll. */
    position: sticky;
    top: 0;
    background: var(--editor-bg);
    z-index: 1;
    font-weight: 600;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: color-mix(in srgb, var(--fg) 65%, transparent);
    text-align: left;
    padding: 6px 10px;
    border-bottom: 1px solid var(--cell-border);
  }

  tbody td {
    padding: 4px 10px;
    border-bottom: 1px solid color-mix(in srgb, var(--cell-border) 60%, transparent);
    white-space: nowrap;
  }

  tbody tr:last-child td {
    border-bottom: none;
  }

  tr.current {
    /* Reuses the graph's pause-highlight token — same "current focus" accent
       semantics, no new palette entry. */
    background: var(--graph-highlight-soft-fill);
  }

  td.num {
    text-align: right;
    color: color-mix(in srgb, var(--fg) 60%, transparent);
    width: 1%;
  }

  td.name {
    font-weight: 500;
  }

  .cell.blank {
    /* Mirrors Tape.svelte's `.cell.blank` policy: dim the literal blank
       glyph so blank cells stay recognisable regardless of which character
       the user chose as their blank. */
    opacity: 0.5;
  }

  .brace,
  .sep {
    color: color-mix(in srgb, var(--fg) 50%, transparent);
  }
</style>
