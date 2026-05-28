import type { PausedResponse } from './types.ts';

/**
 * Format the log line for a single `paused` event. Pure function — same
 * inputs always produce the same string. Extracted from MachineView so
 * the scenario harness can assert log lines without standing up the
 * Svelte component.
 *
 * Three cases:
 * 1. Halt-imminent (after-pause where worker tagged `imminentHalt`) —
 *    fires only when halt-BP is on AND the iter's transition resolves to
 *    haltState. Wording: `"paused before halt (after X)"`. "(after X)" is
 *    accurate under the new engine timing (#207): X's iter just ran.
 * 2. Before-pause — surface head symbols (the step-log line for this
 *    iter hasn't landed yet). Encoding matches `formatStepNotation`
 *    byte-for-byte so the pause line + step line use the same glyph
 *    per tape position: wildcard reads always show literal `*='X'`
 *    (showing WHAT the catch-all caught); non-wildcard blank reads
 *    render as `B` when `blanks` is supplied; non-wildcard literals
 *    render as `'X'`.
 * 3. After-pause (no halt-imminent) — drop the symbols suffix; the
 *    step-log line directly above carries `[reads] → [writes]/[moves]`.
 *
 * `blanks` — per-tape blank symbols (from each tape's alphabet[0]).
 * Required for the `B`-vs-`'X'` rendering in case 2 to match the
 * step-log line. Optional for backward compat / call sites that don't
 * have alphabet context.
 */
export function formatPauseLine(
  paused: PausedResponse,
  blanks?: readonly string[],
): string {
  const stateRef = paused.state ? `state ${paused.state}` : 'unnamed state';

  if (paused.pause.side === 'after' && paused.imminentHalt !== undefined) {
    return `paused before halt (after ${paused.state ?? 'unnamed state'})`;
  }

  if (paused.pause.side === 'before') {
    const symbols = paused.currentSymbols
      .map((s, i) => {
        // Wildcard: always show literal `*='X'` — the point of the
        // wildcard marker is to surface WHAT the catch-all caught.
        if (paused.currentMatchKinds?.[i] === 'wildcard') return `*='${s}'`;
        // Non-wildcard: blank → `B` (when `blanks` known), literal → `'X'`.
        return blanks && s === blanks[i] ? 'B' : `'${s}'`;
      })
      .join(',');
    return `paused at ${stateRef} before applying command for symbols: [${symbols}]`;
  }

  return `paused at ${stateRef} after applying command`;
}
