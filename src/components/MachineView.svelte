<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { SvelteMap, SvelteSet } from 'svelte/reactivity';
  import TapesStack from './TapesStack.svelte';
  import Toolbar from './Toolbar.svelte';
  import ControlPanel from './ControlPanel.svelte';
  import Log from './Log.svelte';
  import MachineGraph from './MachineGraph.svelte';
  import { LogStore } from '../lib/logStore.svelte.ts';
  import MachineWorker from '../lib/machineWorker.ts?worker';
  import { MachineRunner, WorkerError } from '../lib/machineRunner.ts';
  import * as turing from '@turing-machine-js/machine';
  import { BELT_ANIMATION_MIN_INTERVAL_MS, MAX_TAPES, VIEWPORT_WIDTH } from '../lib/caps.ts';
  import { type Alphabets, type BreakpointKind, type Command, type Engine, type GraphHighlight, type IdleResponse, type PausedResponse, type TapeSnapshot, type TuringGraph } from '../lib/types.ts';
  import { startDemoLoop } from '../lib/demoLoop.ts';
  import { parseInterval } from '../lib/interval.ts';
  import { bareIdOf } from '../lib/graphUtils.ts';
  import { deriveGraphHighlight } from '../lib/graphHighlightDerivation.ts';
  import { parse as parseSnapshot, serialize as serializeSnapshot } from '../lib/tapeSnapshot.ts';
  import { commandsEntry, tapesEntry } from '../lib/format.ts';
  import { formatPauseLine } from '../lib/pauseLineFormat.ts';
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
    loadGraphCollapsed,
    saveGraphCollapsed,
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
    | 'RUNNING_AUTO'
    | 'RUNNING_CONTINUOUS'
    | 'RUNNING_PAUSED'
    | 'HALTED';

  /* ───── state ───── */

  let executionMode = $state<ExecutionMode>('DEMO');
  let userTookControl = $state(false);
  let demoEnabled = $state(true);
  let halted = $state(false);
  let alphabets = $state<Alphabets>([]);
  const log = new LogStore();
  let lastSnapshots = $state<TapeSnapshot[] | null>(null);
  // State-graph panel (machines-demo#9). `graph` is the engine-v7 Graph
  // snapshot captured at Build via State.toGraph; null pre-Build.
  // `graphCollapsed` defaults to "open on desktop, closed on mobile" per
  // the issue's UX note; `graphModalOpen` drives the expand-to-modal view.
  let graph = $state<TuringGraph | null>(null);
  let graphCollapsed = $state(untrack(() => initialGraphCollapsed(engine)));
  let graphModalOpen = $state(false);
  // Monotonic iter counter, mirrored from worker responses (idle / paused /
  // ran). Passed to MachineGraph purely as a reactivity tick: when two
  // consecutive paused events have identical currentStateId / nextStateId /
  // pauseBefore (e.g. Copy-tape step-mode looping on id:1), graphHighlight's
  // $derived wouldn't re-run and MachineGraph's highlight effect wouldn't
  // re-fire — so the pulse animation would never restart. Bumping this
  // forces the effect to re-fire per event.
  let stepsApplied = $state(0);

  // machines-demo#37 — per-state breakpoint kinds, keyed by canonical
  // bare id (wrapper and bare share `#debugRef` engine-side; they're one
  // breakpoint from the user's POV — see `bareIdOf`). Each entry is the
  // current `{ before, after }` state for that equivalence class.
  // Populated reactively by the worker's `breakpointToggled` echo
  // (installed via runner.onBreakpointToggled below). Entries with both
  // kinds off are pruned. Cleared on Build (a fresh worker means fresh
  // State instances). SvelteMap so reads in MachineGraph's indicator and
  // context-menu effects update the rendered SVG without a manual
  // reactivity tick.
  const breakpoints = new SvelteMap<number, { before: boolean; after: boolean }>();
  // Derived: the set of bare ids that have ANY kind set. Consumed by the
  // indicator pass (which doesn't care about kinds — just "is BP active").
  // The per-kind Map drives the context menu's checkmarks.
  const breakpointIndicatorSet = $derived.by(() => {
    const s = new SvelteSet<number>();
    for (const [id, kinds] of breakpoints) {
      if (kinds.before || kinds.after) s.add(id);
    }
    return s;
  });

  // Persist the user's expand/collapse choice per engine. Skip the initial
  // value (it already came from localStorage or the viewport default) so we
  // don't write back the default the first time around — useful when the
  // user has nothing saved yet and we'd otherwise pin them to whichever
  // viewport they happened to load on.
  $effect(() => {
    saveGraphCollapsed(engine, graphCollapsed);
  });
  // Highlight state (#10). Carried through from the paused response:
  //   - `prevStateId` is the state we just left (= FROM of the just-fired
  //     transition that brought us to `currentStateId`). Null only at the
  //     very first iter's before-pause; treated as the synthetic `idle`
  //     sentinel in the highlight derivation.
  //   - `currentStateId` is m.state at pause (the "you are here" anchor).
  //   - `nextStateId` is m.state.getNextState(symbol) — the state the
  //     ABOUT-TO-FIRE transition would land on. Used for after / iter-end
  //     pauses where the just-fired transition is current → next.
  //   - `pauseBefore` selects which triple is the just-fired one:
  //       before → (prev, current); after / iter-end → (current, next).
  let prevStateId = $state<number | null>(null);
  let currentStateId = $state<number | null>(null);
  let nextStateId = $state<number | null>(null);
  let pauseBefore = $state(false);
  let pendingOp = $state<'load' | 'run' | null>(null);
  let mirrorMachine: turing.TuringMachine | null = null;
  let mirrorTapeBlock: turing.TapeBlock | null = null;
  let codeChangedWarned = false;
  let stopRequested = $state(false);
  let withPause = $state(false);
  let debugMode = $state<boolean>(untrack(() => loadDebugMode(engine)));

  $effect(() => {
    saveDebugMode(engine, debugMode);
  });

  // Push the checkbox state to the worker whenever it changes (or after a
  // fresh build sets workerLive). Lets the user toggle debug mid-run — the
  // worker re-checks debugEnabled at every break instead of capturing the
  // value at run-start.
  $effect(() => {
    if (workerLive) runner.setDebug(debugMode);
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

  const runner = new MachineRunner(untrack(() => engine), () => new MachineWorker());

  // machines-demo#37 — install the breakpoint-echo callback once at runner
  // construction. The worker emits `breakpointToggled` after each
  // toggleBreakpoint mutation (with the same `kind`); the UI updates its
  // per-state Map in lockstep so context-menu checkmarks feel synchronous
  // despite the worker round-trip.
  //
  // Canonicalize the echoed `stateId` to the bare's id — wrappers and
  // bares share `#debugRef` engine-side, so they're a single breakpoint
  // class. The Map stores one entry per class; the indicator expands to
  // all members at render time. Without canonicalization, replay-after-
  // build would double-toggle the shared ref. Entries with both kinds
  // off are pruned so `breakpointIndicatorSet` stays minimal.
  // Surface worker-side errors that have no pending request to reject —
  // toggleBreakpoint / setDebug / pause throw silently otherwise. Same
  // formatting as the regular `failHalted` error path so users see one
  // consistent style in the log.
  runner.onUncorrelatedError = (msg) => log.report(`error: ${msg}`, 'error');

  runner.onBreakpointToggled = (data) => {
    const id = bareIdOf(data.stateId, graph);
    const current = breakpoints.get(id) ?? { before: false, after: false };
    const next = { ...current, [data.kind]: data.value === 'on' };
    if (!next.before && !next.after) {
      breakpoints.delete(id);
    } else {
      breakpoints.set(id, next);
    }
  };

  /* ───── derived ─────
   * Single source of truth for button-disabled state and panel visibility.
   * Every UI flag derives from (executionMode, halted, workerLive, pendingOp)
   * — no per-handler bespoke resets, no manual mode-switch tables.
   */

  const intervalMs = $derived(parseInterval(intervalText));
  const intervalIsValid = $derived(intervalMs !== null);
  // Mobile status mirrors the latest non-separator entry. Provided by LogStore;
  // it walks the buffer (not the throttled view) so mobile stays in sync with
  // `report()` calls without a 16ms timer lag.
  const latestEntry = $derived(log.latest);

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
    executionMode !== 'RUNNING_PAUSED',
  );
  const pasteEnabled = $derived(
    executionMode === 'MANUAL' || executionMode === 'DEMO',
  );
  const beltTransitionsOn = $derived(
    executionMode !== 'RUNNING_CONTINUOUS' &&
    executionMode !== 'RUNNING_PAUSED',
  );

  // State-graph highlight (#10): mirrors the LAST FIRED transition (so the
  // graph stays in lockstep with the most recent log entry). Strong on
  // m.state in all cases — "you are here".
  //
  // RUNNING_PAUSED:
  //   before pause at X (came from Y):
  //       triple = (Y, edge, X), strong on TO (= X = m.state)
  //   after / iter-end pause at X (next will be Z):
  //       triple = (X, edge, Z), strong on FROM (= X = m.state)
  //   First iter's before pause has no prior state — `prevStateId` is null;
  //   we use the synthetic `idle` sentinel as FROM (matches the idle-enter
  //   arrow in the rendered graph, so the "transition that brought us
  //   here" is the start-arrow itself).
  //
  // RUNNING_AUTO (driven by `idle` per-iter notifications):
  //   triple = (currentStateId, edge, nextStateId), strong on FROM —
  //   identical shape to the after/iter-end pause case (the iter just
  //   ran; we're between iters). Update cadence equals the user's
  //   `intervalMs`; strobe risk is the user's knob to manage.
  //
  // Other modes return null:
  //  - DEMO/MANUAL: no truth value (random / user-chosen commands).
  //  - RUNNING_CONTINUOUS: no per-iter signal (worker doesn't send `idle`).
  //  - HALTED: follow-up sub-branch (highlight last edge + halt node).
  const graphHighlight = $derived<GraphHighlight | null>(deriveGraphHighlight({
    graph, executionMode, currentStateId, nextStateId, prevStateId, pauseBefore,
  }));

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

  // Build is disabled whenever an op is in flight, including RUNNING_PAUSED:
  // clicking Build from a paused state would terminate the worker mid-run,
  // discard the paused machine state, and reload from code — destructive and
  // surprising. The user must Stop first to get a clean cold-start surface.
  const loadDisabled = $derived(pendingOp !== null);
  // Step/Run stay enabled in HALTED — they reload-from-code on entry, which
  // also clears `halted`. Disabling would just force an extra Build click.
  // RUNNING_AUTO is also allowed: the Step button doubles as Pause and must
  // be clickable to cancel the throttle. RUNNING_CONTINUOUS is the only
  // running mode that disables the button (no per-iter checkpoint).
  const stepDisabled = $derived(
    (pendingOp !== null &&
      executionMode !== 'RUNNING_PAUSED' &&
      executionMode !== 'RUNNING_AUTO') ||
      !workerLive ||
      executionMode === 'RUNNING_CONTINUOUS',
  );
  const runDisabled = $derived(
    (pendingOp !== null && executionMode !== 'RUNNING_PAUSED') ||
      !workerLive ||
      executionMode === 'RUNNING_AUTO' ||
      executionMode === 'RUNNING_CONTINUOUS' ||
      (withPause && !intervalIsValid),
  );
  /* ───── log helpers ───── */
  /* See LogStore (lib/logStore.svelte.ts) — methods live there. */

  /* ───── side-effect handlers (one source of truth on error) ───── */

  // Initial state-graph collapse policy: prefer the user's persisted choice
  // (per engine), else fall back to viewport-derived default — open on
  // desktop (>=720px viewport), closed on mobile so the panel doesn't
  // push the editor below the fold on first view. SSR-safe: defaults to
  // open if `matchMedia` is unavailable.
  function initialGraphCollapsed(engine: Engine): boolean {
    const persisted = loadGraphCollapsed(engine);
    if (persisted !== null) return persisted;
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia('(max-width: 719px)').matches;
  }

  function failHalted(err: unknown): void {
    if (stopRequested) {
      stopRequested = false;
      return;
    }
    const msg = err instanceof Error ? err.message : String(err);
    // Worker errored mid-step / mid-run. If it shipped a partial tape state,
    // sync the mirror + display to it so the user sees where execution stuck
    // (otherwise we'd strand them on the loaded tape).
    if (err instanceof WorkerError && err.tapes && err.tapes.length > 0) {
      // Queue mirror rebuild behind any in-flight RUNNING_AUTO render chain so
      // the partial tape state lands after the last animated iter — otherwise
      // a stale render could overwrite the error snap.
      const tapesAtError = err.tapes;
      renderChain = renderChain.then(() => {
        lastSnapshots = tapesAtError;
        _buildMirrorMachine(tapesAtError, alphabets);
        setAllFromMirror();
      });
    }
    log.report(`error: ${msg}`, 'error');
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

  // RUNNING_AUTO renders one iter per worker `idle`; consecutive idles can
  // arrive faster than `_runMirrorStep` can finish at low intervals (the
  // mirror locks the tapeBlock during `mirrorMachine.run()` and would throw
  // "Lock check failed" on concurrent calls). Serialize through a chained
  // Promise so the cadence stays correct even at 80ms.
  let renderChain: Promise<void> = Promise.resolve();

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
      graph = res.graph;
      stepsApplied = 0;
      _buildMirrorMachine(res.tapes, res.alphabets);
      await tick();
      setAllFromMirror();
      // Breakpoints are user intent (instrumentation), not run state — survive
      // worker rebuilds. Prune ids that don't exist in the new graph (user
      // edited code; some states gone), then replay surviving kinds onto the
      // fresh worker. Each toggle flips off→on (fresh States have no debug
      // set), so we issue one `toggleBreakpoint` per stored kind per class.
      for (const id of [...breakpoints.keys()]) {
        if (!res.graph.nodes[id]) breakpoints.delete(id);
      }
      for (const [id, kinds] of breakpoints) {
        if (kinds.before) runner.toggleBreakpoint(id, 'before');
        if (kinds.after) runner.toggleBreakpoint(id, 'after');
      }
      return true;
    } catch (err) {
      workerLive = false;
      alphabets = [];
      tapesStackRef?.clearAll();
      lastSnapshots = null;
      halted = true;
      graph = null;
      // Build failed → no graph to replay against. Drop the set so the next
      // successful build starts clean (user can re-set after fixing code).
      breakpoints.clear();
      const msg = err instanceof Error ? err.message : String(err);
      log.report(`error: ${msg}`, 'error');
      return false;
    } finally {
      pendingOp = null;
    }
  }

  // machines-demo#37 — toggle a state-level breakpoint (kind: 'before' or
  // 'after') by engine `GraphNode.id`. Fire-and-forget; the worker echoes
  // a `breakpointToggled` response which updates the `breakpoints` Map via
  // the runner.onBreakpointToggled hook above. Invoked from MachineGraph's
  // right-click context menu (per-kind menu items).
  //
  // Halt-marker normalization: halt markers (negative ids) are
  // per-frame visualization sentinels that all collapse to the haltState
  // singleton (id 0) at runtime. The worker's `collectStates` doesn't
  // include negative ids — it only has the singleton at 0. So we
  // normalize before sending; the echo comes back keyed at 0, and
  // `bareIdOf` (also maps negative → 0) keeps the indicator consistent.
  function onToggleBreakpoint(stateId: number, kind: BreakpointKind): void {
    if (!workerLive) return;
    const targetId = stateId < 0 ? 0 : stateId;
    runner.toggleBreakpoint(targetId, kind);
  }

  function stopMachine(): void {
    if (
      executionMode === 'RUNNING_PAUSED' ||
      executionMode === 'RUNNING_AUTO' ||
      executionMode === 'RUNNING_CONTINUOUS'
    ) {
      // Pending run Promise will reject when we terminate; failHalted in the
      // caller's catch is suppressed via stopRequested. We don't clear
      // workerLive — Run/Step from HALTED reload-from-code (same as halt-via-
      // completion), so the UI gate stays open and the next click respawns.
      stopRequested = true;
      runner.terminate();
    }
    executionMode = 'HALTED';
    log.report('stopped', 'warn');
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
    log.reportSeparator();
    log.report(userInitiated ? 'loading…' : 'demo machine is loading…');

    // For DEMO (initial / non-user load), always run the canonical example —
    // user's persisted edits in the editor may be incomplete or broken; the
    // demo should always show a working machine. Build button uses live code.
    const source = userInitiated ? code : selectedExample.code;
    const ok = await reloadWorker(source);

    executionMode = userTookControl ? 'MANUAL' : 'DEMO';

    if (!ok) return;

    // Tape refs are bound by {#each tapes}: wait one tick for new
    // <Tape> instances to mount before reflecting panel state.
    log.appendBatch(tapesEntry(lastSnapshots!, alphabets, CARET_COLORS));
    log.report(halted ? 'loaded — halted immediately' : 'loaded — ready', 'ok');
    await tick();
    if (userTookControl) reflectNeutral();
  }

  async function doStep(): Promise<void> {
    // RUNNING_PAUSED → Step click means "advance one iteration in the
    // run, then re-pause". Send resume with step flag; worker arms next
    // state's debug.after (for an engine-fired pause) or just unblocks one
    // iter (for a click-pause synthetic). Preserve the throttle on Step:
    // a Step within RUNNING_AUTO's pause cycle shouldn't reset to continuous.
    if (executionMode === 'RUNNING_PAUSED') {
      runner.resume(true, withPause ? (intervalMs ?? null) : null);
      // Phase will be set by the next `paused` (or `ran` if the synthesized
      // step happens to land on halt).
      return;
    }

    // Step button doubles as "Pause" while RUNNING_AUTO — send a click-pause
    // to the worker; the next onStep dispatches a synthetic `paused` which
    // routes through onPausedHandler.
    if (executionMode === 'RUNNING_AUTO') {
      runner.pause();
      return;
    }

    // Cold-start Step (DEMO / MANUAL / HALTED): reload + run-mode with step:true.
    // Worker arms the initial state's debug.after so iter 1's after-fire is
    // the step boundary; user-authored state.debug.before still fires naturally.
    // onPausedHandler takes over; subsequent Step clicks resume(step: true).
    log.reportSeparator();
    log.report('loading…');
    const ok = await reloadWorker();
    if (!ok) {
      executionMode = userTookControl ? 'MANUAL' : 'DEMO';
      return;
    }
    if (halted) {
      log.report('halted immediately', 'ok');
      executionMode = 'HALTED';
      return;
    }
    codeChangedWarned = false;
    reflectNeutral();
    log.report('running step by step…');

    pendingOp = 'run';
    try {
      const res = await runner.run({
        maxSteps: undefined,
        debug: debugMode,
        step: true,
        onPaused: onPausedHandler,
        // Same run Promise survives Continue → if withPause is on at that
        // click, the worker switches to throttled mode and emits per-iter
        // `idle` messages. Without onIter wired here, those commands would
        // drop on the floor and the tape wouldn't animate until halt.
        onIter: onIterHandler,
      });
      // Reached only when the run halts without pausing — e.g. Continue from
      // a paused state, or the armed break never fires before halt. Mirror
      // the doRun completion path.
      lastSnapshots = res.tapes;
      _buildMirrorMachine(res.tapes, alphabets);
      setAllFromMirror();
      halted = true;
      stepsApplied = res.stepsApplied;
      reflectNeutral();
      if (res.commands.length > 0) {
        log.appendBatch(
          res.commands.map((commands, i) =>
            commandsEntry(
              res.reads[i] ?? null,
              commands,
              alphabets,
              { stepNumber: res.startStep + i + 1 },
              CARET_COLORS,
              res.matchKinds[i] ?? null,
            ),
          ),
        );
      }
      if (res.truncated) {
        log.report(`truncated at ${res.stepsApplied} steps (limit hit)`, 'warn');
      } else {
        log.report(`halted after ${res.stepsApplied} step(s)`, 'ok');
      }
      executionMode = 'HALTED';
    } catch (err) {
      failHalted(err);
    } finally {
      pendingOp = null;
    }
  }

  // RUNNING_AUTO per-iter handler — fires on every worker `idle`. Renders the
  // belt + reflects the panel + logs, mirroring what the old `runner.step()`-
  // driven auto-step loop did per tick. Animation is skipped when intervalMs
  // is below the belt-slide duration so animations don't queue up (they'd
  // start and never settle before the next iter snaps them).
  function onIterHandler(data: IdleResponse): void {
    const animate =
      intervalMs !== null && intervalMs >= BELT_ANIMATION_MIN_INTERVAL_MS;
    const startStep = data.stepsApplied - data.commands.length;
    for (let i = 0; i < data.commands.length; i++) {
      const commands = data.commands[i];
      const reads = data.reads[i] ?? null;
      const matchKinds = data.matchKinds[i] ?? null;
      reflectToActivePanel(commands);
      log.report(
        commandsEntry(reads, commands, alphabets, { stepNumber: startStep + i + 1 }, CARET_COLORS, matchKinds),
      );
      renderChain = renderChain.then(() => renderFromMirror(commands, animate));
    }
    // Drive the per-iter graph highlight (#10). Iter-end semantics: we
    // just landed in `currentStateId`, and `nextStateId` is where the
    // next iter would go. The RUNNING_AUTO branch of `graphHighlight`
    // reads these without touching `pauseBefore`.
    currentStateId = data.currentStateId;
    nextStateId = data.nextStateId;
    stepsApplied = data.stepsApplied;
  }

  function onPausedHandler(paused: PausedResponse): void {
    // Highlight (#10): capture prev / current / next so the graph can light
    // up the JUST-FIRED transition triple (matching the last logged step).
    // `pauseBefore` selects which triple to use — see graphHighlight derived.
    prevStateId = paused.prevStateId;
    currentStateId = paused.currentStateId;
    nextStateId = paused.nextStateId;
    pauseBefore = paused.debugBreak.before === true;
    stepsApplied = paused.stepsApplied;

    // Replay buffered per-step commands so the trace leading to the break is
    // visible. In RUNNING_AUTO the buffer is drained per iter via `idle` and
    // this batch is normally empty; cold-start Step / RUNNING_CONTINUOUS use
    // the buffer as they have no idle channel.
    if (paused.commands.length > 0) {
      const startStep = paused.stepsApplied - paused.commands.length;
      log.appendBatch(
        paused.commands.map((commands, i) =>
          commandsEntry(
            paused.reads[i] ?? null,
            commands,
            alphabets,
            { stepNumber: startStep + i + 1 },
            CARET_COLORS,
            paused.matchKinds[i] ?? null,
          ),
        ),
      );
    }
    // Snap mirror to break-time tapes (no animation). RUNNING_AUTO has a
    // render chain in flight that may still be advancing the mirror for the
    // last few iters; queue the rebuild behind it so the snap is the final
    // word, not a midway state that gets overwritten by a stale render.
    const tapesAtBreak = paused.tapes;
    renderChain = renderChain.then(() => {
      lastSnapshots = tapesAtBreak;
      _buildMirrorMachine(tapesAtBreak, alphabets);
      setAllFromMirror();
    });
    // Always log the full break-state description. Reads as "we made a step,
    // here's the result": after-arming means iter K just ran, and the pause
    // surfaces iter K's state and just-executed symbols. (debug toggle gates
    // whether user-authored breaks fire, not how pauses are logged.)
    //
    // Halt-bound "before" pauses get a different wording because the BP that
    // armed them was almost certainly on haltState, and "paused at writeMarker
    // before applying command" disconnects from the user's mental model
    // ("I clicked BP on halt — why writeMarker?"). The yielded `nextStateId`
    // for a before-pause whose source's transition resolves to the real halt
    // singleton is 0; for in-frame halts the engine pre-pops to the wrapper's
    // continuation, so nextStateId points there instead — i.e., this check
    // only triggers on the *terminal* halt-bound iter.
    // Pure formatter extracted to lib/pauseLineFormat — see that module for
    // the three branching cases (halt-imminent / before / after). Keeping
    // the wording logic out of MachineView lets the scenario test harness
    // assert log lines without standing up the Svelte component. Pass
    // per-tape blank symbols so the before-pause read rendering uses the
    // same `B`/`'X'` convention as the step-log line above it.
    const blanks = alphabets.map((a) => a[0] ?? '');
    log.report(formatPauseLine(paused, blanks), 'pause');
    executionMode = 'RUNNING_PAUSED';
  }

  async function doRun(): Promise<void> {
    // RUNNING_PAUSED → treat Run click as Continue. Convey the *current*
    // withPause to the worker (spec §3 reads it at click time, not run-start),
    // so toggling withPause between pause and Continue actually changes mode.
    if (executionMode === 'RUNNING_PAUSED') {
      runner.resume(false, withPause ? (intervalMs ?? null) : null);
      executionMode = withPause ? 'RUNNING_AUTO' : 'RUNNING_CONTINUOUS';
      return;
    }

    log.reportSeparator();
    log.report('loading…');
    const ok = await reloadWorker();
    if (!ok) {
      executionMode = userTookControl ? 'MANUAL' : 'DEMO';
      return;
    }
    reflectNeutral();
    // Drop stale highlight IDs from any prior run so RUNNING_AUTO's
    // $derived branch doesn't flash a previous run's triple before the
    // first `idle` arrives. (Resume-from-paused path keeps them; the
    // paused values are still valid until the next idle / pause.)
    prevStateId = null;
    currentStateId = null;
    nextStateId = null;
    executionMode = withPause ? 'RUNNING_AUTO' : 'RUNNING_CONTINUOUS';
    codeChangedWarned = false;
    if (withPause) {
      log.report(`running, auto-stepping every ${intervalMs}ms`);
    } else {
      log.report('running…');
    }
    pendingOp = 'run';
    try {
      const res = await runner.run({
        maxSteps: undefined,
        debug: debugMode,
        intervalMs: withPause ? (intervalMs ?? null) : null,
        onPaused: onPausedHandler,
        onIter: onIterHandler,
      });
      // Snap mirror to halt-time tapes. RUNNING_AUTO has a render chain in
      // flight; queue the rebuild behind it so iters that haven't yet
      // animated finish first, then the final state lands. Continuous run
      // has no chain in flight (renderChain resolved long ago) and snaps
      // immediately.
      const tapesAtHalt = res.tapes;
      renderChain = renderChain.then(() => {
        lastSnapshots = tapesAtHalt;
        _buildMirrorMachine(tapesAtHalt, alphabets);
        setAllFromMirror();
      });
      halted = true;
      stepsApplied = res.stepsApplied;
      reflectNeutral();
      if (res.commands.length > 0) {
        log.appendBatch(
          res.commands.map((commands, i) =>
            commandsEntry(
              res.reads[i] ?? null,
              commands,
              alphabets,
              { stepNumber: res.startStep + i + 1 },
              CARET_COLORS,
              res.matchKinds[i] ?? null,
            ),
          ),
        );
      }
      if (res.truncated) {
        log.report(`truncated at ${res.stepsApplied} steps (limit hit)`, 'warn');
      } else {
        log.report(`halted after ${res.stepsApplied} step(s)`, 'ok');
      }
      executionMode = 'HALTED';
    } catch (err) {
      failHalted(err);
    } finally {
      pendingOp = null;
    }
  }

  async function onCopy(): Promise<void> {
    if (!lastSnapshots) {
      log.report('copy failed: no tape state to copy', 'error');
      return;
    }
    try {
      const text = serializeSnapshot(lastSnapshots, alphabets);
      await navigator.clipboard.writeText(text);
      const n = lastSnapshots.length;
      log.report(`copied ${n}-tape snapshot`, 'ok');
    } catch {
      log.report('copy failed: clipboard unavailable', 'error');
    }
  }

  async function onPaste(): Promise<void> {
    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch {
      log.report('paste failed: clipboard unavailable', 'error');
      return;
    }

    const result = parseSnapshot(text);
    if ('reason' in result) {
      switch (result.reason) {
        case 'not-json':
          log.report('paste failed: not JSON', 'error');
          return;
        case 'wrong-format':
          log.report('paste failed: not a machines-demo snapshot', 'error');
          return;
        case 'unsupported-version':
          log.report(`paste failed: unsupported snapshot version (got ${result.got}, expected 1)`, 'error');
          return;
        case 'wrong-shape':
          log.report(`paste failed: malformed — ${result.detail}`, 'error');
          return;
      }
    }

    // Tape-count bounds: must have ≥1 tape and fit within MAX_TAPES (the
    // CARET_COLORS palette length + the worker's hard limit on builds).
    // Paste is mirror-only — the user takes control and operates against
    // the pasted state regardless of what the current machine emits.
    if (result.tapes.length === 0) {
      log.report('paste failed: snapshot has no tapes', 'error');
      return;
    }
    if (result.tapes.length > MAX_TAPES) {
      log.report(
        `paste failed: snapshot has ${result.tapes.length} tapes (max ${MAX_TAPES})`,
        'error',
      );
      return;
    }

    // DEMO auto-take-control. After this, executionMode is MANUAL and
    // demoEnabled is false, matching the existing Apply-during-DEMO transition.
    if (executionMode === 'DEMO') {
      demoEnabled = false;
      userTookControl = true;
      executionMode = 'MANUAL';
    }

    alphabets = result.alphabets;
    lastSnapshots = result.tapes;
    _buildMirrorMachine(result.tapes, result.alphabets);
    // Wait for Svelte to mount/unmount tape rows when the count changed,
    // then push state into the (now-correct) refs. Matches reloadWorker.
    await tick();
    setAllFromMirror();

    log.report(`pasted ${result.tapes.length}-tape snapshot`, 'ok');
  }

  function takeControl(): void {
    log.report('user took control', 'ok');
    userTookControl = true;
    executionMode = 'MANUAL';
    reflectNeutral();
  }

  async function onApply(commands: Command[]): Promise<void> {
    // Capture pre-apply head symbols so the log entry mirrors a regular
    // step's `[reads] → [writes]/[moves]` notation. Reads come from the
    // main-thread mirror (source of truth for tape state in MANUAL mode).
    const reads: string[] | null =
      mirrorTapeBlock?.tapes.map((t) => t.symbols[t.position] ?? '') ?? null;
    await renderFromMirror(commands, true);
    log.report(commandsEntry(reads, commands, alphabets, 'applied', CARET_COLORS));
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
    log.report(`saved "${existing.title}"`, 'ok');
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
    tapesStackRef?.setTransitionsEnabled(beltTransitionsOn);
  });

  $effect(() => {
    void code;  // subscribe; value unused (read happens via untrack below)
    untrack(() => {
      if (
        executionMode === 'RUNNING_AUTO' ||
        executionMode === 'RUNNING_CONTINUOUS' ||
        executionMode === 'RUNNING_PAUSED'
      ) {
        if (!codeChangedWarned) {
          codeChangedWarned = true;
          log.report('code changed — current execution continues from loaded state', 'warn');
        }
      }
    });
  });

  /* ───── lifecycle ───── */

  onMount(() => {
    if (initial.badUrlId !== null) log.report(`snippet not found: ${initial.badUrlId}`, 'error');
    void doLoad();
  });

  onDestroy(() => {
    runner.terminate();
    log.dispose();
  });
</script>

<section class="tab">
  <div class="panel-tape">
    <TapesStack bind:this={tapesStackRef} {tapeCount} caretColors={CARET_COLORS} />

    {#if graphModalOpen}
      <!-- Single-instance expanded mode (machines-demo#9 + post-#37
           follow-up): the same inline `<MachineGraph>` below detaches
           via `expanded` prop into a fixed-positioned panel. This div
           is just the dimmed backdrop + click-out / Esc close affordance.
           The graph itself sits at z-index 50 above this backdrop. -->
      <div
        class="graph-modal-backdrop"
        role="presentation"
        onclick={() => { graphModalOpen = false; }}
        onkeydown={(e) => { if (e.key === 'Escape') graphModalOpen = false; }}
        tabindex="-1"
      ></div>
    {/if}

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

    <div class="tape-actions">
      {#if takeControlVisible}
        <button class="take-control" type="button" onclick={takeControl}>
          {@html icons.takeControl}
          <span class="btn-label">Take control</span>
        </button>
      {/if}
      <button
        class="tape-action-btn"
        type="button"
        onclick={onCopy}
        title="Copy tape state"
        aria-label="Copy tape state"
      >
        {@html icons.copy}
      </button>
      <button
        class="tape-action-btn"
        type="button"
        onclick={onPaste}
        disabled={!pasteEnabled}
        title="Paste tape state"
        aria-label="Paste tape state"
      >
        {@html icons.clipboard}
      </button>
    </div>

    <div class="machine-graph-row">
      <MachineGraph
        {graph}
        highlight={graphHighlight}
        {stepsApplied}
        breakpoints={breakpointIndicatorSet}
        breakpointKinds={breakpoints}
        {onToggleBreakpoint}
        collapsed={graphCollapsed}
        onToggleCollapsed={() => { graphCollapsed = !graphCollapsed; }}
        expanded={graphModalOpen}
        onExpand={() => { graphModalOpen = !graphModalOpen; }}
        onRenderError={(msg: string) => log.report(msg, 'error')}
      />
    </div>

    <Log entries={log.entries} onClear={() => log.clear()} />
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

  /* State-graph row (machines-demo#9) — sits between TapesStack and the
     control panel. Just a top-margin spacer so the collapsible card has
     air around it; the card owns its own border/background. */
  .machine-graph-row {
    margin-top: 12px;
  }

  /* Backdrop for the expanded MachineGraph panel (#9 — single-instance
     redesign). The graph itself is rendered by MachineGraph at z-index
     50; this sits just below at 49 so clicks outside the graph land
     here and trigger close. No flex / no padding — the backdrop just
     dims the viewport. */
  .graph-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 49;
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

  .tape-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
    width: 100%;
  }

  .tape-action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    padding: 0;
    background: transparent;
    border: 1px solid var(--cell-border);
    color: var(--muted);
    border-radius: 6px;
    cursor: pointer;
    flex-shrink: 0;
    transition:
      background-color var(--anim-button-hover-ms) ease,
      border-color var(--anim-button-hover-ms) ease,
      color var(--anim-button-hover-ms) ease;

    &:hover:not(:disabled) {
      background: var(--hover-bg);
      color: var(--fg);
    }

    &:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    :global(svg) {
      width: 16px;
      height: 16px;
      display: block;
    }
  }

  .take-control {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 1;
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
