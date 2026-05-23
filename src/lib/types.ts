/* Shared types across worker boundary and UI. Single source of truth. */

import type { Graph as TuringGraph } from '@turing-machine-js/machine';

export type { TuringGraph };

/**
 * State-graph highlight descriptor (machines-demo#10). MachineView derives it
 * from `executionMode` + the latest pause-response data; MachineGraph reads
 * it to light up the `from → edge → to` triple in the rendered SVG.
 *
 * - `fromId: 'idle'` represents the synthetic `idle([idle])` sentinel that
 *   `toMermaid` emits at the entry point. Used in IDLE mode to mark "where
 *   execution would start".
 * - `fromId: number` is an engine `GraphNode.id` — the source state.
 * - `toId: number | null` is the destination state's id (or `null` at halt).
 * - `strong` selects which end of the triple gets the bolder/stronger
 *   accent. Per the (B) rule: `from` strong at `before` pause; `to` strong
 *   at `after` / iter-end pause / IDLE (destination feels current).
 */
export type GraphHighlight = {
  fromId: number | 'idle';
  toId: number | null;
  strong: 'from' | 'to';
  /**
   * True when this highlight reflects a paused-event apply (RUNNING_PAUSED),
   * false for per-iter idle applies (RUNNING_AUTO). MachineGraph uses this
   * to detect cross-pause same-state revisits — pulsing the strong node when
   * the current paused apply lands on the same state as the previous paused
   * apply, even when intermediate idle applies pointed elsewhere
   * (e.g., stateA breakpoint → continue → run through stateB/C → stateA
   * breakpoint fires again). The simpler "previous apply's strong matches"
   * check already covers AUTO self-loops; this flag drives the second pulse
   * trigger.
   */
  paused: boolean;
};

export const ENGINES = ['turing', 'post'] as const;
export type Engine = (typeof ENGINES)[number];

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

/**
 * `symbols` is the tape's full backing array (or a viewport the producer
 * already centered — same shape, different length). `position` is the head
 * index into `symbols`. The blank symbol is sourced separately from the
 * matching alphabet (`alphabets[i][0]`) — snapshots aren't self-describing,
 * but it removes per-snapshot duplication of the alphabet's blank.
 *
 * Two producers:
 * - `machineWorker.ts` on `built` / `ran` / `error`: full tape from user code (no
 *   trim — the main-thread mirror needs every cell so the user can navigate
 *   beyond the initial window without blanks where original symbols should
 *   appear).
 * - `MachineView.svelte#mirrorSnapshots` after each step: viewport-shaped
 *   (length `VIEWPORT_WIDTH`, head at the center index). `Tape.svelte`'s
 *   position-aware indexing handles either uniformly.
 */
export type TapeSnapshot = {
  symbols: string[];
  position: number;
};

/* ───── worker request / response ───── */

export type WorkerRequest =
  | { type: 'build'; engine: Engine; code: string }
  | { type: 'step' }
  | { type: 'run'; maxSteps?: number; debug?: boolean; step?: boolean; intervalMs?: number | null } // step?: true → arm initial state's debug.after so iter 1 pauses at the step-boundary (preserves user-authored debug.before); intervalMs: per-step throttle inside onStep (null/omitted = continuous)
  | { type: 'resume'; step?: boolean; intervalMs?: number | null } // step?: true → advance one iteration, then re-pause; intervalMs: convey the current withPause at Continue time (spec §3 reads withPause at click, not at run-start)
  | { type: 'pause' } // click-pause from RUNNING_AUTO — worker cancels throttle and dispatches a synthetic `paused` from the next onStep
  | { type: 'setDebug'; on: boolean }; // runtime-toggle debug-break pausing during a run

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
  graph: TuringGraph;
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
  /** At least one of `before` / `after` is `true` for user-authored breaks
   * and cold-start step (the armed `.after`). A click-pause from RUNNING_AUTO
   * lands a synthetic `paused` with `debugBreak = {}` — no engine-fired break,
   * the worker dispatched it from inside `onStep` when the user clicked Pause. */
  debugBreak: { before?: true; after?: true };
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
  | ErrorResponse;
