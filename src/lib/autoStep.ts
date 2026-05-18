export const MIN_AUTO_INTERVAL_MS = 500;

/** Parse "1s" / "1.5s" / "500ms" / "0.5m" → ms, or null if invalid / too small. */
export function parseInterval(str: string): number | null {
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m)?$/i.exec(str.trim());
  if (!match) return null;
  const n = parseFloat(match[1]);
  const unit = (match[2] || 's').toLowerCase();
  const ms = unit === 'ms' ? n : unit === 's' ? n * 1000 : n * 60_000;
  return ms >= MIN_AUTO_INTERVAL_MS ? Math.round(ms) : null;
}

/**
 * Start an auto-stepper. Calls `tick` every `intervalMs`, immediately on start.
 * `tick` is awaited; ticks do not overlap. Returns cleanup.
 */
export function startAutoStep(intervalMs: number, tick: () => Promise<void>): () => void {
  let stopped = false;
  let inFlight = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const run = async (): Promise<void> => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      await tick();
    } finally {
      inFlight = false;
    }
    if (stopped) return;
    timeoutId = setTimeout(run, intervalMs);
  };

  run();

  return () => {
    stopped = true;
    if (timeoutId !== null) clearTimeout(timeoutId);
  };
}
