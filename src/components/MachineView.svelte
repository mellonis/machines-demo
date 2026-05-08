<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import TapesStack from './TapesStack.svelte';
  import Toolbar from './Toolbar.svelte';
  import ControlPanel from './ControlPanel.svelte';
  import Log from './Log.svelte';
  import type { LogEntry, LogKind } from '../lib/log.ts';
  import { MachineRunner, WorkerError } from '../lib/machineRunner.ts';
  import * as turing from '@turing-machine-js/machine';
  import { VIEWPORT_WIDTH } from '../lib/caps.ts';
  import { type Alphabets, type Command, type Engine, type PausedResponse, type TapeSnapshot } from '../lib/types.ts';
  import { startDemoLoop } from '../lib/demoLoop.ts';
  import { startAutoStep, parseInterval } from '../lib/autoStep.ts';
  import { commandsEntry, tapesEntry } from '../lib/format.ts';
  import {
    defaultExample,
    examples,
    findExample,
    type Example,
  } from '../lib/defaultCode.ts';
  import {
    loadCode,
    loadExampleId,
    saveExampleId,
    loadSnippets,
    saveSnippet,
    deleteSnippet,
    renameSnippet,
    loadDebugMode,
    saveDebugMode,
    type Snippets,
  } from '../lib/persist.ts';
  import { icons } from '../lib/icons.ts';

  type Props = { engine: Engine };
  let { engine }: Props = $props();

  /* ───── constants ───── */

  const NEUTRAL_COMMAND: Command = { movement: 'S', symbol: null };

  // Length must match MAX_TAPES — worker rejects loads with more tapes.
  const CARET_COLORS: readonly string[] = [
    '#6ea8fe', // blue
    '#ff6b6b', // red
    '#5fd068', // green
    '#c084fc', // purple
    '#ffd166', // amber
  ];

  type ExecutionMode =
    | 'DEMO'
    | 'MANUAL'
    | 'RUNNING_STEP'
    | 'RUNNING_AUTO'
    | 'RUNNING_CONTINUOUS'
    | 'RUNNING_PAUSED_AT_BREAK'
    | 'HALTED';

  /* ───── state ───── */

  let executionMode = $state<ExecutionMode>('DEMO');
  let userTookControl = $state(false);
  let demoEnabled = $state(true);
  let halted = $state(false);
  let alphabets = $state<Alphabets>([]);
  let logEntries = $state<LogEntry[]>([]);
  let lastSnapshots = $state<TapeSnapshot[] | null>(null);
  let pendingOp = $state<'load' | 'run' | null>(null);
  let stepInFlight = $state(false);
  let mirrorMachine: turing.TuringMachine | null = null;
  let mirrorTapeBlock: turing.TapeBlock | null = null;
  let codeChangedWarned = false;
  let withPause = $state(false);
  let debugMode = $state<boolean>(untrack(() => loadDebugMode(engine)));

  $effect(() => {
    saveDebugMode(engine, debugMode);
  });

  let intervalText = $state('1s');
  let workerLive = $state(false);
  // engine is fixed for a MachineView instance (parent remounts on engine change
  // via {#key activeEngine}). untrack() acknowledges we want a one-time read.
  const engineExamples = untrack(() => examples(engine));
  const initialExample = untrack(() => {
    const persistedId = loadExampleId(engine);
    return (persistedId && findExample(engine, persistedId)) || defaultExample(engine);
  });
  let selectedExampleId = $state<string>(initialExample.id);
  const initialSnippets = untrack(() => loadSnippets(engine));
  let snippets = $state<Snippets>(initialSnippets);
  // Active snippet is read from the URL (`?snippet=<uuid>`) — bookmarkable,
  // shareable, and the future-#24 share key. When the URL points at a snippet
  // that exists locally, its code becomes the editor's code; otherwise we fall
  // back to localStorage and report the bad UUID once on mount.
  const initial = untrack(() => {
    const raw = new URL(window.location.href).searchParams.get('snippet');
    const urlId = raw !== null && raw !== '' ? raw : null;
    if (urlId !== null && urlId in initialSnippets) {
      return { loadedSnippetId: urlId, code: initialSnippets[urlId].code, badUrlId: null as string | null };
    }
    return {
      loadedSnippetId: null as string | null,
      code: loadCode(engine) ?? initialExample.code,
      badUrlId: urlId,
    };
  });
  let loadedSnippetId = $state<string | null>(initial.loadedSnippetId);
  let code = $state<string>(initial.code);

  const selectedExample = $derived(
    findExample(engine, selectedExampleId) ?? defaultExample(engine),
  );

  let tapesStackRef = $state<ReturnType<typeof TapesStack> | undefined>();
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
  // Skip separators — mobile status mirrors a meaningful message, not a divider.
  const latestEntry = $derived.by(() => {
    for (let i = logEntries.length - 1; i >= 0; i--) {
      if (!logEntries[i].separator) return logEntries[i];
    }
    return null;
  });

  // ControlPanel handles both single- and multi-tape via Command[]; tape
  // labels are only useful to disambiguate, so show them only when N > 1.
  const tapeCount = $derived(lastSnapshots?.length ?? 1);
  const showTapeLabels = $derived(tapeCount > 1);
  const panelEnabled = $derived(executionMode === 'MANUAL');
  const applyVisible = $derived(
    executionMode === 'DEMO' || executionMode === 'MANUAL',
  );
  const takeControlVisible = $derived(
    executionMode !== 'MANUAL' &&
    executionMode !== 'RUNNING_CONTINUOUS' &&
    executionMode !== 'RUNNING_PAUSED_AT_BREAK',
  );
  const beltTransitionsOn = $derived(
    executionMode !== 'RUNNING_CONTINUOUS' &&
    executionMode !== 'RUNNING_PAUSED_AT_BREAK',
  );

  // The code Reset would restore to: the loaded snippet's saved code, or the
  // selected bundled example's code, or null when the loaded snippet was
  // deleted (no target — Reset is hidden in that branch).
  const sourceCode = $derived.by(() => {
    if (loadedSnippetId !== null) return snippets[loadedSnippetId]?.code ?? null;
    return selectedExample.code;
  });
  const dirty = $derived(sourceCode !== null && code !== sourceCode);
  const resetVisible = $derived(dirty);
  const resetTitle = $derived(
    loadedSnippetId !== null && loadedSnippetId in snippets
      ? `Reset to "${snippets[loadedSnippetId].title}"`
      : 'Reset to selected example',
  );

  const loadDisabled = $derived(pendingOp !== null);
  // Step/Run stay enabled in HALTED — they reload-from-code on entry, which
  // also clears `halted`. Disabling would just force an extra Build click.
  const stepDisabled = $derived(
    pendingOp !== null ||
      !workerLive ||
      executionMode === 'RUNNING_CONTINUOUS',
  );
  // stepInFlight is intentionally NOT in the disabled state — the worker call
  // is fast (~ms), and we don't want the user to see flicker on rapid clicks.
  // Soft-debounced inside doStep() instead.
  const runDisabled = $derived(
    pendingOp !== null ||
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
    logEntries = [...logEntries, entry];
  }

  function appendBatch(items: LogEntry[]): void {
    if (items.length === 0) return;
    logEntries = [...logEntries, ...items];
  }

  // Visually divides log activity per session (Build / Step / Run). Skipped
  // when the log is empty so we don't open with a stranded divider.
  function reportSeparator(): void {
    if (logEntries.length === 0) return;
    logEntries = [...logEntries, { text: '', separator: true }];
  }

  function clearLog(): void {
    logEntries = [];
  }

  /* ───── side-effect handlers (one source of truth on error) ───── */

  function failHalted(err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    // Worker errored mid-step / mid-run. If it shipped a partial tape state,
    // sync the mirror + display to it so the user sees where execution stuck
    // (otherwise we'd strand them on the loaded tape).
    if (err instanceof WorkerError && err.tapes && err.tapes.length > 0) {
      lastSnapshots = err.tapes;
      _buildMirrorMachine(err.tapes, alphabets);
      setAllFromMirror();
    }
    report(`error: ${msg}`, 'error');
    halted = true;
    executionMode = 'HALTED';
  }

  /* ───── load / step / run ───── */

  function _buildMirrorMachine(tapes: TapeSnapshot[], alphabets: Alphabets): void {
    const libAlphabets = alphabets.map((syms) => new turing.Alphabet([...syms]));
    // Mirror exactly what the worker had — full `symbols` and absolute head
    // `position` — so the user can navigate beyond the initial window
    // without blanks where original symbols should be. `viewportWidth` is
    // ours to pick (the mirror is internal, no user code observes it); the
    // library pads `#symbols` via `normalise()` so `tape.viewport` returns
    // exactly that many cells.
    const libTapes = tapes.map((snap, i) => new turing.Tape({
      alphabet: libAlphabets[i],
      symbols: [...snap.symbols],
      position: snap.position,
      viewportWidth: VIEWPORT_WIDTH,
    }));
    mirrorTapeBlock = turing.TapeBlock.fromTapes(libTapes);
    mirrorMachine = new turing.TuringMachine({ tapeBlock: mirrorTapeBlock });
  }

  async function _runMirrorStep(commands: Command[]): Promise<void> {
    if (!mirrorMachine || !mirrorTapeBlock) return;
    const oneStep = new turing.State({
      [turing.ifOtherSymbol]: {
        command: commands.map((command) => ({
          symbol: command.symbol !== null ? command.symbol : turing.symbolCommands.keep,
          movement:
            command.movement === 'L' ? turing.movements.left
            : command.movement === 'R' ? turing.movements.right
            : turing.movements.stay,
        })),
        nextState: turing.haltState,
      },
    });
    await mirrorMachine.run({ initialState: oneStep });
  }

  // Push the current mirror tapes into the visible <Tape> instances. Used
  // after `_buildMirrorMachine` (Build / Run-end / error-recovery) to seed
  // the UI; does not animate.
  function setAllFromMirror(): void {
    if (!mirrorTapeBlock) return;
    mirrorTapeBlock.tapes.forEach((tape, i) => {
      tapesStackRef?.setFromTape(i, tape);
    });
  }

  // Per-step render path — used in DEMO, MANUAL Apply, and RUNNING_*
  // (except RUNNING_CONTINUOUS, which rebuilds in one shot). Advances the
  // mirror with `commands`, then has each <Tape> read its updated mirror
  // tape's `.viewport` and play the slide animation if requested.
  async function renderFromMirror(commands: Command[], animate: boolean): Promise<void> {
    if (!mirrorTapeBlock) return;
    await _runMirrorStep(commands);
    mirrorTapeBlock.tapes.forEach((tape, i) => {
      const command = commands[i];
      const delta = (command?.movement === 'L' ? -1 : command?.movement === 'R' ? 1 : 0) as -1 | 0 | 1;
      const wrote = command != null && command.symbol !== null;
      tapesStackRef?.setFromTape(i, tape, delta, animate, wrote);
    });
  }

  // Reloads the worker + rebuilds mirrorMachine. `source` defaults to the
  // current editor `code`; `doLoad` passes `selectedExample.code` instead for
  // non-user-initiated DEMO loads. Does NOT change executionMode — callers
  // own that.
  async function reloadWorker(source: string = code): Promise<boolean> {
    pendingOp = 'load';
    try {
      const res = await runner.build(source);
      workerLive = true;
      alphabets = res.alphabets;
      lastSnapshots = res.tapes;
      halted = res.halted;
      _buildMirrorMachine(res.tapes, res.alphabets);
      await tick();
      setAllFromMirror();
      return true;
    } catch (err) {
      workerLive = false;
      alphabets = [];
      tapesStackRef?.clearAll();
      lastSnapshots = null;
      halted = true;
      const msg = err instanceof Error ? err.message : String(err);
      report(`error: ${msg}`, 'error');
      return false;
    } finally {
      pendingOp = null;
    }
  }

  function stopMachine(): void {
    if (executionMode === 'RUNNING_PAUSED_AT_BREAK') {
      // Pending run Promise will reject when we terminate; failHalted in the
      // caller's catch sets the rest. We pre-empt the message here.
      runner.terminate();
      workerLive = false;
    }
    executionMode = 'HALTED';
    report('stopped', 'warn');
  }

  function reflectToActivePanel(commands: Command[] | null): void {
    if (!commands || commands.length === 0) return;
    panelRef?.reflect(commands);
  }

  function reflectNeutral(): void {
    const neutrals = Array.from({ length: tapeCount }, () => ({ ...NEUTRAL_COMMAND }));
    panelRef?.reflect(neutrals);
  }

  async function doLoad({ userInitiated = false } = {}): Promise<void> {
    if (userInitiated) demoEnabled = false;
    reportSeparator();
    report(userInitiated ? 'loading…' : 'demo machine is loading…');

    // For DEMO (initial / non-user load), always run the canonical example —
    // user's persisted edits in the editor may be incomplete or broken; the
    // demo should always show a working machine. Build button uses live code.
    const source = userInitiated ? code : selectedExample.code;
    const ok = await reloadWorker(source);

    executionMode = userTookControl ? 'MANUAL' : 'DEMO';

    if (!ok) return;

    // Tape refs are bound by {#each tapes}: wait one tick for new
    // <Tape> instances to mount before reflecting panel state.
    appendBatch(tapesEntry(lastSnapshots!, alphabets, CARET_COLORS));
    report(halted ? 'loaded — halted immediately' : 'loaded — ready', 'ok');
    await tick();
    if (userTookControl) reflectNeutral();
  }

  async function doStep(): Promise<void> {
    // RUNNING_PAUSED_AT_BREAK → Step click means "advance one iteration in the
    // run, then re-pause". Send resume with step flag; worker will arm the
    // nextState.debug trick.
    if (executionMode === 'RUNNING_PAUSED_AT_BREAK') {
      runner.resume(true);
      // Phase will be set by the next `paused` (or `ran` if the synthesized
      // step happens to land on halt).
      return;
    }

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

    // First step from any non-RUNNING_STEP mode (DEMO / MANUAL / HALTED):
    // reload so mirrorMachine and worker start from the current code (user
    // may have edited it; HALTED entry effectively restarts the machine).
    if (executionMode !== 'RUNNING_STEP') {
      reportSeparator();
      report('loading…');
      const ok = await reloadWorker();
      if (!ok) {
        executionMode = userTookControl ? 'MANUAL' : 'DEMO';
        return;
      }
      executionMode = 'RUNNING_STEP';
      codeChangedWarned = false;
      reflectNeutral();
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
    halted = res.halted;
    if (res.halted) {
      report(`halted after ${res.stepsApplied} step(s)`, 'ok');
      executionMode = 'HALTED';
    } else {
      report(commandsEntry(res.commands, { stepNumber: res.stepsApplied }, CARET_COLORS));
    }
    if (res.commands) {
      await renderFromMirror(res.commands, true);
      // Show what's queued for the *next* click, not what just applied.
      // Keeps panel state consistent under rapid clicks.
      if (res.nextCommands) reflectToActivePanel(res.nextCommands);
      else reflectNeutral();
    }
  }

  function onPausedHandler(paused: PausedResponse): void {
    // Replay buffered per-step commands so the trace leading to the break is visible.
    if (paused.commands.length > 0) {
      const startStep = paused.stepsApplied - paused.commands.length;
      appendBatch(
        paused.commands.map((commands, i) =>
          commandsEntry(commands, { stepNumber: startStep + i + 1 }, CARET_COLORS),
        ),
      );
    }
    // Snap mirror to break-time tapes (no animation).
    lastSnapshots = paused.tapes;
    _buildMirrorMachine(paused.tapes, alphabets);
    setAllFromMirror();
    // Format the break log entry. Engine's run() dispatches onDebugBreak
    // separately for before/after — exactly one is true at the wire.
    const kind = paused.debugBreak.before ? 'before' : 'after';
    const symbols = paused.currentSymbols.join(' ');
    report(`paused at ${paused.state || '(unnamed)'} [${kind}]: ${symbols}`, 'ok');
    executionMode = 'RUNNING_PAUSED_AT_BREAK';
  }

  async function doRun(): Promise<void> {
    // RUNNING_PAUSED_AT_BREAK → treat Run click as Continue.
    if (executionMode === 'RUNNING_PAUSED_AT_BREAK') {
      runner.resume(false);
      executionMode = 'RUNNING_CONTINUOUS';
      return;
    }

    if (withPause) {
      // Resume auto-stepping from current RUNNING_STEP position without reload.
      if (executionMode !== 'RUNNING_STEP') {
        reportSeparator();
        report('loading…');
        const ok = await reloadWorker();
        if (!ok) {
          executionMode = userTookControl ? 'MANUAL' : 'DEMO';
          return;
        }
      }
      executionMode = 'RUNNING_AUTO';
      codeChangedWarned = false;
      report(`auto-stepping every ${intervalMs}ms`);
      return;
    }

    reportSeparator();
    report('loading…');
    const ok = await reloadWorker();
    if (!ok) {
      executionMode = userTookControl ? 'MANUAL' : 'DEMO';
      return;
    }
    reflectNeutral();
    executionMode = 'RUNNING_CONTINUOUS';
    report('running…');
    pendingOp = 'run';
    try {
      const res = await runner.run({
        maxSteps: undefined,
        debug: debugMode,
        onPaused: (paused) => onPausedHandler(paused),
      });
      lastSnapshots = res.tapes;
      _buildMirrorMachine(res.tapes, alphabets);
      setAllFromMirror();
      halted = true;
      reflectNeutral();
      if (res.commands.length > 0) {
        appendBatch(
          res.commands.map((commands, i) =>
            commandsEntry(commands, { stepNumber: res.startStep + i + 1 }, CARET_COLORS),
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
    reflectNeutral();
  }

  async function onApply(commands: Command[]): Promise<void> {
    await renderFromMirror(commands, true);
    report(commandsEntry(commands, 'applied', CARET_COLORS));
  }

  function resetCodeToSelected(): void {
    if (loadedSnippetId !== null) {
      const snippet = snippets[loadedSnippetId];
      if (snippet) code = snippet.code;
      return;
    }
    code = selectedExample.code;
  }

  function pickExample(ex: Example): void {
    selectedExampleId = ex.id;
    code = ex.code;
    loadedSnippetId = null;
  }

  function onSaveSnippet(title: string): void {
    const { id, snippet } = saveSnippet(engine, title, code);
    snippets = { ...snippets, [id]: snippet };
    loadedSnippetId = id;
  }

  function onSaveChanges(): void {
    if (loadedSnippetId === null) return;
    const existing = snippets[loadedSnippetId];
    if (!existing) return;
    const { id, snippet } = saveSnippet(engine, existing.title, code);
    snippets = { ...snippets, [id]: snippet };
    report(`saved "${existing.title}"`, 'ok');
  }

  function onLoadSnippet(id: string): void {
    const snippet = snippets[id];
    if (snippet) {
      code = snippet.code;
      loadedSnippetId = id;
    }
  }

  function onDeleteSnippet(id: string): void {
    deleteSnippet(engine, id);
    const { [id]: _, ...rest } = snippets;
    snippets = rest;
    // Keep loadedSnippetId set so `resetVisible` hides the reset button when
    // the snippet is gone — otherwise reset would silently jump to the
    // bundled example.
  }

  function onRenameSnippet(id: string, newTitle: string): void {
    const updated = renameSnippet(engine, id, newTitle);
    if (!updated) return;
    // On collision renameSnippet deletes the conflicting entry; rebuild the
    // full map from localStorage so we don't have to replicate the logic here.
    snippets = { ...loadSnippets(engine) };
  }

  // Persist the selected example id (separate from the editor code) so the
  // reset button keeps targeting the chosen source across reloads.
  $effect(() => {
    saveExampleId(engine, selectedExampleId);
  });

  $effect(() => {
    const url = new URL(window.location.href);
    if (loadedSnippetId !== null) url.searchParams.set('snippet', loadedSnippetId);
    else url.searchParams.delete('snippet');
    history.replaceState(null, '', url);
  });

  /* ───── effects ─────
   * Demo loop, auto-step loop, and belt-transitions all derive from state.
   */

  // DEMO loop is array-shape for both engines now (Post is length-1, Turing
  // length-N). Drives ControlPanel.reflect / .flashApply uniformly.
  $effect(() => {
    if (executionMode !== 'DEMO' || !demoEnabled) return;
    return startDemoLoop({
      reflect: (commands) => panelRef?.reflect(commands),
      apply: (commands) => {
        panelRef?.flashApply();
        void renderFromMirror(commands, true);
      },
      getAlphabets: () => alphabets,
    });
  });

  $effect(() => {
    if (executionMode === 'RUNNING_AUTO' && intervalMs !== null) {
      return startAutoStep(intervalMs, async () => {
        try {
          const res = await runner.step();
          halted = res.halted;
          if (executionMode !== 'RUNNING_AUTO') return;
          if (res.commands) {
            reflectToActivePanel(res.commands);
            await renderFromMirror(res.commands, true);
          }
          if (res.halted) {
            report(`halted after ${res.stepsApplied} step(s)`, 'ok');
            executionMode = 'HALTED';
          } else {
            report(commandsEntry(res.commands, { stepNumber: res.stepsApplied }, CARET_COLORS));
          }
        } catch (err) {
          failHalted(err);
        }
      });
    }
  });

  $effect(() => {
    tapesStackRef?.setTransitionsEnabled(beltTransitionsOn);
  });

  $effect(() => {
    void code;  // subscribe; value unused (read happens via untrack below)
    untrack(() => {
      if (executionMode === 'RUNNING_STEP' || executionMode === 'RUNNING_AUTO') {
        if (!codeChangedWarned) {
          codeChangedWarned = true;
          report('code changed — current execution continues from loaded state', 'warn');
        }
      }
    });
  });

  /* ───── lifecycle ───── */

  onMount(() => {
    if (initial.badUrlId !== null) report(`snippet not found: ${initial.badUrlId}`, 'error');
    void doLoad();
  });

  onDestroy(() => {
    runner.terminate();
  });
</script>

<section class="tab">
  <div class="panel-tape">
    <TapesStack bind:this={tapesStackRef} {tapeCount} caretColors={CARET_COLORS} />

    <div class="panel-enter-clip">
      <ControlPanel
        bind:this={panelRef}
        {alphabets}
        enabled={panelEnabled}
        {applyVisible}
        {showTapeLabels}
        caretColors={CARET_COLORS}
        {onApply}
      />
    </div>

    {#if takeControlVisible}
      <button class="take-control" type="button" onclick={takeControl}>
        {@html icons.takeControl}
        <span class="btn-label">Take control</span>
      </button>
    {/if}

    <Log entries={logEntries} onClear={clearLog} />
  </div>

  <div class="panel-editor">
    <Toolbar
      {executionMode}
      {loadDisabled}
      {stepDisabled}
      {runDisabled}
      {intervalIsValid}
      examples={engineExamples}
      {selectedExampleId}
      bind:withPause
      bind:debugMode
      bind:intervalText
      onBuild={() => doLoad({ userInitiated: true })}
      onStep={doStep}
      onRun={doRun}
      onStop={stopMachine}
      onPickExample={pickExample}
      {snippets}
      {loadedSnippetId}
      {dirty}
      {onSaveSnippet}
      {onSaveChanges}
      {onLoadSnippet}
      {onDeleteSnippet}
      {onRenameSnippet}
    />
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
      <Editor {engine} bind:code onReset={resetCodeToSelected} {resetVisible} {resetTitle} />
    {:catch err}
      <div class="editor-error">Failed to load editor: {err.message}</div>
    {/await}
  </div>
</section>

<style>
  .tab {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr;
    gap: 0;
    overflow: hidden;

    @media (max-width: 768px) {
      grid-template-columns: 1fr;
      grid-template-rows: auto 1fr;
      overflow: visible;
    }
  }

  .panel-tape {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 24px;
    border-right: 1px solid var(--cell-border);
    overflow: hidden;
    min-height: 0;

    @media (max-width: 768px) {
      padding: 16px 16px 24px;
      border-right: none;
      border-bottom: 1px solid var(--cell-border);
    }
  }

  /* Clips the control-panel's enter animation so translateY(20px) can't
     visually spill into the Take Control button's space below. */
  .panel-enter-clip {
    overflow: hidden;
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

    @media (max-width: 768px) {
      padding: 16px;
      min-height: 60vh;
    }
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
    border: 1px solid color-mix(in srgb, var(--ok) 28%, transparent);
    color: color-mix(in srgb, var(--ok) 70%, transparent);
    border-radius: 6px;
    cursor: pointer;
    font: inherit;
    font-family: ui-monospace, 'SF Mono', Consolas, monospace;
    font-size: 13px;
    transition:
      background-color var(--anim-button-hover-ms) ease,
      border-color var(--anim-button-hover-ms) ease,
      color var(--anim-button-hover-ms) ease;

    &:hover {
      background: color-mix(in srgb, var(--ok) 14%, transparent);
      border-color: var(--ok);
      color: var(--ok);
    }

    :global(svg) {
      width: 16px;
      height: 16px;
      display: block;
      flex-shrink: 0;
      opacity: 0.85;
    }
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

    &.error { color: var(--error); }
    &.warn  { color: var(--warn); }
    &.ok    { color: var(--ok); }

    @media (max-width: 768px) {
      display: block;
    }
  }
</style>
