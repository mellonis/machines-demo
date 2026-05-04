import { MOVEMENTS, type Alphabets, type Command } from './types.ts';

export const DEMO_INTERVAL_MS = 1600;
export const DEMO_REFLECT_DELAY_MS = 700;

const KEEP_PROBABILITY = 0.4;

function pickRandom<T>(array: readonly T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

function randomCommand(alphabet: readonly string[]): Command {
  const movement = pickRandom(MOVEMENTS);
  const symbol = Math.random() < KEEP_PROBABILITY ? null : pickRandom(alphabet);
  return { movement, symbol };
}

export type DemoCallbacks = {
  reflect: (commands: Command[]) => void;
  apply: (commands: Command[]) => void;
  getAlphabets: () => Alphabets;
};

/**
 * Demo loop. Returns a cleanup function (suits `$effect`). Per tick: build
 * one random command per tape from its alphabet, reflect on the panel, then
 * apply after DEMO_REFLECT_DELAY_MS. Cycle repeats every DEMO_INTERVAL_MS.
 *
 * Always array-shape — single-tape engines (Post) just see length-1 arrays.
 */
export function startDemoLoop(callbacks: DemoCallbacks): () => void {
  let applyTimeoutId: ReturnType<typeof setTimeout> | null = null;

  const tick = (): void => {
    const commands = callbacks.getAlphabets().map((a) => randomCommand(a));
    callbacks.reflect(commands);
    applyTimeoutId = setTimeout(() => {
      applyTimeoutId = null;
      callbacks.apply(commands);
    }, DEMO_REFLECT_DELAY_MS);
  };

  tick();
  const intervalId = setInterval(tick, DEMO_INTERVAL_MS);

  return () => {
    clearInterval(intervalId);
    if (applyTimeoutId !== null) clearTimeout(applyTimeoutId);
  };
}
