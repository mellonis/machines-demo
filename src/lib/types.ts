/* Shared types across worker boundary and UI. Single source of truth.
 * Graph + GraphHighlight + TapeSnapshot come from `@turing-machine-js/visuals` /
 * `@turing-machine-js/machine` — consumers import from those packages directly. */

import type { Graph } from '@turing-machine-js/machine';
import type { TapeSnapshot } from '@turing-machine-js/visuals';

export const ENGINES = ['turing', 'post'] as const;
export type Engine = (typeof ENGINES)[number];

export type Route =
  | { kind: 'landing' }
  | { kind: 'engine'; engine: Engine };

export const MOVEMENTS = ['L', 'S', 'R'] as const;
export type Movement = (typeof MOVEMENTS)[number];

/**
 * `symbol === null` means "keep current" — the resolved symbol equals
 * what was already under the head, so no effective write.
 */
export type Command = {
  movement: Movement;
  symbol: string | null;
};

/**
 * Per-tape alphabets — outer length = tape count, inner = symbols where
 * index 0 is the blank. Both levels are `readonly` because alphabets are
 * immutable inputs from the worker, never mutated UI-side.
 */
export type Alphabets = readonly (readonly string[])[];

/* ───── worker request / response ───── */

export type WorkerRequest =
  | { type: 'build'; engine: Engine; code: string }
  | { type: 'step' }
  | { type: 'run'; maxSteps?: number; debug?: boolean; step?: boolean; intervalMs?: number | null } // step?: true → arm initial state's debug.after so iter 1 pauses at the step-boundary (preserves user-authored debug.before); intervalMs: per-step throttle inside onStep (null/omitted = continuous)
  | { type: 'resume'; step?: boolean; intervalMs?: number | null } // step?: true → advance one iteration, then re-pause; intervalMs: convey the current withPause at Continue time (spec §3 reads withPause at click, not at run-start)
  | { type: 'pause' } // click-pause from RUNNING_AUTO — worker cancels throttle and dispatches a synthetic `paused` from the next onStep
  | { type: 'setDebug'; on: boolean } // runtime-toggle debug-break pausing during a run
  | { type: 'toggleBreakpoint'; stateId: number; kind: BreakpointKind }; // machines-demo#37: flip `state.debug.before` or `state.debug.after` on the State whose engine GraphNode.id matches `stateId`. Worker merges with the OTHER kind's current bit so toggling one doesn't clobber the other; resolves via `State.collectStates`. Main thread reflects the new state in the UI via the `breakpointToggled` response.

export type BreakpointKind = 'before' | 'after';

/* Multi-tape: every shape is per-tape arrays. N=1 for single-tape machines,
 * N=K for K-tape machines (TapeBlock.fromTapes([...K])). */

export type BuiltResponse = {
  type: 'built';
  tapes: TapeSnapshot[];
  alphabets: string[][];
  halted: boolean;
  /**
   * Engine-v7 `Graph` snapshot for the assembled state graph, computed once
   * at Build via `State.toGraph(initialState, tapeBlock)` (machines-demo#9).
   * Main thread feeds this to `toMermaid(graph)` for SVG rendering. The
   * Graph type is JSON-serializable — safe to send across the worker
   * boundary. `null` when build failed (the `error` response is used in
   * that case, but typing it as nullable keeps the field uniform).
   */
  graph: Graph;
};

/**
 * `stepped` deliberately omits `tapes` — the main-thread `mirrorMachine`
 * applies the same `commands` and is the source of truth for tape rendering
 * (deterministic given identical commands). Initial tape comes from `built`,
 * post-run tape from `ran`, and a partial tape from `error` if a step / run
 * threw mid-flight.
 */
export type SteppedResponse = {
  type: 'stepped';
  halted: boolean;
  commands: Command[] | null;
  /**
   * Per-tape symbols read at each head BEFORE this step applied. Parallel to
   * `commands`; one entry per tape. Drives `[reads] → [writes]/[moves]`
   * edge-label-style log rendering (machines-demo#69). `null` when
   * `commands` is `null` (halted, no step ran).
   */
  reads: string[] | null;
  /**
   * Per-tape match kind for the firing alternative's selector at each head
   * position (`'wildcard'` iff the engine matched via `ifOtherSymbol` at
   * that position, `'literal'` otherwise). Parallel to `reads`; sourced
   * from `MachineState.matchedTransition.matchKinds`
   * (turing-machine-js#205). Drives the `[*='X']` wildcard read marker
   * in the log. `null` when `commands` is `null` (halted, no step ran).
   */
  matchKinds: ('wildcard' | 'literal')[] | null;
  nextCommands: Command[] | null;
  /**
   * Engine State.id of the state the machine is currently in AFTER this step
   * (i.e., the state that will fire on the next Step click). Drives current-
   * state highlighting in the rendered graph (machines-demo#10). `null` at
   * halt (no further step possible).
   */
  currentStateId: number | null;
  /**
   * Engine State.id of the state that will follow `currentStateId` on the
   * next step. Drives `from + edge + to` triple highlight in the graph
   * (machines-demo#10). `null` at halt or when `currentStateId` is `null`.
   */
  nextStateId: number | null;
  stepsApplied: number;
};

export type RanResponse = {
  type: 'ran';
  tapes: TapeSnapshot[];
  truncated: boolean;
  commands: Command[][];
  /** Per-step, per-tape reads captured before each step. Parallel to `commands`. */
  reads: string[][];
  /** Per-step, per-tape match kinds captured before each step (parallel to
   *  `reads`). Sourced from `MachineState.matchedTransition.matchKinds`
   *  (turing-machine-js#205) — drives the `[*='X']` wildcard read marker. */
  matchKinds: ('wildcard' | 'literal')[][];
  /**
   * Engine State.id of the final state at run end (typically the halt state).
   * Drives the snap-to-result current-state highlight in `RUNNING_CONTINUOUS`
   * mode (machines-demo#10). `null` if the run produced no steps.
   */
  currentStateId: number | null;
  startStep: number;
  stepsApplied: number;
};

/**
 * Sent by the worker when `machine.run({ debug: true, ... })` hit a break
 * point (state.debug or haltState.debug). The main thread responds with a
 * `resume` request (optionally `step: true`) to continue, or terminates the
 * worker via the runner to stop. The worker's `run()` Promise stays pending
 * across paused/resume cycles; only `ran` / `error` complete it.
 */
export type PausedResponse = {
  type: 'paused';
  tapes: TapeSnapshot[];
  /**
   * Per-step commands buffered since the previous `paused` (or since the
   * `run` request started). The main thread replays these in the Log so the
   * user sees the trace leading up to the break; tape state is restored
   * from `tapes` (snap, no animation), same path as `ran`.
   */
  commands: Command[][];
  /** Per-step, per-tape reads captured before each step. Parallel to `commands`. */
  reads: string[][];
  /** Per-step, per-tape match kinds captured before each step (parallel to
   *  `reads`). Sourced from `MachineState.matchedTransition.matchKinds`
   *  (turing-machine-js#205) — drives the `[*='X']` wildcard read marker. */
  matchKinds: ('wildcard' | 'literal')[][];
  /**
   * Engine State.id at the moment of pause — m.state per the engine
   * (machines-demo#10). The "you are here" anchor.
   */
  currentStateId: number | null;
  /**
   * Engine State.id of the state that will follow `currentStateId` on resume.
   * Used to draw the "about-to-fire" outgoing transition triple in `after`-
   * and iter-end pauses (where the last-fired transition is current → next).
   */
  nextStateId: number | null;
  /**
   * Engine State.id of the state the machine was IN BEFORE the current iter
   * began — i.e. the source of the transition that brought us to
   * `currentStateId`. Used to draw the "just-fired" incoming transition
   * triple in `before` pauses (last-fired = prev → current).
   * `null` at the very first iter's before-pause (no prior step) — main
   * thread treats this as the synthetic `idle` sentinel.
   */
  prevStateId: number | null;
  stepsApplied: number;
  /** `m.state.name` — the user's State instance does not cross the boundary. */
  state: string;
  /** Symbol currently under each tape head — per-tape array, length = tape count. */
  currentSymbols: string[];
  /** Per-tape match kind for the iter we're pausing on (the engine's
   *  `matchedTransition.matchKinds` from the current `m` yield). Parallel
   *  to `currentSymbols`, length = tape count. Drives the `[*='X']`
   *  wildcard marker in the pause-line's "for symbols: …" group so it
   *  matches the step-log line for the same iter. */
  currentMatchKinds: ('wildcard' | 'literal')[];
  /** Pause descriptor (mirrors the engine's `m.pause`, engine #102).
   * - `side` — `'before'` / `'after'` for an engine breakpoint pause. ABSENT
   *   for a worker-synthesized boundary (a Step-button stop or a click-pause
   *   from RUNNING_AUTO), which has no before/after timing — formatPauseLine
   *   renders those as the generic "after applying command" line.
   * - `cause` — `'breakpoint'` (engine `state.debug` / `haltState.debug`),
   *   `'step'` (Step-button synthetic), or `'manual'` (click-pause synthetic). */
  pause: { side?: 'before' | 'after'; cause: 'breakpoint' | 'step' | 'manual' };
  /**
   * Set on an `after`-pause whose iter's transition leads to haltState
   * AND `haltState.debug === true` (the user armed the halt-BP). Drives
   * the "paused before halt (after X)" wording in MachineView's
   * `formatPauseLine`. See `lib/imminentHalt.ts` for the gating rules.
   *
   * `kind: 'real'` — terminal halt (the run will end after this iter).
   * `kind: 'in-frame'` — the source is inside a callable subtree wrapper;
   *   the engine will pop the halt-stack and resume at the wrapper's
   *   continuation. `haltMarkerId` is the GraphNode.id of the in-frame
   *   halt marker (negative; `= -frameId`).
   *
   * Highlight projection was previously driven from this field (the
   * deleted §7' rule in `applyHighlight.ts`), but under the new engine
   * timing (turing-machine-js#207, halt-imminent on AFTER side) the
   * standard §3 + §7 rules naturally show the right thing at the right
   * moment; this field is purely a wording cue now.
   */
  imminentHalt?: { kind: 'real' } | { kind: 'in-frame'; haltMarkerId: number };
};

/**
 * Bracket notifications the worker sends around each per-step throttle in
 * RUNNING_AUTO. They suspend `WORKER_TIMEOUT_MS` while the worker is idle in
 * `setTimeout(intervalMs)` (intervals above the 5s timeout are normal), AND
 * carry the iter's just-applied commands so the main thread can animate the
 * belt, reflect on the control panel, and log per-iter entries at the cadence
 * (matching the old `runner.step()`-driven path). Neither completes the run
 * Promise; they only toggle the timer + drive per-iter UI.
 *
 * `commands` is `Command[][]` for protocol consistency with `paused.commands`
 * and `ran.commands`; in steady state the outer array has length 1.
 */
export type IdleResponse = {
  type: 'idle';
  commands: Command[][];
  /** Per-step, per-tape reads captured before each step. Parallel to `commands`. */
  reads: string[][];
  /** Per-step, per-tape match kinds captured before each step (parallel to
   *  `reads`). Sourced from `MachineState.matchedTransition.matchKinds`
   *  (turing-machine-js#205) — drives the `[*='X']` wildcard read marker. */
  matchKinds: ('wildcard' | 'literal')[][];
  /**
   * Engine State.id of the state about to fire on the next iteration
   * (post-throttle resume) — i.e. m.state after the just-applied iter.
   * Drives the `from + edge + to` triple highlight per iter during
   * `RUNNING_AUTO` (machines-demo#10), strong on FROM (= m.state, "you
   * are here looking forward"). `null` if the run halted.
   */
  currentStateId: number | null;
  /**
   * Engine State.id of the state that will follow `currentStateId` on the
   * next iter. Drives the `to` end of the per-iter triple highlight in
   * `RUNNING_AUTO` (machines-demo#10). `null` at halt or when
   * `currentStateId` is `null`.
   */
  nextStateId: number | null;
  stepsApplied: number;
};
export type BusyResponse = { type: 'busy' };

/**
 * Echo of a `toggleBreakpoint` request after the worker mutates
 * `state.debug` (machines-demo#37 layer 1). `value` is the new state of the
 * breakpoint on the targeted `stateId` — `'on'` after toggling a previously-
 * absent breakpoint, `'off'` after toggling a previously-present one. The
 * main thread updates its `breakpointsByStateId` registry on receipt so the
 * indicator dot in the rendered graph reflects the engine's actual state.
 *
 * Also fired **unsolicited** per non-empty `state.debug` bit found by the
 * worker's post-build scan (machines-demo#78). When user code in the
 * worker writes `state.debug = { before: true }` programmatically, the
 * worker walks the state map after build (via `scanCanonicalBreakpoints`)
 * and emits one of these per (stateId, kind) before sending `built`. The
 * main thread treats both triggers identically — the indicator lights up
 * regardless of whether the click or the code set the breakpoint.
 */
export type BreakpointToggledResponse = {
  type: 'breakpointToggled';
  stateId: number;
  kind: BreakpointKind;
  value: 'on' | 'off';
};

export type ErrorResponse = {
  type: 'error';
  message: string;
  /**
   * Partial tape state at the moment of failure. Sent when the worker errored
   * mid-step / mid-run (e.g. no edge in the state graph for the current
   * symbol) so the main thread can mirror the state where execution stuck —
   * otherwise the user would see only the loaded tape and lose every step
   * the worker actually applied before the throw.
   */
  tapes?: TapeSnapshot[];
};

export type WorkerResponse =
  | BuiltResponse
  | SteppedResponse
  | RanResponse
  | PausedResponse
  | IdleResponse
  | BusyResponse
  | BreakpointToggledResponse
  | ErrorResponse;
