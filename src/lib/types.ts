/* Shared types across worker boundary and UI. Single source of truth. */

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
  | { type: 'run'; maxSteps?: number };

/* Multi-tape: every shape is per-tape arrays. N=1 for single-tape machines,
 * N=K for K-tape machines (TapeBlock.fromTapes([...K])). */

export type BuiltResponse = {
  type: 'built';
  tapes: TapeSnapshot[];
  alphabets: string[][];
  halted: boolean;
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
  nextCommands: Command[] | null;
  stepsApplied: number;
};

export type RanResponse = {
  type: 'ran';
  tapes: TapeSnapshot[];
  truncated: boolean;
  commands: Command[][];
  startStep: number;
  stepsApplied: number;
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
  | ErrorResponse;
