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
  /** Show the upcoming command on the panel without applying. */
  reflect: (cmd: Command) => void;
  /** Apply the command to the belt and flash the apply button. */
  apply: (cmd: Command) => void;
  /** Read the current alphabet at tick time (lets the loop track changes). */
  getAlphabet: () => readonly string[];
};

/**
 * Start the demo loop. Returns a cleanup function (suits `$effect`).
 *
 * Each tick: reflect the upcoming command, then after DEMO_REFLECT_DELAY_MS
 * apply it. The whole cycle repeats every DEMO_INTERVAL_MS.
 */
export function startDemoLoop(cb: DemoCallbacks): () => void {
  let applyTimer: ReturnType<typeof setTimeout> | null = null;

  const tick = (): void => {
    const cmd = randomCommand(cb.getAlphabet());
    cb.reflect(cmd);
    applyTimer = setTimeout(() => {
      applyTimer = null;
      cb.apply(cmd);
    }, DEMO_REFLECT_DELAY_MS);
  };

  tick();
  const intervalId = setInterval(tick, DEMO_INTERVAL_MS);

  return () => {
    clearInterval(intervalId);
    if (applyTimer !== null) clearTimeout(applyTimer);
  };
}
