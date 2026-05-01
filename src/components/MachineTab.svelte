<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import Tape from './Tape.svelte';
  import ControlPanel from './ControlPanel.svelte';
  import Log from './Log.svelte';
  import type { LogEntry, LogKind } from '../lib/log.ts';
  import { MachineRunner } from '../lib/runner.ts';
  import { type Command, type Engine, type TapeSnapshot } from '../lib/types.ts';
  import { startDemoLoop } from '../lib/demoLoop.ts';
  import { startAutoStep, parseInterval } from '../lib/autoStep.ts';
  import {
    alphabetsEntry,
    appliedEntry,
    stepEntry,
    tapesEntry,
  } from '../lib/format.ts';
  import {
    defaultExample,
    examples,
    findExample,
    type Example,
  } from '../lib/defaultCode.ts';
  import { loadCode, loadExampleId, saveExampleId } from '../lib/persist.ts';
  import { icons } from '../lib/icons.ts';
  import pkg from '../../package.json';

  type Props = { engine: Engine };
  let { engine }: Props = $props();

  /* ───── constants ───── */

  const SYNTHETIC_ALPHABETS: readonly (readonly string[])[] = [
    [' ', 'a', 'b', '*'],
  ];
  const NEUTRAL_COMMAND: Command = { movement: 'S', symbol: null };

  // Per-tape caret colors for multi-tape stacks. Length must match MAX_TAPES
  // (worker rejects loads with more tapes than the palette can color).
  const CARET_COLORS: readonly string[] = [
    '#6ea8fe', // blue
    '#ff6b6b', // red
    '#5fd068', // green
    '#c084fc', // purple
    '#ffd166', // amber
  ];
  const APP_VERSION = pkg.version;

  type ExecutionMode =
    | 'DEMO'
    | 'MANUAL'
    | 'RUNNING_STEP'
    | 'RUNNING_AUTO'
    | 'RUNNING_CONTINUOUS'
    | 'HALTED';

  /* ───── state ───── */

  let executionMode = $state<ExecutionMode>('DEMO');
  let userTookControl = $state(false);
  let demoEnabled = $state(true);
  let halted = $state(false);
  let alphabets = $state<readonly (readonly string[])[]>(SYNTHETIC_ALPHABETS);
  let entries = $state<LogEntry[]>([]);
  let lastSnapshots = $state<TapeSnapshot[] | null>(null);
  let pendingOp = $state<'load' | 'run' | null>(null);
  let stepInFlight = $state(false);
  let withPause = $state(false);
  let intervalText = $state('1s');
  let workerLive = $state(false);
  // engine is fixed for a MachineTab instance (parent remounts on engine change
  // via {#key activeEngine}). untrack() acknowledges we want a one-time read.
  const engineExamples = untrack(() => examples(engine));
  const initialExample = untrack(() => {
    const persistedId = loadExampleId(engine);
    return (persistedId && findExample(engine, persistedId)) || defaultExample(engine);
  });
  let selectedExampleId = $state<string>(initialExample.id);
  let code = $state<string>(
    untrack(() => loadCode(engine) ?? initialExample.code),
  );
  let examplesOpen = $state(false);
  let examplesMenuEl: HTMLDivElement | undefined;

  const selectedExample = $derived(
    findExample(engine, selectedExampleId) ?? defaultExample(engine),
  );

  let tapeRefs = $state<Array<ReturnType<typeof Tape> | undefined>>([]);
  let panelRef = $state<ReturnType<typeof ControlPanel> | undefined>();

  // Editor pulls in all of CodeMirror (~500 KB unzipped). Lazy-load it so the
  // initial paint of header + tape + control-panel ships in a small bundle;
  // the editor chunk loads in parallel and slots in once ready.
  const editorPromise = import('./Editor.svelte').then((m) => m.default);

  const runner = new MachineRunner(untrack(() => engine));

  /* ───── derived ─────
   * Single source of truth for button-disabled state and panel visibility.
   * Every UI flag derives from (executionMode, halted, workerLive, pendingOp)
   * — no per-handler bespoke resets, no manual mode-switch tables.
   */

  const intervalMs = $derived(parseInterval(intervalText));
  const intervalIsValid = $derived(intervalMs !== null);
  const latestEntry = $derived(entries.length > 0 ? entries[entries.length - 1] : null);

  // ControlPanel handles both single- and multi-tape via Command[]; tape
  // labels are only useful to disambiguate, so show them only when N > 1.
  const tapeCount = $derived(lastSnapshots?.length ?? 1);
  const showTapeLabels = $derived(tapeCount > 1);
  // Hard-stop gradient: each tape row is solid color[i]; transitions happen
  // only in the inter-tape gap. Stops are pixel offsets built from the
  // .tapes-stack CSS vars (--cell-h, --tape-gap) so they track breakpoints.
  const headThreadBackground = $derived.by(() => {
    const colors = CARET_COLORS.slice(0, tapeCount);
    if (colors.length === 1) return colors[0];
    const stops: string[] = [];
    for (let i = 0; i < colors.length; i++) {
      const top = `calc(${i} * (var(--cell-h) + var(--tape-gap)))`;
      const bot = `calc(${i} * (var(--cell-h) + var(--tape-gap)) + var(--cell-h))`;
      stops.push(`${colors[i]} ${top}`, `${colors[i]} ${bot}`);
    }
    return `linear-gradient(to bottom, ${stops.join(', ')})`;
  });
  const panelEnabled = $derived(executionMode === 'MANUAL');
  const applyVisible = $derived(
    executionMode === 'DEMO' || executionMode === 'MANUAL',
  );
  const takeControlVisible = $derived(
    executionMode !== 'MANUAL' && executionMode !== 'RUNNING_CONTINUOUS',
  );
  const beltTransitionsOn = $derived(executionMode !== 'RUNNING_CONTINUOUS');

  const loadDisabled = $derived(pendingOp !== null);
  const stepDisabled = $derived(
    pendingOp !== null ||
      halted ||
      !workerLive ||
      executionMode === 'RUNNING_CONTINUOUS',
  );
  // stepInFlight is intentionally NOT in the disabled state — the worker call
  // is fast (~ms), and we don't want the user to see flicker on rapid clicks.
  // Soft-debounced inside doStep() instead.
  const runDisabled = $derived(
    pendingOp !== null ||
      halted ||
      !workerLive ||
      executionMode === 'RUNNING_AUTO' ||
      executionMode === 'RUNNING_CONTINUOUS' ||
      (withPause && !intervalIsValid),
  );

  /* ───── log helpers ───── */

  function report(textOrEntry: string | LogEntry, kind?: LogKind): void {
    const entry: LogEntry =
      typeof textOrEntry === 'string'
        ? { text: textOrEntry, kind }
        : kind
          ? { ...textOrEntry, kind }
          : textOrEntry;
    entries = [...entries, entry];
  }

  function appendBatch(items: LogEntry[]): void {
    if (items.length === 0) return;
    entries = [...entries, ...items];
  }

  function clearLog(): void {
    entries = [];
  }

  /* ───── side-effect handlers (one source of truth on error) ───── */

  function failHalted(err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    report(`error: ${msg}`, 'error');
    halted = true;
    executionMode = 'HALTED';
  }

  /* ───── load / step / run ───── */

  function applyToAll(commands: Command[], opts: { animate: boolean }): void {
    commands.forEach((cmd, i) => {
      void tapeRefs[i]?.apply(cmd, opts);
    });
  }

  function setAllFromSnapshots(snaps: TapeSnapshot[]): void {
    snaps.forEach((s, i) => tapeRefs[i]?.setFromSnapshot(s));
  }

  function reflectToActivePanel(cmds: Command[] | null): void {
    if (!cmds || cmds.length === 0) return;
    panelRef?.reflect(cmds);
  }

  function reflectNeutral(): void {
    const neutrals = Array.from({ length: tapeCount }, () => ({ ...NEUTRAL_COMMAND }));
    panelRef?.reflect(neutrals);
  }

  async function doLoad({ userInitiated = false } = {}): Promise<void> {
    if (userInitiated) demoEnabled = false;
    report('loading…');
    pendingOp = 'load';
    try {
      const res = await runner.load(code);
      workerLive = true;
      alphabets = res.alphabets;
      lastSnapshots = res.tapes;
      // Tape refs are bound by {#each tapes}: wait one tick for the new
      // <Tape> instances to mount before pushing snapshots into them.
      await tick();
      setAllFromSnapshots(res.tapes);
      halted = res.halted;
      appendBatch([
        alphabetsEntry(res.alphabets, CARET_COLORS),
        tapesEntry(res.tapes, CARET_COLORS),
      ]);
      report(res.halted ? 'loaded — halted immediately' : 'loaded — ready', 'ok');
      executionMode = userTookControl ? 'MANUAL' : 'DEMO';
      // Wait one tick so the right panel has mounted/swapped before reflect.
      await tick();
      reflectToActivePanel(res.nextCommands);
    } catch (err) {
      workerLive = false;
      alphabets = SYNTHETIC_ALPHABETS;
      tapeRefs.forEach((r) => r?.clear());
      lastSnapshots = null;
      halted = true;
      const msg = err instanceof Error ? err.message : String(err);
      report(`error: ${msg}`, 'error');
      executionMode = userTookControl ? 'MANUAL' : 'DEMO';
    } finally {
      pendingOp = null;
    }
  }

  async function doStep(): Promise<void> {
    // Step button doubles as "Pause" while RUNNING_AUTO.
    if (executionMode === 'RUNNING_AUTO') {
      executionMode = 'RUNNING_STEP';
      report('paused');
      return;
    }
    // Soft-debounce: drop rapid clicks while a worker step is in flight. The
    // belt animation does NOT block — the user can click again as soon as the
    // worker returns (~ms), even mid-slide.
    if (stepInFlight) return;
    if (executionMode !== 'RUNNING_STEP') {
      if (lastSnapshots) setAllFromSnapshots(lastSnapshots);
      executionMode = 'RUNNING_STEP';
    }
    stepInFlight = true;
    let res;
    try {
      res = await runner.step();
    } catch (err) {
      failHalted(err);
      return;
    } finally {
      stepInFlight = false;
    }
    lastSnapshots = res.tapes;
    halted = res.halted;
    if (res.halted) {
      report(`halted after ${res.stepsApplied} step(s)`, 'ok');
      executionMode = 'HALTED';
    } else {
      report(stepEntry(res.stepsApplied, res.commands, CARET_COLORS));
    }
    if (res.commands) {
      applyToAll(res.commands, { animate: true });
      // Show what's queued for the *next* click, not what just applied.
      // Keeps panel state consistent under rapid clicks.
      if (res.nextCommands) reflectToActivePanel(res.nextCommands);
      else reflectNeutral();
    } else {
      setAllFromSnapshots(res.tapes);
    }
  }

  async function doRun(): Promise<void> {
    if (withPause) {
      if (executionMode !== 'RUNNING_STEP' && lastSnapshots) {
        setAllFromSnapshots(lastSnapshots);
      }
      executionMode = 'RUNNING_AUTO';
      report(`auto-stepping every ${intervalMs}ms`);
      // Auto-step loop is started by the $effect that watches executionMode.
      return;
    }
    if (lastSnapshots) setAllFromSnapshots(lastSnapshots);
    reflectNeutral();
    executionMode = 'RUNNING_CONTINUOUS';
    report('running…');
    pendingOp = 'run';
    try {
      const res = await runner.run();
      lastSnapshots = res.tapes;
      setAllFromSnapshots(res.tapes);
      halted = true;
      reflectNeutral();
      if (res.commands.length > 0) {
        appendBatch(
          res.commands.map((cmds, i) =>
            stepEntry(res.startStep + i + 1, cmds, CARET_COLORS),
          ),
        );
      }
      if (res.truncated) {
        report(`truncated at ${res.stepsApplied} steps (limit hit)`, 'warn');
      } else {
        report(`halted after ${res.stepsApplied} step(s)`, 'ok');
      }
      executionMode = 'HALTED';
    } catch (err) {
      failHalted(err);
    } finally {
      pendingOp = null;
    }
  }

  function takeControl(): void {
    userTookControl = true;
    executionMode = 'MANUAL';
  }

  function onApply(cmds: Command[]): void {
    applyToAll(cmds, { animate: true });
    report(appliedEntry(cmds, CARET_COLORS));
  }

  function resetCodeToSelected(): void {
    code = selectedExample.code;
  }

  function pickExample(ex: Example): void {
    selectedExampleId = ex.id;
    code = ex.code;
    examplesOpen = false;
  }

  // Persist the selected example id (separate from the editor code) so the
  // reset button keeps targeting the chosen source across reloads.
  $effect(() => {
    saveExampleId(engine, selectedExampleId);
  });

  // Close dropdown on outside click / Escape — only while open.
  $effect(() => {
    if (!examplesOpen) return;
    const onPointer = (e: MouseEvent): void => {
      if (!examplesMenuEl?.contains(e.target as Node)) examplesOpen = false;
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') examplesOpen = false;
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  });

  /* ───── effects ─────
   * Demo loop, auto-step loop, and belt-transitions all derive from state.
   */

  // DEMO loop is array-shape for both engines now (Post is length-1, Turing
  // length-N). Drives ControlPanel.reflect / .flashApply uniformly.
  $effect(() => {
    if (executionMode !== 'DEMO' || !demoEnabled) return;
    return startDemoLoop({
      reflect: (cmds) => panelRef?.reflect(cmds),
      apply: (cmds) => {
        panelRef?.flashApply();
        applyToAll(cmds, { animate: true });
      },
      getAlphabets: () => alphabets,
    });
  });

  $effect(() => {
    if (executionMode === 'RUNNING_AUTO' && intervalMs !== null) {
      return startAutoStep(intervalMs, async () => {
        try {
          const res = await runner.step();
          lastSnapshots = res.tapes;
          halted = res.halted;
          if (executionMode !== 'RUNNING_AUTO') return;
          if (res.commands) {
            reflectToActivePanel(res.commands);
            applyToAll(res.commands, { animate: true });
          } else {
            setAllFromSnapshots(res.tapes);
          }
          if (res.halted) {
            report(`halted after ${res.stepsApplied} step(s)`, 'ok');
            executionMode = 'HALTED';
          } else {
            report(stepEntry(res.stepsApplied, res.commands, CARET_COLORS));
          }
        } catch (err) {
          failHalted(err);
        }
      });
    }
  });

  $effect(() => {
    tapeRefs.forEach((r) => r?.setTransitionsEnabled(beltTransitionsOn));
  });

  /* ───── lifecycle ───── */

  onMount(() => {
    void doLoad();
  });

  onDestroy(() => {
    runner.terminate();
  });
</script>

<section class="tab">
  <div class="panel-tape">
    <div class="tapes-stack">
      <div class="head-thread" style:background={headThreadBackground}></div>
      {#each Array(tapeCount) as _, i}
        <Tape
          bind:this={tapeRefs[i]}
          showCaret={i === tapeCount - 1}
          caretColor={CARET_COLORS[i]}
        />
      {/each}
    </div>

    <ControlPanel
      bind:this={panelRef}
      {alphabets}
      enabled={panelEnabled}
      visible={true}
      {applyVisible}
      {showTapeLabels}
      caretColors={CARET_COLORS}
      {onApply}
    />

    {#if takeControlVisible}
      <button class="take-control" type="button" onclick={takeControl}>
        {@html icons.takeControl}
        <span class="btn-label">Take control</span>
      </button>
    {/if}

    <Log {entries} onclear={clearLog} />
  </div>

  <div class="panel-editor">
    <div class="controls">
      <div class="examples-menu" bind:this={examplesMenuEl}>
        <button
          type="button"
          class="icon-only"
          aria-label="Example code sources"
          aria-haspopup="menu"
          aria-expanded={examplesOpen}
          title="Example code sources"
          onclick={() => (examplesOpen = !examplesOpen)}
        >
          {@html icons.examples}
        </button>
        {#if examplesOpen}
          <ul class="dropdown" role="menu">
            {#each engineExamples as ex (ex.id)}
              <li role="none">
                <button
                  type="button"
                  role="menuitem"
                  class:selected={ex.id === selectedExampleId}
                  onclick={() => pickExample(ex)}
                >
                  {ex.title}
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
      <button type="button" disabled={loadDisabled} onclick={() => doLoad({ userInitiated: true })}>
        {@html icons.load}<span class="btn-label">Load</span>
      </button>
      <button type="button" disabled={stepDisabled} onclick={doStep}>
        {@html executionMode === 'RUNNING_AUTO' ? icons.pause : icons.step}
        <span class="btn-label">{executionMode === 'RUNNING_AUTO' ? 'Pause' : 'Step'}</span>
      </button>
      <button type="button" disabled={runDisabled} onclick={doRun}>
        {@html icons.run}<span class="btn-label">Run</span>
      </button>
      <label class="checkbox">
        <input type="checkbox" bind:checked={withPause} disabled={runDisabled} />
        <span>with pause</span>
      </label>
      {#if withPause}
        <input
          type="text"
          class="interval-input"
          class:invalid={!intervalIsValid}
          bind:value={intervalText}
          placeholder="1s"
        />
      {/if}
    </div>
    <div
      class="status"
      class:error={latestEntry?.kind === 'error'}
      class:warn={latestEntry?.kind === 'warn'}
      class:ok={latestEntry?.kind === 'ok'}
    >
      {latestEntry?.text ?? ''}
    </div>
    {#await editorPromise}
      <div class="editor-loading">Loading editor…</div>
    {:then Editor}
      <Editor {engine} bind:code onreset={resetCodeToSelected} />
    {:catch err}
      <div class="editor-error">Failed to load editor: {err.message}</div>
    {/await}
    <div class="version">v{APP_VERSION}</div>
  </div>
</section>

<style>
  .tab {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
    overflow: hidden;
  }

  .panel-tape {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 24px;
    border-right: 1px solid var(--cell-border);
    overflow: hidden;
    min-height: 0;
  }

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
    animation: enter var(--anim-belt-enter-ms) ease-out backwards;
  }

  @media (max-width: 768px) {
    .tapes-stack { --cell-h: 36px; }
  }
  @media (max-width: 480px) {
    .tapes-stack { --cell-h: 34px; }
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

  .panel-editor {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 24px;
    overflow: hidden;
    /* min-height:0 lets this flex/grid item shrink below its intrinsic
       content size (CodeMirror's full code height); without it the grid
       row stretches to fit and the editor never has internal scroll. */
    min-height: 0;
  }

  .take-control {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    gap: 6px;
    height: 30px;
    padding: 4px 12px;
    background: transparent;
    border: 1px solid rgba(95, 208, 104, 0.28);
    color: rgba(95, 208, 104, 0.7);
    border-radius: 6px;
    cursor: pointer;
    font: inherit;
    font-family: ui-monospace, 'SF Mono', Consolas, monospace;
    font-size: 13px;
    transition:
      background-color var(--anim-button-hover-ms) ease,
      border-color var(--anim-button-hover-ms) ease,
      color var(--anim-button-hover-ms) ease;
  }

  .take-control:hover {
    background: rgba(95, 208, 104, 0.14);
    border-color: var(--ok);
    color: var(--ok);
  }

  .take-control :global(svg) {
    width: 16px;
    height: 16px;
    display: block;
    flex-shrink: 0;
    opacity: 0.85;
  }

  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }

  .controls button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--cell-bg);
    border: 1px solid var(--cell-border);
    color: var(--fg);
    padding: 6px 14px;
    font: inherit;
    cursor: pointer;
    border-radius: 6px;
  }

  .controls button:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }

  .controls button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .controls button :global(svg) {
    width: 16px;
    height: 16px;
    display: block;
    flex-shrink: 0;
  }

  /* Examples dropdown — anchored to its trigger via position:relative on the
     wrapper. The button is icon-only; the menu floats below it. */
  .examples-menu {
    position: relative;
    display: inline-flex;
  }

  .controls .examples-menu .icon-only {
    padding: 6px 8px;
  }

  .dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 20;
    list-style: none;
    margin: 0;
    padding: 4px;
    min-width: 220px;
    /* Opaque: --surface-bg has alpha and would let the editor code show
       through when the dropdown overlays CodeMirror. */
    background: var(--cell-bg);
    border: 1px solid var(--surface-border, var(--cell-border));
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  }

  .dropdown li {
    list-style: none;
  }

  .dropdown button {
    display: block;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    color: var(--fg);
    padding: 6px 10px;
    font: inherit;
    font-size: 13px;
    border-radius: 4px;
    cursor: pointer;
  }

  .dropdown button:hover {
    background: rgba(110, 168, 254, 0.14);
    color: var(--accent);
  }

  .dropdown button.selected {
    color: var(--accent);
    background: rgba(110, 168, 254, 0.18);
  }

  .checkbox {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    color: var(--muted);
    cursor: pointer;
    user-select: none;
  }

  .checkbox input {
    accent-color: var(--accent);
    margin: 0;
  }

  .interval-input {
    width: 64px;
    background: var(--cell-bg);
    border: 1px solid var(--cell-border);
    color: var(--fg);
    padding: 4px 8px;
    font: inherit;
    font-size: 13px;
    border-radius: 4px;
  }

  .interval-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .interval-input.invalid {
    border-color: var(--error);
    color: var(--error);
  }

  .version {
    font-family: ui-monospace, 'SF Mono', Consolas, monospace;
    font-size: 11px;
    color: var(--muted);
    text-align: right;
    padding-top: 4px;
  }

  .editor-loading,
  .editor-error {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--cell-border);
    border-radius: 6px;
    background: var(--editor-bg);
    color: var(--muted);
    font-family: ui-monospace, 'SF Mono', Consolas, monospace;
    font-size: 13px;
  }

  .editor-error {
    color: var(--error);
  }

  /* Status: hidden on desktop (the log panel covers this); shown on mobile
     where the log panel collapses. Sits right after the controls bar so it
     reads as the result of the last action. */
  .status {
    display: none;
    font-family: ui-monospace, 'SF Mono', Consolas, monospace;
    font-size: 13px;
    color: var(--muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-height: 1.2em;
  }

  .status.error { color: var(--error); }
  .status.warn  { color: var(--warn); }
  .status.ok    { color: var(--ok); }

  @media (max-width: 768px) {
    .tab {
      grid-template-columns: 1fr;
      grid-template-rows: auto 1fr;
      overflow: visible;
    }

    .panel-tape {
      padding: 16px 16px 24px;
      border-right: none;
      border-bottom: 1px solid var(--cell-border);
    }

    .panel-editor {
      padding: 16px;
      min-height: 60vh;
    }

    .status {
      display: block;
    }

    .controls button {
      padding: 4px 10px;
      font-size: 13px;
      gap: 4px;
    }

    .controls button :global(svg) {
      width: 14px;
      height: 14px;
    }
  }
</style>
