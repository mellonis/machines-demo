import { loadTheme, saveTheme, type Theme } from './persist.ts';

export type ResolvedTheme = 'dark' | 'light';

const SYSTEM_QUERY = '(prefers-color-scheme: light)';

function systemPrefersLight(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(SYSTEM_QUERY).matches;
}

function resolve(choice: Theme): ResolvedTheme {
  if (choice === 'dark' || choice === 'light') return choice;
  return systemPrefersLight() ? 'light' : 'dark';
}

function applyToDom(resolved: ResolvedTheme): void {
  document.documentElement.setAttribute('data-theme', resolved);
}

// User's choice — saved value, defaulting to 'system'. The DOM attribute is
// the *resolved* theme (always 'dark' | 'light' so CSS selectors match
// without a system-aware fallback path).
class ThemeStore {
  current = $state<Theme>(loadTheme() ?? 'system');
  resolved = $state<ResolvedTheme>(resolve(loadTheme() ?? 'system'));

  constructor() {
    // While 'system' is active, follow OS appearance changes live so the
    // page flips with the OS without requiring a reload.
    const mq = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(SYSTEM_QUERY)
      : null;
    mq?.addEventListener?.('change', () => {
      if (this.current !== 'system') return;
      const next: ResolvedTheme = mq.matches ? 'light' : 'dark';
      this.resolved = next;
      applyToDom(next);
    });
  }

  set(next: Theme): void {
    if (this.current === next) return;
    this.current = next;
    const resolved = resolve(next);
    this.resolved = resolved;
    applyToDom(resolved);
    saveTheme(next);
  }

  /* Cycle order: system → light → dark → system. The icon shown reflects the
     current choice (device-desktop / sun / moon), so each click advances by
     one and the user can read what they're switching from. */
  cycle(): void {
    const order: Theme[] = ['system', 'light', 'dark'];
    const i = order.indexOf(this.current);
    this.set(order[(i + 1) % order.length]);
  }
}

export const theme = new ThemeStore();
