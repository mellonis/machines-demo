import * as turing from '@turing-machine-js/machine';
import { findExample } from './defaultCode.ts';
import { commandsEntry } from './format.ts';
import { computeImminentHalt } from './imminentHalt.ts';
import { formatPauseLine } from './pauseLineFormat.ts';
import type { Engine, PausedResponse, TuringGraph } from './types.ts';

/**
 * Scenario harness for breakpoint + log-line behavior. Drives the engine's
 * `run()` directly with callbacks that mirror the worker's pause-handling
 * logic — so the resulting log trajectory is what the demo's user sees,
 * minus the worker boundary.
 *
 * Purpose: catch bugs in the 4-layer chain (engine pause timing →
 * worker `imminentHalt` derivation → MachineView pause-line formatter →
 * step-log formatter) before they ship. Unit tests on individual layers
 * miss interaction bugs; this harness snapshots the whole trajectory.
 *
 * Phase 1 (this module): records log lines only — pause lines + step
 * lines — in the order MachineView would emit them. Highlight ops are
 * out of scope for v1; the existing rule tests in `applyHighlight.test.ts`
 * still cover those at the rule level.
 *
 * What the harness reproduces:
 * - Per-iter dispatch order `before → step → after → onIter`
 * - Worker's `imminentHalt` computation at the after-side (gated on
 *   `haltState.debug === true`)
 * - Worker's `currentMatchKinds` capture from `m.matchedTransition.matchKinds`
 * - MachineView's `formatPauseLine` for pause entries
 * - MachineView's `commandsEntry` for step entries
 *
 * What it does NOT do:
 * - Worker boundary (no `postMessage`); the engine runs in-process
 * - GraphHighlight derivation + applyHighlight ops (Phase 2)
 * - UI state (executionMode, RUNNING_PAUSED, etc.)
 * - Tape rendering / mirror replay
 * - localStorage / snippets / theme
 *
 * Cleanup: tests must clear `turing.haltState.debug` (a global singleton)
 * between scenarios — the harness sets it from the BP config, and
 * subsequent runs would see the prior value otherwise. A helper
 * `clearHaltDebug()` is exported for this.
 */

/** Per-state breakpoint config. Keyed by State name (the `name` field
 *  on the State instance, e.g. `'walkToBlank'` or `'walkToBlank(writeMarker)'`
 *  for wrappers). */
export type StateBPConfig = { before?: boolean; after?: boolean };

export type ScenarioBPConfig = {
  /** Per-state BPs. State names must match the engine's `state.name`
   *  exactly (incl. composite wrapper names like `'walkToBlank(writeMarker)'`). */
  states?: Record<string, StateBPConfig>;
  /** Halt-BP — `haltState.debug = boolean` (turing-machine-js#207). */
  halt?: boolean;
};

export type ScenarioInput = {
  engine: Engine;
  /** Example id from `defaultCode.ts` (e.g. `'callable-subtree'`). */
  exampleId: string;
  bp: ScenarioBPConfig;
  /** Override the example's default tape. Single-tape only (current
   *  scenarios). Pass nothing to use the example's built-in tape. */
  tapeSymbols?: string[];
  /** Engine `stepsLimit`. Default 100. */
  maxSteps?: number;
};

export type ScenarioLogEntry =
  | { kind: 'pause'; text: string }
  | { kind: 'step'; text: string };

export type ScenarioOutput = {
  /** Ordered log entries in MachineView emission order. */
  logs: ScenarioLogEntry[];
  /** True when the run reached halt naturally (not stepsLimit). */
  halted: boolean;
  /** Total iters that executed. */
  steps: number;
};

/** Clear the process-wide haltState.debug flag. Call between scenarios
 *  in test teardown. */
export function clearHaltDebug(): void {
  (turing.haltState as { debug: boolean }).debug = false;
}

/**
 * Run a scenario. Returns the captured log trajectory.
 *
 * The function configures BPs, runs the engine, and records each pause +
 * step line. It does NOT reset BPs on exit — the caller is responsible
 * (use `clearHaltDebug()` for halt; per-state BPs disappear with the
 * State instances on next scenario's machine rebuild).
 */
export async function runScenario(input: ScenarioInput): Promise<ScenarioOutput> {
  const example = findExample(input.engine, input.exampleId);
  if (!example) {
    throw new Error(`scenario: example '${input.exampleId}' not found for engine '${input.engine}'`);
  }

  // Build the machine from the example's source. Same `new Function` pattern
  // the worker uses, minus the worker boundary. User code receives the
  // engine imports under `imports`.
  if (input.engine !== 'turing') {
    throw new Error(`scenario: only 'turing' engine supported (got '${input.engine}')`);
  }
  const userFn = new Function('imports', example.code) as (i: Record<string, unknown>) => unknown;
  const built = userFn({ ...turing }) as {
    machine: turing.TuringMachine;
    initialState?: turing.State;
  } | null | undefined;
  if (!built || typeof built !== 'object') {
    throw new Error('scenario: user code must return { machine, initialState? }');
  }

  const machine = built.machine;
  const initialState = built.initialState
    ?? ((machine as unknown as { initialState?: turing.State }).initialState);
  if (!initialState) {
    throw new Error('scenario: example did not provide initialState (and machine.initialState is unset)');
  }

  // Override tape symbols if requested. Single-tape only for v1.
  if (input.tapeSymbols !== undefined) {
    const tapes = (machine.tapeBlock as unknown as { tapes: turing.Tape[] }).tapes;
    if (tapes.length !== 1) {
      throw new Error(`scenario: tapeSymbols override requires single-tape (got ${tapes.length})`);
    }
    const alphabet = tapes[0].alphabet;
    machine.tapeBlock.replaceTape(new turing.Tape({ alphabet, symbols: input.tapeSymbols }));
  }

  // Engine `Graph` snapshot — passed to computeImminentHalt for frame-id
  // resolution. Built once before the run.
  const currentGraph = turing.State.toGraph(initialState, machine.tapeBlock) as unknown as TuringGraph;

  // Per-tape alphabet symbols (single-tape today; commandsEntry needs the
  // blank symbol at index 0 for the `B`/`E` rendering).
  const tapes = (machine.tapeBlock as unknown as { tapes: turing.Tape[] }).tapes;
  const alphabets = tapes.map((t) => [...t.alphabet.symbols]);

  // Configure per-state BPs by walking the graph for State instances by name.
  // `State.collectStates` returns the live State instances keyed by graph id.
  const stateMap = turing.State.collectStates(initialState, machine.tapeBlock);
  for (const [stateName, bp] of Object.entries(input.bp.states ?? {})) {
    let found = false;
    for (const entry of stateMap.values()) {
      if (entry.state.name === stateName) {
        entry.state.debug = bp as turing.State['debug'];
        found = true;
      }
    }
    if (!found) {
      throw new Error(`scenario: no State found with name '${stateName}' in '${input.exampleId}'`);
    }
  }

  // Halt-BP (turing-machine-js#207: boolean).
  (turing.haltState as { debug: boolean }).debug = input.bp.halt === true;

  // Tracking: prev state id (for before-pause's prevStateId), step counter.
  let stepsApplied = 0;
  const logs: ScenarioLogEntry[] = [];

  // The worker's onPauseFn equivalent — builds a PausedResponse-shaped
  // payload and feeds it to formatPauseLine.
  function emitPauseLine(m: turing.MachineState): void {
    const imminentHalt = computeImminentHalt({
      // Engine's MachineState.state has its `getSymbol`/`getNextState`
      // typed against the concrete `TapeBlock`; computeImminentHalt's
      // signature uses `unknown` to keep the pure-function module
      // engine-import-free. Cast is safe — runtime structure matches.
      m: m as unknown as Parameters<typeof computeImminentHalt>[0]['m'],
      tapeBlock: machine.tapeBlock,
      currentGraph,
      haltStateDebug: turing.haltState.debug === true,
    });
    // Wrapper → bare name collapse, mirroring the worker's resolveDisplayName.
    // Keeps the harness's pause-line strings consistent with what the demo
    // actually emits.
    const sourceNode = currentGraph.nodes[m.state.id];
    const displayedName = sourceNode?.isWrapper && sourceNode.bareStateId !== null
      ? (currentGraph.nodes[sourceNode.bareStateId]?.name ?? m.state.name ?? '')
      : (m.state.name ?? '');
    // Minimal PausedResponse shape — only fields formatPauseLine reads.
    const paused = {
      type: 'paused' as const,
      tapes: [], commands: [], reads: [], matchKinds: [],
      currentStateId: m.state.id,
      nextStateId: null,
      prevStateId: null,
      stepsApplied,
      state: displayedName,
      currentSymbols: [...m.currentSymbols],
      currentMatchKinds: [...m.matchedTransition.matchKinds],
      debugBreak: { ...m.debugBreak },
      imminentHalt,
    } as unknown as PausedResponse;
    const blanks = alphabets.map((a) => a[0] ?? '');
    logs.push({ kind: 'pause', text: formatPauseLine(paused, blanks) });
  }

  // The MachineView equivalent — captures the step log line for iter K.
  function emitStepLine(m: turing.MachineState): void {
    // commandsEntry constructs the same `step N: [reads] → [writes]/[moves]`
    // shape the demo emits per iter.
    const reads = [...m.currentSymbols];
    const matchKinds = [...m.matchedTransition.matchKinds];
    // Per-tape commands derived from movements + nextSymbols, mirroring
    // commandsFromYield in workerHelpers.
    const commands = m.movements.map((mv, i) => {
      const movement = mv === turing.movements.left ? 'L'
        : mv === turing.movements.right ? 'R'
        : 'S';
      const written = m.nextSymbols[i];
      const before = m.currentSymbols[i];
      return { movement, symbol: written === before ? null : written };
    });
    const entry = commandsEntry(
      reads, commands as never, alphabets, { stepNumber: stepsApplied + 1 },
      undefined, matchKinds,
    );
    logs.push({ kind: 'step', text: entry.text });
  }

  await machine.run({
    initialState,
    stepsLimit: input.maxSteps ?? 100,
    onStep: (m) => {
      // Per-iter lifecycle: `before → step → after → onIter`. `onStep`
      // fires mid-iter, between before-pause and after-pause. We log the
      // step line at this moment to match MachineView's log ordering.
      emitStepLine(m);
      stepsApplied += 1;
    },
    onPause: (m) => {
      emitPauseLine(m);
    },
  });

  return {
    logs,
    halted: true, // engine's run() returns when halted (no error)
    steps: stepsApplied,
  };
}
