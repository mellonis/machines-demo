import type { Engine } from './types.ts';

const KEY_PREFIX = 'machines-demo:code:';

export function loadCode(engine: Engine): string | null {
  try {
    return localStorage.getItem(KEY_PREFIX + engine);
  } catch {
    return null;
  }
}

export function saveCode(engine: Engine, code: string): void {
  try {
    localStorage.setItem(KEY_PREFIX + engine, code);
  } catch {
    /* quota or private mode — ignore */
  }
}
