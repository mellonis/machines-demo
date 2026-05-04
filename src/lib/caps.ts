/* Numeric caps shared between the worker and the main thread. Pulled out of
 * types.ts so that file is purely type definitions; these are runtime values
 * that backstop user code (step limit, wall-clock limit), bound the UI
 * (tape count for the caret palette), and pin the rendering window
 * (`VIEWPORT_WIDTH` lives here because the upstream library's `Tape` honors
 * it as a runtime configuration value, not a type-level constant). */

/** Tape rendering window — the upstream `Tape`'s `viewportWidth`. Must be odd
 *  so the head sits at the exact middle (`(VIEWPORT_WIDTH - 1) / 2`). Both
 *  the worker and `Tape.svelte` depend on this being the same number; the
 *  upstream library's `normalise()` pads tape symbols to fill it. */
export const VIEWPORT_WIDTH = 23;

/** Step backstop: `runToEnd` stops here even if the machine hasn't halted,
 *  setting `truncated: true` on the `ran` response. Complements
 *  `WORKER_TIMEOUT_MS` (steps vs. wall-clock). */
export const MAX_STEPS = 100_000;

/** Wall-clock backstop: `MachineRunner` kills the worker if a single request
 *  doesn't reply within this window (handles infinite loops in user code that
 *  never yield, beyond what `MAX_STEPS` catches). */
export const WORKER_TIMEOUT_MS = 5_000;

/** UI-side cap on tape count. `CARET_COLORS` (in `MachineView.svelte`) must
 *  have at least this many entries; the worker rejects loads with more. */
export const MAX_TAPES = 5;
