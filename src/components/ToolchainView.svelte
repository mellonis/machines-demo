<script lang="ts">
  // Per-engine orchestrator for the toolchain pages (/pm1, /tm1). Mirrors
  // MachineView.svelte's shape — state + handlers here, presentation in
  // TapesStack / Toolbar / ControlPanel / FileTabs / Editor / Log — over the
  // wasm toolchain instead of the JS engines. Execution model and debugger
  // semantics: docs/execution-model.md (toolchain engines).
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import type { EditorView } from '@codemirror/view';
  import type { Extension } from '@codemirror/state';
  import TapesStack from './TapesStack.svelte';
  import Toolbar from './Toolbar.svelte';
  import ControlPanel from './ControlPanel.svelte';
  import FileTabs from './FileTabs.svelte';
  import Log from './Log.svelte';
  import { LogStore } from '../lib/logStore.svelte.ts';
  import ToolchainWorker from '../lib/toolchain/toolchainWorker.ts?worker';
  import { ToolchainRunner, ToolchainTimeoutError, ToolchainWorkerError } from '../lib/toolchain/toolchainRunner.ts';
  import { BELT_ANIMATION_MIN_INTERVAL_MS, MAX_TAPES, VIEWPORT_WIDTH } from '../lib/caps.ts';
  import { CARET_COLORS } from '../lib/caretColors.ts';
  import type { Command, ToolchainEngine } from '../lib/types.ts';
  import {
    TOOLCHAIN_ARCH, langFor, extOf,
    type BufferKind, type Diagnostic, type ExampleSeed, type FinishedResponse, type LineMap, type PausedResponse,
    type ProgressResponse, type SeedTape, type SourceFile, type SourceTab, type SteppedResponse, type TapeLayout, type TapeSnapshot,
  } from '../lib/toolchain/types.ts';
  import {
    applyCommand, applySeedGlyphs, cellAt, emptySeed, findStdDefinition, headDelta, indexStdExports, layoutsEqual, seedCellAt,
    seedFromGlyphs, seedFromSnapshot, seedFromWasm, seedToGlyphs, seedToLibTape, seedToWasm, snapshotToLibTape, type StdExport,
  } from '../lib/toolchain/toolchainHelpers.ts';
  import { toolchainLinter } from '../lib/toolchain/editor/lint.ts';
  import { stdCompletion } from '../lib/toolchain/editor/stdCompletion.ts';
  import { stdLink } from '../lib/toolchain/editor/stdLink.ts';
  import { breakpointGutter, refreshBreakpoints } from '../lib/toolchain/editor/breakpointGutter.ts';
  import { ipHighlight, scrollToLine, showIp } from '../lib/toolchain/editor/ipHighlight.ts';
  import { downloadBlob } from '../lib/toolchain/download.ts';
  import { formatStepNotation } from '@turing-machine-js/visuals';
  import { parseInterval } from '../lib/interval.ts';
  import { parse as parseSnapshot, serialize as serializeSnapshot } from '../lib/tapeSnapshot.ts';
  import { defaultExample, examples, findExample, type Example } from '../lib/defaultCode.ts';
  import { computeInitialBoot, parseIdParam } from '../lib/initialBoot.ts';
  import {
    loadCode, loadExampleId, saveExampleId, loadSnippets, saveSnippet, deleteSnippet, renameSnippet,
    loadDebugMode, saveDebugMode, loadSeeds, saveSeeds, loadKind, saveKind, type Snippets,
  } from '../lib/persist.ts';
  import { icons } from '../lib/icons.ts';

  type Props = { engine: ToolchainEngine };
  let { engine }: Props = $props();

  type ExecutionMode = 'MANUAL' | 'RUNNING_AUTO' | 'RUNNING_CONTINUOUS' | 'RUNNING_PAUSED' | 'HALTED';

  /* ───── boot ───── */
  const arch = untrack(() => TOOLCHAIN_ARCH[engine]);
  // The stdlib text is per-arch, not per-kind: `Toolchain.stdlibSource('pma')`
  // returns the same `.pmc` library source as `stdlibSource('pmc')`. So it is
  // fetched once with the source lang and the std tab always renders in it.
  const stdLang = untrack(() => langFor(engine, 'source'));
  const engineExamples = untrack(() => examples(engine));
  const initialExample = untrack(() => {
    const persistedId = loadExampleId(engine);
    return (persistedId && findExample(engine, persistedId)) || defaultExample(engine);
  });
  const initialSnippets = untrack(() => loadSnippets(engine));
  let snippets = $state<Snippets>(initialSnippets);
  const loadedCode = untrack(() => loadCode(engine));
  const initial = untrack(() =>
    computeInitialBoot({ engine, url: new URL(window.location.href), snippets: initialSnippets, loadedCode, initialExample }),
  );
  let selectedExampleId = $state<string>(initial.selectedExampleId);
  let loadedSnippetId = $state<string | null>(initial.loadedSnippetId);
  let code = $state<string>(initial.code);
  // Kind and seeds follow the same boot tier as the code (lib/initialBoot.ts's
  // computeInitialBoot priority: ?example=<id> matched → ?snippet=<uuid>
  // matched → localStorage → the first bundled example) — computed directly
  // from the same inputs computeInitialBoot uses, not inferred by comparing
  // `initial.code` against an example's text. That comparison is wrong: an
  // untouched buffer with a panel-edited seed is byte-identical to the
  // example's code, so it read as "the example tier applied" and silently
  // discarded the persisted seed (and kind) on every reload.
  const urlExampleId = untrack(() => parseIdParam(new URL(window.location.href), 'example'));
  const bootTierExample = untrack(() => (urlExampleId !== null ? findExample(engine, urlExampleId) : undefined));
  let kind = $state<BufferKind>(untrack(() => {
    if (bootTierExample !== undefined) return bootTierExample.kind ?? 'source';
    if (initial.loadedSnippetId !== null) return initialSnippets[initial.loadedSnippetId]?.kind ?? 'source';
    if (loadedCode !== null) return loadKind(engine) ?? 'source';
    return initialExample.kind ?? 'source';
  }));
  // Glyph seeds waiting for the first successful Build (the band layouts).
  let pendingSeedGlyphs: ExampleSeed[] | null = untrack(() => {
    if (bootTierExample !== undefined) return bootTierExample.seeds ?? [];
    if (initial.loadedSnippetId !== null) return initialSnippets[initial.loadedSnippetId]?.seeds ?? [];
    if (loadedCode !== null) return loadSeeds(engine) ?? [];
    return initialExample.seeds ?? [];
  });
  // True once `pendingSeedGlyphs` has already been applied to the current
  // `tapes` layout (at pick/load time, see `pickExample` / `onLoadSnippet`)
  // — tells `reloadWorker` it doesn't need to re-derive `seeds` from scratch
  // when the next Build's bands turn out unchanged. Plain `let`, not
  // `$state`: read only from non-reactive code (event handlers), never from
  // a template or a `$derived`.
  let pendingApplied = false;
  // The other kind's buffer, kept for the page's lifetime so switching back restores it.
  const otherBuffer: Record<BufferKind, string | null> = { source: null, asm: null };

  /* ───── state ───── */
  let executionMode = $state<ExecutionMode>('MANUAL');
  let pendingOp = $state<'load' | 'run' | null>(null);
  let workerLive = $state(false);
  let builtSource = $state<string | null>(null);
  let builtLang = $state<string | null>(null);
  let tapes = $state<TapeLayout[]>([]);
  let seeds = $state<SeedTape[]>([]);
  let lastSnapshots = $state<TapeSnapshot[] | null>(null);
  let lineMap = $state<LineMap | null>(null);
  let stdText = $state<string>('');
  let stdExports = $state<StdExport[]>([]);
  let activeTab = $state<SourceTab>('main');
  let ipLoc = $state<{ file: SourceFile; line: number | null; fn: string } | null>(null);
  let withPause = $state(false);
  let debugMode = $state<boolean>(untrack(() => loadDebugMode(engine)));
  let intervalText = $state('1s');
  let stopRequested = false;
  let takeControlRequested = false;
  /** Head positions of the previously rendered frame — the belt slide's ±1. */
  let prevHeads: number[] | null = null;
  /** Location of the instruction the next `stepped` will have retired.
   *  `stepped.ip` is where execution *resumes*, so the step line has to name
   *  this, not the incoming ip. */
  let prevIpLoc: { file: SourceFile; line: number | null; fn: string } | null = null;
  let codeChangedWarned = false;
  // Breakpoints keyed "<file>:<line>" — user intent, kept across builds; resolved to addresses at Build / start.
  const breakpoints = new SvelteSet<string>();
  let mainView: EditorView | null = null;
  let stdView: EditorView | null = null;
  let tapesStackRef = $state<ReturnType<typeof TapesStack> | undefined>();
  let panelRef = $state<ReturnType<typeof ControlPanel> | undefined>();
  let tapeBlockInputEl = $state<HTMLInputElement | undefined>(undefined);
  const log = new LogStore();
  const editorPromise = import('./Editor.svelte').then((m) => m.default);
  const runner = new ToolchainRunner(() => new ToolchainWorker());
  runner.onUncorrelatedError = (msg) => log.report(`error: ${msg}`, 'error');
  runner.onFatal = () => { workerLive = false; log.report('toolchain module crashed — restarting the worker', 'error'); };

  /* ───── derived ───── */
  const lang = $derived(langFor(engine, kind));
  const ext = $derived(extOf(lang));
  const srcExt = $derived(`${arch}c`);
  const alphabets = $derived(tapes.map((t) => t.glyphs));
  const tapeCount = $derived(Math.max(1, tapes.length));
  const showTapeLabels = $derived(tapeCount > 1);
  const intervalMs = $derived(parseInterval(intervalText));
  const intervalIsValid = $derived(intervalMs !== null);
  const latestEntry = $derived(log.latest);
  const panelEnabled = $derived(executionMode === 'MANUAL' && tapes.length > 0);
  const applyVisible = $derived(executionMode === 'MANUAL');
  const takeControlVisible = $derived(executionMode !== 'MANUAL' && executionMode !== 'RUNNING_CONTINUOUS' && executionMode !== 'RUNNING_PAUSED');
  const pasteEnabled = $derived(executionMode === 'MANUAL' && tapes.length > 0);
  const tapeBlockEnabled = $derived((executionMode === 'MANUAL' || executionMode === 'HALTED') && workerLive && pendingOp === null);
  const beltTransitionsOn = $derived(executionMode !== 'RUNNING_CONTINUOUS' && executionMode !== 'RUNNING_PAUSED');
  const selectedExample = $derived(findExample(engine, selectedExampleId) ?? defaultExample(engine));
  /** What Reset would restore — text *and* buffer kind. `null` when there is
   *  no target (the loaded snippet was deleted). */
  const source = $derived.by((): { code: string; kind: BufferKind } | null => {
    if (loadedSnippetId !== null) {
      const s = snippets[loadedSnippetId];
      return s ? { code: s.code, kind: s.kind ?? 'source' } : null;
    }
    return { code: selectedExample.code, kind: selectedExample.kind ?? 'source' };
  });
  // The kind is part of the buffer's identity: after a language switch the
  // text is the other kind's, so "differs from source" has to cover both or
  // the dot and the Reset button vanish while the buffer is still changed.
  const dirty = $derived(source !== null && (code !== source.code || kind !== source.kind));
  const resetVisible = $derived(dirty);
  const staleBuild = $derived(builtSource !== null && (code !== builtSource || builtLang !== lang));
  const resetTitle = $derived(loadedSnippetId !== null && loadedSnippetId in snippets ? `Reset to "${snippets[loadedSnippetId].title}"` : 'Reset to selected example');
  const loadDisabled = $derived(pendingOp !== null);
  const stepDisabled = $derived((pendingOp !== null && executionMode !== 'RUNNING_PAUSED' && executionMode !== 'RUNNING_AUTO') || executionMode === 'RUNNING_CONTINUOUS');
  const runDisabled = $derived((pendingOp !== null && executionMode !== 'RUNNING_PAUSED') || executionMode === 'RUNNING_AUTO' || executionMode === 'RUNNING_CONTINUOUS' || (withPause && !intervalIsValid));
  const kindSwitchEnabled = $derived(pendingOp === null && executionMode !== 'RUNNING_AUTO' && executionMode !== 'RUNNING_CONTINUOUS' && executionMode !== 'RUNNING_PAUSED');
  const mainTitle = $derived(loadedSnippetId !== null ? snippets[loadedSnippetId]?.title ?? 'main' : selectedExampleId);

  /* ───── breakpoints ───── */
  const bpKey = (file: SourceFile, line: number) => `${file}:${line}`;
  function tableFor(file: SourceFile): (number | null)[] { return (file === 'std' ? lineMap?.stdLineToAddr : lineMap?.userLineToAddr) ?? []; }
  function canSet(file: SourceFile, line: number): boolean { return (tableFor(file)[line] ?? null) !== null; }
  function resolveBreakpoints(): number[] {
    const out: number[] = [];
    for (const key of breakpoints) {
      const [file, l] = key.split(':') as [SourceFile, string];
      const addr = tableFor(file)[Number(l)] ?? null;
      if (addr !== null) out.push(addr);
    }
    return out;
  }
  function toggleBreakpoint(file: SourceFile, line: number): void {
    const key = bpKey(file, line);
    if (breakpoints.has(key)) breakpoints.delete(key); else breakpoints.add(key);
    runner.setBreakpoints(resolveBreakpoints());
  }
  function pruneBreakpoints(): void {
    const dropped: string[] = [];
    for (const key of [...breakpoints]) {
      const [file, l] = key.split(':') as [SourceFile, string];
      if (!canSet(file, Number(l))) { breakpoints.delete(key); dropped.push(`${fileLabel(file)}:${l}`); }
    }
    if (dropped.length > 0) log.report(`dropped breakpoint(s) with no instruction: ${dropped.join(', ')}`, 'warn');
    if (mainView) refreshBreakpoints(mainView);
    if (stdView) refreshBreakpoints(stdView);
  }
  function gutterFor(file: SourceFile): Extension {
    return breakpointGutter({
      has: (line) => breakpoints.has(bpKey(file, line)),
      canSet: (line) => canSet(file, line),
      onToggle: (line) => toggleBreakpoint(file, line),
      refuseTitle: 'no instruction on this line',
    });
  }

  /* ───── rendering ───── */
  function locOf(ip: number): { file: SourceFile; line: number | null; fn: string } | null {
    const l = lineMap?.addrToLoc.find((x) => x.addr === ip);
    return l ? { file: l.file, line: l.line, fn: l.fn } : null;
  }
  /** Where a run begins: the entry address, or the program's first mapped
   *  address when address 0 carries no instruction of its own. */
  function entryLoc(): { file: SourceFile; line: number | null; fn: string } | null {
    const first = lineMap?.addrToLoc[0];
    return locOf(0) ?? (first ? { file: first.file, line: first.line, fn: first.fn } : null);
  }
  function fileLabel(file: SourceFile): string { return file === 'std' ? `std.${srcExt}` : `main.${ext}`; }
  function locText(loc: { file: SourceFile; line: number | null; fn: string } | null): string {
    return loc ? `${fileLabel(loc.file)}:${loc.line ?? '?'} ${loc.fn}` : '?';
  }
  /** Re-applies the ip decoration to whichever views exist; follows the ip across files. */
  function syncIp(): void {
    const loc = ipLoc;
    if (mainView) showIp(mainView, loc && loc.file === 'user' ? loc.line : null);
    if (stdView) showIp(stdView, loc && loc.file === 'std' ? loc.line : null);
  }
  /** Only one Editor is mounted at a time — drop the reference to the view
   *  that is about to be unmounted so a later `syncIp` can't dispatch into it. */
  function setTab(tab: SourceTab): void {
    if (tab === activeTab) return;
    if (tab === 'std') mainView = null; else stdView = null;
    activeTab = tab;
  }
  function setIp(ip: number | null): void {
    ipLoc = ip === null ? null : locOf(ip);
    if (ipLoc && ipLoc.line !== null) setTab(ipLoc.file === 'std' ? 'std' : 'main');
    void tick().then(syncIp);
  }
  function renderSeeds(): void {
    seeds.forEach((s, i) => tapesStackRef?.setFromTape(i, seedToLibTape(s, alphabets[i], VIEWPORT_WIDTH)));
  }
  function renderSnapshots(snaps: TapeSnapshot[], animate: boolean, prev: TapeSnapshot[] | null): void {
    snaps.forEach((snap, i) => {
      const prevHead = prevHeads?.[i] ?? snap.head;
      const delta = animate ? headDelta(prevHead, snap.head) : 0;
      const wrote = animate && prev !== null ? cellAt(prev[i], prevHead) !== cellAt(snap, prevHead) : false;
      tapesStackRef?.setFromTape(i, snapshotToLibTape(snap, VIEWPORT_WIDTH), delta, animate, wrote);
    });
    lastSnapshots = snaps;
  }
  function adoptSnapshots(snaps: TapeSnapshot[]): void {
    seeds = snaps.map(seedFromSnapshot);
    lastSnapshots = snaps;
  }

  /* ───── editor extensions ───── */
  // Plain arrays, not $derived: every closure below reads the reactive state
  // it needs at call time, so recomputing the array would only reconfigure
  // CodeMirror for no behavioural gain.
  const mainExtensions: Extension[] = [
    toolchainLinter(() => runner.check(lang, code)),
    stdCompletion(() => stdExports),
    stdLink(goToStd),
    gutterFor('user'),
    ipHighlight(),
  ];
  const stdExtensions: Extension[] = [gutterFor('std'), ipHighlight(), stdLink(goToStd)];

  function onMainReady(view: EditorView): void { mainView = view; refreshBreakpoints(view); syncIp(); }
  function onStdReady(view: EditorView): void { stdView = view; refreshBreakpoints(view); syncIp(); }

  /* ───── build ───── */
  function posToLine(d: Diagnostic, source: string): number { return source.slice(0, d.from).split('\n').length; }

  async function reloadWorker(): Promise<boolean> {
    pendingOp = 'load';
    const source = code;
    const builtWith = lang;
    try {
      if (stdText === '') {
        stdText = await runner.stdlib(stdLang);
        stdExports = indexStdExports(stdLang, stdText);
      }
      const res = await runner.build(builtWith, source);
      if (!res.ok) {
        for (const d of res.diagnostics) log.report(`${d.severity === 'error' ? 'build failed' : 'warning'}: ${d.message} (line ${posToLine(d, source)})`, d.severity === 'error' ? 'error' : 'warn');
        return false;
      }
      for (const d of res.diagnostics) log.report(`warning: ${d.message} (line ${posToLine(d, source)})`, 'warn');
      workerLive = true;
      builtSource = source;
      builtLang = builtWith;
      lineMap = res.lineMap;
      // `pendingApplied` is true only when `pickExample` / `onLoadSnippet`
      // already mapped `pendingSeedGlyphs` onto the (pre-Build) `tapes`
      // layout and it fit. If the new build's bands come out unchanged,
      // that mapping still holds and `seeds` is left alone — this is what
      // lets a panel edit made between pick and Build survive. Any other
      // case (nothing applied yet, e.g. boot; or the bands changed since)
      // re-derives `seeds` from `pendingSeedGlyphs` against the *new*
      // layout.
      if (pendingSeedGlyphs !== null && (!pendingApplied || !layoutsEqual(tapes, res.tapes))) {
        const glyphSeeds = pendingSeedGlyphs;
        seeds = res.tapes.map((t, i) => {
          const g = glyphSeeds[i];
          if (!g) return emptySeed();
          try { return seedFromGlyphs(t.glyphs, g); } catch (err) { log.report(`seed for band ${t.name} ignored: ${(err as Error).message}`, 'error'); return emptySeed(); }
        });
      } else if (!layoutsEqual(tapes, res.tapes)) {
        if (tapes.length > 0) log.report("seeds reset — the program's bands changed", 'warn');
        seeds = res.tapes.map(() => emptySeed());
      }
      pendingSeedGlyphs = null;
      pendingApplied = false;
      tapes = res.tapes;
      lastSnapshots = null;
      setIp(null);
      setTab('main');
      await tick();
      renderSeeds();
      pruneBreakpoints();
      runner.setBreakpoints(resolveBreakpoints());
      runner.setDebug(debugMode);
      return true;
    } catch (err) {
      // Only a dead module takes the worker down with it: a fatal error or a
      // watchdog kill. Any other rejection (a superseded request, a bad
      // response shape) leaves the worker alive, so clearing `workerLive`
      // would disable the tape-block buttons and the setDebug effect until
      // the next successful Build for no reason.
      if (err instanceof ToolchainTimeoutError || (err instanceof ToolchainWorkerError && err.fatal)) workerLive = false;
      log.report(`error: ${err instanceof Error ? err.message : String(err)}`, 'error');
      return false;
    } finally {
      pendingOp = null;
    }
  }

  async function doLoad(): Promise<void> {
    log.reportSeparator();
    log.report('building…');
    const ok = await reloadWorker();
    executionMode = 'MANUAL';
    if (!ok) return;
    log.report(`built — ${tapes.length} band(s): ${tapes.map((t) => t.name).join(', ')}`, 'ok');
    panelRef?.reflect(tapes.map(() => ({ movement: 'S', symbol: null }) as Command));
  }

  /* ───── run ───── */
  function causeText(p: PausedResponse): string {
    if (p.cause === 'brk') return 'debugger';
    if (p.cause === 'manual') return 'manual';
    if (p.cause === 'step') return 'step';
    if (typeof p.cause === 'object' && 'breakpoint' in p.cause) return 'breakpoint';
    return 'trap';
  }

  const MOVEMENT_OF = { '-1': 'L', 0: 'S', 1: 'R' } as const;

  /**
   * What the step did to the bands, in the engine's edge-label vocabulary —
   * `[reads] → [writes]/[moves]`, the same `formatStepNotation` the JS engine
   * pages log, so a step reads the same on every tab. Returns '' when there is
   * no comparable previous frame. The read is taken from the previous
   * snapshots, or from the seeds on a run's first step (nothing has been
   * snapshotted yet). One TM-1 source line lowers to several instructions, so
   * consecutive steps often share a location — this is what tells them apart.
   */
  function stepDetail(snaps: TapeSnapshot[], heads: number[] | null, prev: TapeSnapshot[] | null): string {
    if (heads === null || heads.length !== snaps.length) return '';
    const reads = snaps.map((snap, i) => snap.glyphs[prev ? cellAt(prev[i], heads[i]) : seedCellAt(seeds[i] ?? emptySeed(), heads[i])] ?? '');
    const commands: Command[] = snaps.map((snap, i) => {
      const written = snap.glyphs[cellAt(snap, heads[i])] ?? '';
      return { movement: MOVEMENT_OF[headDelta(heads[i], snap.head)], symbol: written === reads[i] ? null : written };
    });
    return ` — ${formatStepNotation(reads, commands, snaps.map((s) => s.glyphs[0] ?? ' '))}`;
  }

  function onStepped(r: SteppedResponse): void {
    const prev = lastSnapshots;
    const heads = prevHeads;
    const animate = executionMode !== 'RUNNING_AUTO' || (intervalMs !== null && intervalMs >= BELT_ANIMATION_MIN_INTERVAL_MS);
    renderSnapshots(r.snapshots, animate, prev);
    prevHeads = r.snapshots.map((s) => s.head);
    setIp(r.ip);
    if (r.retired) log.report(`step ${r.stats.steps}: ${locText(prevIpLoc)}${stepDetail(r.snapshots, heads, prev)}`);
    prevIpLoc = locOf(r.ip);
    if (executionMode !== 'RUNNING_AUTO') executionMode = 'RUNNING_PAUSED';
  }
  function onPaused(r: PausedResponse): void {
    renderSnapshots(r.snapshots, false, null);
    prevHeads = r.snapshots.map((s) => s.head);
    setIp(r.ip);
    log.report(`paused at ${locText(ipLoc).replace(' ', ' in ')} (${causeText(r)})`, 'pause');
    prevIpLoc = locOf(r.ip);
    executionMode = 'RUNNING_PAUSED';
  }
  function onProgress(r: ProgressResponse): void {
    renderSnapshots(r.snapshots, false, null);
  }
  function onFinished(f: FinishedResponse): void {
    renderSnapshots(f.snapshots, false, null);
    adoptSnapshots(f.snapshots);
    const o = f.result.outcome;
    if (takeControlRequested) {
      takeControlRequested = false;
      stopRequested = false;
      log.report('user took control', 'ok');
      setIp(null);
      executionMode = 'MANUAL';
      return;
    }
    if (o.kind === 'trapped') {
      if (o.trap.kind === 'step-limit') log.report(`truncated at ${f.result.stats.steps} steps (limit hit)`, 'warn');
      else log.report(`trapped: ${o.trap.kind} — ${o.trap.detail} at ${locText(locOf(o.trap.at ?? f.result.ip))}`, 'abort');
      setIp(o.trap.at ?? f.result.ip);
    } else {
      if (!stopRequested) log.report(`${o.kind} after ${f.result.stats.steps} step(s)`, 'ok');
      setIp(null);
    }
    stopRequested = false;
    executionMode = 'HALTED';
  }
  function failHalted(err: unknown): void {
    stopRequested = false;
    if (takeControlRequested) { takeControlRequested = false; executionMode = 'MANUAL'; return; }
    const msg = err instanceof Error ? err.message : String(err);
    log.report(`error: ${msg}`, 'error');
    if (err instanceof ToolchainTimeoutError && err.progress) {
      renderSnapshots(err.progress.snapshots, false, null);
      adoptSnapshots(err.progress.snapshots);
      log.report(`tape shows step ${err.progress.steps} — last snapshot before termination`);
    }
    workerLive = false;
    setIp(null);
    executionMode = 'HALTED';
  }

  async function startRun(mode: 'step' | 'auto' | 'continuous'): Promise<void> {
    log.reportSeparator();
    log.report('building…');
    const ok = await reloadWorker();
    if (!ok) { executionMode = 'MANUAL'; return; }
    codeChangedWarned = false;
    stopRequested = false;
    prevHeads = seeds.map((s) => s.head);
    prevIpLoc = entryLoc();
    lastSnapshots = null;
    executionMode = mode === 'step' ? 'RUNNING_PAUSED' : mode === 'auto' ? 'RUNNING_AUTO' : 'RUNNING_CONTINUOUS';
    log.report(mode === 'step' ? 'running step by step…' : mode === 'auto' ? `running, auto-stepping every ${intervalMs}ms` : 'running…');
    pendingOp = 'run';
    try {
      const f = await runner.start(
        { seeds: seeds.map(seedToWasm), breakpoints: resolveBreakpoints(), mode, intervalMs: mode === 'auto' ? (intervalMs ?? undefined) : undefined },
        { onStepped, onPaused, onProgress },
      );
      onFinished(f);
    } catch (err) {
      failHalted(err);
    } finally {
      pendingOp = null;
    }
  }

  function doStep(): void {
    // The highlight is "execution is here"; a resume makes it stale until the
    // next stepped / paused repaints it.
    if (executionMode === 'RUNNING_PAUSED') { setIp(null); runner.resume('step'); return; }
    if (executionMode === 'RUNNING_AUTO') { runner.pause(); return; }
    void startRun('step');
  }
  function doRun(): void {
    if (executionMode === 'RUNNING_PAUSED') {
      const mode = withPause ? 'auto' : 'continuous';
      setIp(null);
      runner.resume(mode, withPause ? (intervalMs ?? undefined) : undefined);
      executionMode = withPause ? 'RUNNING_AUTO' : 'RUNNING_CONTINUOUS';
      return;
    }
    void startRun(withPause ? 'auto' : 'continuous');
  }
  function stopMachine(): void {
    if (runner.runPending) { stopRequested = true; log.report('stopped', 'warn'); runner.stop(); return; }
    executionMode = 'HALTED';
    log.report('stopped', 'warn');
  }
  function takeControl(): void {
    if (runner.runPending) { takeControlRequested = true; runner.stop(); return; }
    log.report('user took control', 'ok');
    executionMode = 'MANUAL';
  }

  /* ───── panel / tapes ───── */
  function onApply(commands: Command[]): void {
    if (commands.length !== seeds.length) return;
    try {
      const next = seeds.map((s, i) => applyCommand(s, alphabets[i], commands[i]));
      next.forEach((s, i) => {
        const prev = seeds[i];
        tapesStackRef?.setFromTape(i, seedToLibTape(s, alphabets[i], VIEWPORT_WIDTH), headDelta(prev.head, s.head), true, seedCellAt(prev, prev.head) !== seedCellAt(s, prev.head));
      });
      seeds = next;
      log.report(`applied ${commands.map((c) => `${c.symbol === null ? '·' : `'${c.symbol}'`}/${c.movement}`).join(' ')}`);
    } catch (err) {
      log.report(`apply failed: ${(err as Error).message}`, 'error');
    }
  }
  async function onCopy(): Promise<void> {
    if (tapes.length === 0) { log.report('copy failed: no tape state to copy', 'error'); return; }
    try {
      const libTapes = seeds.map((s, i) => seedToLibTape(s, alphabets[i], VIEWPORT_WIDTH));
      await navigator.clipboard.writeText(serializeSnapshot(libTapes.map((t) => ({ symbols: t.symbols, position: t.position })), alphabets));
      log.report(`copied ${seeds.length}-tape snapshot`, 'ok');
    } catch { log.report('copy failed: clipboard unavailable', 'error'); }
  }
  async function onPaste(): Promise<void> {
    let text: string;
    try { text = await navigator.clipboard.readText(); } catch { log.report('paste failed: clipboard unavailable', 'error'); return; }
    const result = parseSnapshot(text);
    if ('reason' in result) { log.report(`paste failed: ${result.reason === 'wrong-shape' ? `malformed — ${result.detail}` : result.reason.replace(/-/g, ' ')}`, 'error'); return; }
    if (result.tapes.length !== tapes.length || result.tapes.length > MAX_TAPES) { log.report(`paste failed: snapshot has ${result.tapes.length} tape(s), program has ${tapes.length}`, 'error'); return; }
    try {
      seeds = result.tapes.map((t, i) => seedFromGlyphs(alphabets[i], { cells: t.symbols, origin: 0, head: t.position }));
      renderSeeds();
      log.report(`pasted ${seeds.length}-tape snapshot`, 'ok');
    } catch (err) { log.report(`paste failed: ${(err as Error).message}`, 'error'); }
  }
  async function onLoadTapeBlock(file: File): Promise<void> {
    try {
      const wasm = await runner.decodeTapeBlock(new Uint8Array(await file.arrayBuffer()));
      seeds = tapes.map((_, i) => (wasm[i] ? seedFromWasm(wasm[i]) : emptySeed()));
      renderSeeds();
      if (executionMode === 'HALTED') executionMode = 'MANUAL';
      log.report(`loaded tape block "${file.name}": ${wasm.length} band(s)`, 'ok');
    } catch (err) { log.report(`load tape block failed: ${(err as Error).message}`, 'error'); }
  }
  async function onSaveTapeBlock(): Promise<void> {
    try {
      const bytes = await runner.encodeTapeBlock(seeds.map((s, i) => ({ ...seedToWasm(s), glyphs: [...alphabets[i]] })));
      // Copied into a plain ArrayBuffer: the wasm binding's Uint8Array is
      // typed over ArrayBufferLike, which `BlobPart` does not accept.
      const buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);
      const name = `${mainTitle}.${arch}t`;
      downloadBlob(name, new Blob([buffer], { type: 'application/octet-stream' }));
      log.report(`saved tape block ${name}`, 'ok');
    } catch (err) { log.report(`save tape block failed: ${(err as Error).message}`, 'error'); }
  }

  /* ───── editor actions ───── */
  async function onFormat(): Promise<void> {
    try {
      const r = await runner.format(lang, code);
      if (!r.ok) { log.report(`format failed: ${r.error.message} (line ${posToLine(r.error, code)})`, 'error'); return; }
      if (mainView) mainView.dispatch({ changes: { from: 0, to: mainView.state.doc.length, insert: r.text } });
      else code = r.text;
      log.report('formatted', 'ok');
    } catch (err) { log.report(`format failed: ${(err as Error).message}`, 'error'); }
  }
  async function onKindChange(next: BufferKind): Promise<void> {
    if (next === kind) return;
    otherBuffer[kind] = code;
    const kept = otherBuffer[next];
    if (kept !== null && kept !== '') { kind = next; code = kept; return; }
    if (next === 'asm' && workerLive && builtSource !== null) {
      try {
        const text = await runner.disassemble();
        kind = next; code = text;
        log.report(`disassembled last Build into main.${extOf(langFor(engine, next))}`, 'ok');
        return;
      } catch (err) { log.report(`disassemble failed: ${(err as Error).message}`, 'error'); }
    }
    kind = next;
    code = '';
  }
  async function onOpenFile(file: File): Promise<void> {
    const fileExt = file.name.split('.').pop()?.toLowerCase() ?? '';
    const fileKind: BufferKind | null = fileExt === `${arch}c` ? 'source' : fileExt === `${arch}a` ? 'asm' : null;
    if (fileKind === null) { log.report(`cannot open ${file.name}: not a ${arch === 'pm' ? 'PM-1' : 'TM-1'} source`, 'error'); return; }
    const text = await file.text();
    kind = fileKind;
    code = text;
    loadedSnippetId = null;
    log.report(`opened ${file.name}`, 'ok');
  }
  function onSaveFile(): void {
    const name = `${mainTitle}.${ext}`;
    downloadBlob(name, new Blob([code], { type: 'text/plain' }));
    log.report(`saved ${name}`, 'ok');
  }
  /**
   * Cmd/Ctrl-click target. `qualified` is false for a bare word — the name a
   * `use std::name;` import brought into scope reads exactly like any other
   * identifier, so an unknown one is an ordinary click and must leave the
   * view alone: no tab switch, no log line. Only a spelled-out `std::name`
   * that resolves to nothing is worth reporting.
   */
  function goToStd(name: string, qualified: boolean): void {
    const def = findStdDefinition(stdExports, name);
    if (!def) {
      if (qualified) log.report(`no definition found for std::${name}`, 'warn');
      return;
    }
    setTab('std');
    void tick().then(() => {
      if (!stdView) return;
      stdView.dispatch({ selection: { anchor: stdView.state.doc.line(def.line).from } });
      scrollToLine(stdView, def.line);
    });
  }

  /* ───── examples / snippets (parity with MachineView) ───── */
  /** Restores kind before code, like `pickExample` / `onLoadSnippet` — the
   *  buffer's language comes from its source, so resetting only the text
   *  would leave a `.pmc` program sitting in an assembly buffer. */
  function resetCodeToSelected(): void {
    if (source === null) return;
    kind = source.kind;
    code = source.code;
  }
  /**
   * Applies `pendingSeedGlyphs` to the currently-loaded program's bands
   * (`tapes`, from the last Build) right away, when they fit — so the belt
   * shows the picked example's / loaded snippet's seed immediately instead
   * of waiting for the next Build. No-op (and no log) when they don't fit
   * (different band count or alphabet) or nothing has been built yet
   * (`tapes` empty, e.g. at boot); the seed then still applies inside
   * `reloadWorker` once the next Build produces a layout.
   */
  function applyPendingSeedsNow(): void {
    if (tapes.length === 0) return;
    const applied = applySeedGlyphs(tapes, pendingSeedGlyphs ?? []);
    if (applied === null) return;
    seeds = applied;
    renderSeeds();
    pendingApplied = true;
  }
  function pickExample(ex: Example): void {
    selectedExampleId = ex.id;
    kind = ex.kind ?? 'source';
    code = ex.code;
    loadedSnippetId = null;
    pendingSeedGlyphs = ex.seeds ?? [];
    pendingApplied = false;
    applyPendingSeedsNow();
  }
  function currentSeedGlyphs(): ExampleSeed[] { return seeds.map((s, i) => seedToGlyphs(alphabets[i] ?? [' '], s)); }
  function onSaveSnippet(title: string): void {
    const { id, snippet } = saveSnippet(engine, title, code, { kind, seeds: currentSeedGlyphs() });
    snippets = { ...snippets, [id]: snippet };
    loadedSnippetId = id;
  }
  function onSaveChanges(): void {
    if (loadedSnippetId === null) return;
    const existing = snippets[loadedSnippetId];
    if (!existing) return;
    const { id, snippet } = saveSnippet(engine, existing.title, code, { kind, seeds: currentSeedGlyphs() });
    snippets = { ...snippets, [id]: snippet };
    log.report(`saved "${existing.title}"`, 'ok');
  }
  function onLoadSnippet(id: string): void {
    const s = snippets[id];
    if (!s) return;
    kind = s.kind ?? 'source';
    code = s.code;
    loadedSnippetId = id;
    pendingSeedGlyphs = s.seeds ?? [];
    pendingApplied = false;
    applyPendingSeedsNow();
  }
  function onDeleteSnippet(id: string): void {
    deleteSnippet(engine, id);
    const { [id]: _, ...rest } = snippets;
    snippets = rest;
  }
  function onRenameSnippet(id: string, newTitle: string): void {
    if (!renameSnippet(engine, id, newTitle)) return;
    snippets = { ...loadSnippets(engine) };
  }

  /* ───── effects ───── */
  $effect(() => { saveDebugMode(engine, debugMode); });
  $effect(() => { if (workerLive) runner.setDebug(debugMode); });
  $effect(() => { saveExampleId(engine, selectedExampleId); });
  $effect(() => { saveKind(engine, kind); });
  $effect(() => { if (tapes.length > 0) saveSeeds(engine, currentSeedGlyphs()); });
  $effect(() => {
    const url = new URL(window.location.href);
    if (loadedSnippetId !== null) url.searchParams.set('snippet', loadedSnippetId); else url.searchParams.delete('snippet');
    url.searchParams.delete('example');
    history.replaceState(null, '', url);
  });
  $effect(() => { tapesStackRef?.setTransitionsEnabled(beltTransitionsOn); });
  $effect(() => {
    void code;
    untrack(() => {
      if ((executionMode === 'RUNNING_AUTO' || executionMode === 'RUNNING_CONTINUOUS' || executionMode === 'RUNNING_PAUSED') && !codeChangedWarned) {
        codeChangedWarned = true;
        log.report('code changed — current execution continues from the last Build', 'warn');
      }
    });
  });

  onMount(() => {
    if (initial.badExampleId !== null) log.report(`example not found: ${initial.badExampleId}`, 'error');
    if (initial.badUrlId !== null) log.report(`snippet not found: ${initial.badUrlId}`, 'error');
    void doLoad();
  });
  onDestroy(() => { runner.terminate(); log.dispose(); });
</script>

<section class="tab">
  <h1 class="sr-only">{engine === 'pm1' ? 'PM-1 Post machine toolchain demo' : 'TM-1 Turing machine toolchain demo'}</h1>
  <div class="panel-tape">
    <TapesStack bind:this={tapesStackRef} {tapeCount} caretColors={CARET_COLORS}>
      {#snippet actions()}
        <input
          type="file"
          class="visually-hidden"
          data-testid="tape-block-input"
          accept=".pmt,.tmt"
          bind:this={tapeBlockInputEl}
          onchange={(e) => { const el = e.currentTarget; const f = el.files?.[0]; if (f) void onLoadTapeBlock(f); el.value = ''; }}
        />
        <button class="tape-action-btn" type="button" disabled={!tapeBlockEnabled} title="Load tape block" aria-label="Load tape block" onclick={() => tapeBlockInputEl?.click()}>{@html icons.tapeImport}</button>
        <button class="tape-action-btn" type="button" disabled={!tapeBlockEnabled} title="Save tape block" aria-label="Save tape block" onclick={onSaveTapeBlock}>{@html icons.tapeExport}</button>
      {/snippet}
    </TapesStack>

    <div class="panel-enter-clip">
      <ControlPanel bind:this={panelRef} {alphabets} enabled={panelEnabled} {applyVisible} {showTapeLabels} caretColors={CARET_COLORS} {onApply} />
    </div>

    <div class="tape-actions">
      {#if takeControlVisible}
        <button class="take-control" type="button" onclick={takeControl}>{@html icons.takeControl}<span class="btn-label">Take control</span></button>
      {/if}
      <button class="tape-action-btn" type="button" onclick={onCopy} title="Copy tape state" aria-label="Copy tape state">{@html icons.copy}</button>
      <button class="tape-action-btn" type="button" onclick={onPaste} disabled={!pasteEnabled} title="Paste tape state" aria-label="Paste tape state">{@html icons.clipboard}</button>
    </div>

    <Log entries={log.entries} onClear={() => log.clear()} />
  </div>

  <div class="panel-editor">
    <Toolbar
      {executionMode} {loadDisabled} {stepDisabled} {runDisabled} {intervalIsValid}
      examples={engineExamples} {selectedExampleId}
      bind:withPause bind:debugMode bind:intervalText
      onBuild={() => doLoad()} onStep={doStep} onRun={doRun} onStop={stopMachine} onPickExample={pickExample}
      {snippets} {loadedSnippetId} {dirty} {staleBuild}
      {onSaveSnippet} {onSaveChanges} {onLoadSnippet} {onDeleteSnippet} {onRenameSnippet}
      onFormat={() => void onFormat()} onOpenFile={(f) => void onOpenFile(f)} {onSaveFile}
    />
    <div class="status" role="status" aria-live="polite"
      class:error={latestEntry?.kind === 'error'} class:warn={latestEntry?.kind === 'warn'} class:ok={latestEntry?.kind === 'ok'} class:abort={latestEntry?.kind === 'abort'}>
      {latestEntry?.text ?? ''}
    </div>
    <FileTabs active={activeTab} {arch} {kind} {kindSwitchEnabled} onSelect={(t) => { setTab(t); void tick().then(syncIp); }} onKindChange={(k) => void onKindChange(k)} />
    {#await editorPromise}
      <div class="editor-loading">Loading editor…</div>
    {:then Editor}
      {#if activeTab === 'main'}
        <Editor {engine} bind:code onReset={resetCodeToSelected} {resetVisible} {resetTitle} {lang} extensions={mainExtensions} onReady={onMainReady} />
      {:else}
        <Editor {engine} code={stdText} onReset={() => {}} resetVisible={false} lang={stdLang} extensions={stdExtensions} readOnly onReady={onStdReady} />
      {/if}
    {:catch err}
      <div class="editor-error">Failed to load editor: {err.message}</div>
    {/await}
  </div>
</section>

<style>
  /* Layout mirrors MachineView.svelte's .tab / .panel-tape / .panel-editor /
     .tape-actions / .tape-action-btn / .take-control / .editor-loading /
     .editor-error / .status rules — the graph-related rules have no
     counterpart here. */
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

  /* The tape-block file input is reachable only via
     `tapeBlockInputEl.click()`; clip it out of the stack-actions row rather
     than hiding it with `display: none` (which would make it unclickable in
     some engines) — same pattern as Toolbar's open-file input. */
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
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
    &.abort { color: var(--abort); }

    @media (max-width: 768px) {
      display: block;
    }
  }
</style>
