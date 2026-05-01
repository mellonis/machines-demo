import { MOVEMENTS, type Command } from './types.ts';

export const DEMO_INTERVAL_MS = 1600;
export const DEMO_REFLECT_DELAY_MS = 700;

const KEEP_PROBABILITY = 0.4;

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomCommand(alphabet: readonly string[]): Command {
  const movement = pickRandom(MOVEMENTS);
  const symbol = Math.random() < KEEP_PROBABILITY ? null : pickRandom(alphabet);
  return { movement, symbol };
}

export type DemoCallbacks = {
  reflect: (cmds: Command[]) => void;
  apply: (cmds: Command[]) => void;
  getAlphabets: () => readonly (readonly string[])[];
};

/**
 * Demo loop. Returns a cleanup function (suits `$effect`). Per tick: build
 * one random command per tape from its alphabet, reflect on the panel, then
 * apply after DEMO_REFLECT_DELAY_MS. Cycle repeats every DEMO_INTERVAL_MS.
 *
 * Always array-shape — single-tape engines (Post) just see length-1 arrays.
 */
export function startDemoLoop(cb: DemoCallbacks): () => void {
  let applyTimer: ReturnType<typeof setTimeout> | null = null;

  const tick = (): void => {
    const cmds = cb.getAlphabets().map((a) => randomCommand(a));
    cb.reflect(cmds);
    applyTimer = setTimeout(() => {
      applyTimer = null;
      cb.apply(cmds);
    }, DEMO_REFLECT_DELAY_MS);
  };

  tick();
  const intervalId = setInterval(tick, DEMO_INTERVAL_MS);

  return () => {
    clearInterval(intervalId);
    if (applyTimer !== null) clearTimeout(applyTimer);
  };
}
