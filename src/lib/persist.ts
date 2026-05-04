import type { Engine } from './types.ts';

const CODE_KEY_PREFIX = 'machines-demo:code:';
const EXAMPLE_KEY_PREFIX = 'machines-demo:example:';
const THEME_KEY = 'machines-demo:theme';

export type Theme = 'system' | 'dark' | 'light';

export function loadTheme(): Theme | null {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'dark' || v === 'light' || v === 'system' ? v : null;
  } catch {
    return null;
  }
}

export function saveTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore */
  }
}

export function loadCode(engine: Engine): string | null {
  try {
    return localStorage.getItem(CODE_KEY_PREFIX + engine);
  } catch {
    return null;
  }
}

export function saveCode(engine: Engine, code: string): void {
  try {
    localStorage.setItem(CODE_KEY_PREFIX + engine, code);
  } catch {
    /* quota or private mode — ignore */
  }
}

export function loadExampleId(engine: Engine): string | null {
  try {
    return localStorage.getItem(EXAMPLE_KEY_PREFIX + engine);
  } catch {
    return null;
  }
}

export function saveExampleId(engine: Engine, id: string): void {
  try {
    localStorage.setItem(EXAMPLE_KEY_PREFIX + engine, id);
  } catch {
    /* ignore */
  }
}
