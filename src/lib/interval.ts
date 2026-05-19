/**
 * Lower bound on the user-pickable RUNNING_AUTO per-step interval. Below this
 * the belt-slide animation (--anim-belt-slide-ms = 400ms in app.css) can't
 * complete between iters; `MachineView.svelte` switches to no-animation
 * rendering for intervals below that threshold (see BELT_ANIMATION_MIN_INTERVAL_MS
 * in caps.ts). Going lower than ~80ms loses too many visible frames even
 * without belt motion and stops feeling like step-by-step execution.
 */
export const MIN_AUTO_INTERVAL_MS = 80;

/** Parse "1s" / "1.5s" / "500ms" / "0.5m" → ms, or null if invalid / too small. */
export function parseInterval(str: string): number | null {
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m)?$/i.exec(str.trim());
  if (!match) return null;
  const n = parseFloat(match[1]);
  const unit = (match[2] || 's').toLowerCase();
  const ms = unit === 'ms' ? n : unit === 's' ? n * 1000 : n * 60_000;
  return ms >= MIN_AUTO_INTERVAL_MS ? Math.round(ms) : null;
}
