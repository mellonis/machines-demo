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

export type TapeSnapshot = {
  symbols: string[];
  position: number;
  blank: string;
};

/** Hard cap on `run`-mode steps before the worker truncates. */
export const MAX_STEPS = 100_000;

/** Hard cap on a single worker request's wall-clock time. */
export const WORKER_TIMEOUT_MS = 5_000;

/** UI-side cap on tape count (palette has 5 caret colors). */
export const MAX_TAPES = 5;

/* ───── worker request / response ───── */

export type WorkerRequest =
  | { type: 'load'; engine: Engine; code: string }
  | { type: 'step' }
  | { type: 'run'; maxSteps?: number };

/* Multi-tape: every shape is per-tape arrays. N=1 for single-tape machines,
 * N=K for K-tape machines (TapeBlock.fromTapes([...K])). */

export type LoadedResponse = {
  type: 'loaded';
  tapes: TapeSnapshot[];
  alphabets: string[][];
  halted: boolean;
  stepsApplied: number;
  nextCommands: Command[] | null;
};

export type SteppedResponse = {
  type: 'stepped';
  tapes: TapeSnapshot[];
  halted: boolean;
  commands: Command[] | null;
  nextCommands: Command[] | null;
  stepsApplied: number;
};

export type RanResponse = {
  type: 'ran';
  tapes: TapeSnapshot[];
  halted: boolean;
  truncated: boolean;
  commands: Command[][];
  startStep: number;
  stepsApplied: number;
};

export type ErrorResponse = {
  type: 'error';
  message: string;
  stack: string | null;
};

export type WorkerResponse =
  | LoadedResponse
  | SteppedResponse
  | RanResponse
  | ErrorResponse;
