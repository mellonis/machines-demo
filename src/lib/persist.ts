import type { Engine } from './types.ts';

const CODE_KEY_PREFIX = 'machines-demo:code:';
const EXAMPLE_KEY_PREFIX = 'machines-demo:example:';

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
