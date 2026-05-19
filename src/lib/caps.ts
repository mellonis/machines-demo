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

/** Belt-slide threshold for RUNNING_AUTO rendering: when the user picks an
 *  auto interval shorter than this, `MachineView.svelte#renderFromMirror`
 *  calls into `Tape.svelte#setFromTape` with `animate=false` so the animations
 *  don't queue (the slide takes ~400ms in CSS; iterating faster than that just
 *  means each new frame snaps in mid-animation, which looks worse than no
 *  animation at all).
 *
 *  Coupling — keep in sync: this value mirrors the `--anim-belt-slide-ms`
 *  custom property in `app.css`. If you raise the belt animation, raise this
 *  alongside it; same direction for lowering. */
export const BELT_ANIMATION_MIN_INTERVAL_MS = 400;

/** Render-view cap: `Log.svelte` only ever renders this many entries.
 *  Anything older lives in the LogStore's non-reactive buffer and is
 *  summarized by a synthetic overflow header. Bounds the DOM cost of a
 *  large-trace flush; configurable in the future via #65. */
export const LOG_RENDER_CAP = 5000;

/** Flush interval for the LogStore's buffer-to-view recompute. `report` /
 *  `appendBatch` push into the buffer synchronously but defer the reactive
 *  `entries` reassignment so N rapid calls within one window coalesce into
 *  one Svelte update / one auto-scroll layout. 16ms ≈ one frame — long
 *  enough to coalesce a bulk dump, short enough that step-by-step still
 *  feels live. */
export const LOG_FLUSH_INTERVAL_MS = 16;
