import type { Engine } from './types.ts';

const THEME_KEY = 'machines-demo:theme';

function engineKey(engine: Engine, suffix: string): string {
  return `machines-demo:${engine}:${suffix}`;
}

export type Snippet = { title: string; code: string; savedAt: number };
// Keyed by UUID — the UUID is the stable identity; title is user-visible name.
export type Snippets = Record<string, Snippet>;

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
    return localStorage.getItem(engineKey(engine, 'code'));
  } catch {
    return null;
  }
}

export function saveCode(engine: Engine, code: string): void {
  try {
    localStorage.setItem(engineKey(engine, 'code'), code);
  } catch {
    /* quota or private mode — ignore */
  }
}

export function loadExampleId(engine: Engine): string | null {
  try {
    return localStorage.getItem(engineKey(engine, 'example'));
  } catch {
    return null;
  }
}

export function saveExampleId(engine: Engine, id: string): void {
  try {
    localStorage.setItem(engineKey(engine, 'example'), id);
  } catch {
    /* ignore */
  }
}

export function loadSnippets(engine: Engine): Snippets {
  try {
    const v = localStorage.getItem(engineKey(engine, 'snippets'));
    return v ? (JSON.parse(v) as Snippets) : {};
  } catch {
    return {};
  }
}

// Returns { id, snippet } so the caller can sync reactive state without
// duplicating the object. Preserves the UUID on overwrite (matched by title).
export function saveSnippet(
  engine: Engine,
  title: string,
  code: string,
): { id: string; snippet: Snippet } {
  const current = loadSnippets(engine);
  const existingId = Object.entries(current).find(([, s]) => s.title === title)?.[0];
  const id = existingId ?? crypto.randomUUID();
  const snippet: Snippet = { title, code, savedAt: Date.now() };
  try {
    current[id] = snippet;
    localStorage.setItem(engineKey(engine, 'snippets'), JSON.stringify(current));
  } catch {
    /* quota or private mode — ignore */
  }
  return { id, snippet };
}

export function deleteSnippet(engine: Engine, id: string): void {
  try {
    const current = loadSnippets(engine);
    delete current[id];
    localStorage.setItem(engineKey(engine, 'snippets'), JSON.stringify(current));
  } catch {
    /* ignore */
  }
}
