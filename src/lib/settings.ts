import { LOG_RENDER_CAP, MAX_STEPS, WORKER_TIMEOUT_MS } from './caps.ts';

/* User-tunable caps, persisted in localStorage under
 * `machines-demo:settings:<key>` (engine-agnostic — these are app-wide).
 * `caps.ts` stays the single source of defaults; this module layers a
 * validated localStorage override on top. Consumers read at use time
 * (`getSetting`), so no reactivity plumbing is needed: a changed value takes
 * effect on the next run / worker request / log flush.
 *
 * Plain TypeScript on purpose (no runes) — `machineRunner.ts` and the
 * node-environment Vitest suites import this without Svelte compilation. */

export type SettingKey = 'maxSteps' | 'workerTimeoutMs' | 'logRenderCap';

export type SettingSpec = {
  default: number;
  min: number;
  max: number;
  /** When true, `Infinity` is also a valid value (input `Infinity` / `∞`).
   *  Only `maxSteps` opts in: an uncapped run stays bounded by the wall-clock
   *  timeout, whereas an Infinity timeout would disable the watchdog and an
   *  Infinity log cap would unbound the DOM. */
  allowInfinity?: boolean;
};

export const SETTING_SPECS: Record<SettingKey, SettingSpec> = {
  maxSteps: { default: MAX_STEPS, min: 100, max: 10_000_000, allowInfinity: true },
  workerTimeoutMs: { default: WORKER_TIMEOUT_MS, min: 1_000, max: 120_000 },
  logRenderCap: { default: LOG_RENDER_CAP, min: 100, max: 50_000 },
};

function storageKey(key: SettingKey): string {
  return `machines-demo:settings:${key}`;
}

function isValid(key: SettingKey, value: number): boolean {
  const spec = SETTING_SPECS[key];
  if (value === Infinity) return spec.allowInfinity === true;
  return Number.isInteger(value) && value >= spec.min && value <= spec.max;
}

/** Current effective value: the stored override when present and valid
 *  (integer within [min, max]), otherwise the `caps.ts` default. Invalid
 *  stored values fall back — no clamping. Read-through on every call:
 *  callers read at use time, which is at most once per log flush. */
export function getSetting(key: SettingKey): number {
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (raw === null) return SETTING_SPECS[key].default;
    const parsed = parseSettingValue(key, raw);
    return parsed ?? SETTING_SPECS[key].default;
  } catch {
    return SETTING_SPECS[key].default;
  }
}

/** Persists a validated value; returns false (persisting nothing) when the
 *  value is not an integer within the spec's [min, max]. */
export function setSetting(key: SettingKey, value: number): boolean {
  if (!isValid(key, value)) return false;
  try {
    localStorage.setItem(storageKey(key), String(value));
  } catch {
    /* quota or private mode — ignore */
  }
  return true;
}

/** Drops the stored override so `getSetting` returns the default again. */
export function resetSetting(key: SettingKey): void {
  try {
    localStorage.removeItem(storageKey(key));
  } catch {
    /* ignore */
  }
}

/** Parses user (or stored) input: a plain non-negative decimal integer
 *  string within the spec's [min, max] → its number; for `allowInfinity`
 *  specs, `Infinity` (any case) and `∞` → Infinity; anything else → null.
 *  The strict digit test rejects fractions, signs, and exponents that
 *  `Number()` would accept. */
export function parseSettingValue(key: SettingKey, raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '∞' || trimmed.toLowerCase() === 'infinity') {
    return isValid(key, Infinity) ? Infinity : null;
  }
  if (!/^\d+$/.test(trimmed)) return null;
  const value = parseInt(trimmed, 10);
  return isValid(key, value) ? value : null;
}
