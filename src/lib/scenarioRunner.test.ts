import { describe, test, expect, afterEach } from 'vitest';
import { runScenario, clearHaltDebug } from './scenarioRunner.ts';

/**
 * End-to-end scenario tests for the BP + log-line behavior. These are the
 * authoritative behavioral spec — any change to engine pause timing,
 * worker's `imminentHalt` derivation, or MachineView's pause-line
 * formatter shows up here as a log-line diff.
 *
 * Add a new scenario by writing a new `test(...)` with a (BP config,
 * expected logs) pair. The harness drives the actual engine + the
 * extracted worker / MachineView pure functions; what's asserted is
 * the user-visible log trajectory.
 *
 * Why this matters: per-rule unit tests (applyHighlight.test.ts) cover
 * highlight rule firing with synthetic inputs. They miss bugs where the
 * SOURCE of the highlight input (worker derivation, MachineView wiring)
 * is wrong — like the imminentHalt + state.debug.after conflation that
 * shipped before this harness existed.
 */

describe('scenario: callable-subtree (walkToBlank wrapping writeMarker)', () => {
  // Default example tape is ['a', 'b', 'a']. walkToBlank walks right until
  // the blank, then halts (the wrapper pops to writeMarker, which writes
  // '*' under the head and halts terminally).
  // Total: 5 iters (walkToBlank ×4, writeMarker ×1).

  afterEach(clearHaltDebug);

  test('no BPs — no pause lines; just step lines, halt at end', async () => {
    const result = await runScenario({
      engine: 'turing',
      exampleId: 'callable-subtree',
      bp: {},
    });
    expect(result.steps).toBe(5);
    expect(result.logs.filter((l) => l.kind === 'pause')).toEqual([]);
    expect(result.logs.filter((l) => l.kind === 'step').map((l) => l.text)).toEqual([
      "step 1: [*='a'] → [K='a']/[R]",
      "step 2: [*='b'] → [K='b']/[R]",
      "step 3: [*='a'] → [K='a']/[R]",
      'step 4: [B] → [K=B]/[S]',
      "step 5: [*=' '] → ['*']/[S]",
    ]);
  });

  test('walkToBlank.debug.after only, halt-BP off — every iter gets regular after wording, NO halt-imminent', async () => {
    // Regression: the imminentHalt + state.debug.after conflation. Pre-fix,
    // iter 4's after line read "paused before halt (after walkToBlank)"
    // even though halt-BP wasn't toggled. Post-fix, the line is the regular
    // "paused at state walkToBlank after applying command".
    const result = await runScenario({
      engine: 'turing',
      exampleId: 'callable-subtree',
      bp: { states: { walkToBlank: { after: true } } },
    });
    expect(result.logs.map((l) => `[${l.kind}] ${l.text}`)).toEqual([
      "[step] step 1: [*='a'] → [K='a']/[R]",
      // iter 1's source state is the wrapper 'walkToBlank' (the
      // call site) — its #debugRef is shared with the bare 'walkToBlank' via
      // engine #150, so walkToBlank.after firing also fires here.
      '[pause] paused at state walkToBlank after applying command',
      "[step] step 2: [*='b'] → [K='b']/[R]",
      '[pause] paused at state walkToBlank after applying command',
      "[step] step 3: [*='a'] → [K='a']/[R]",
      '[pause] paused at state walkToBlank after applying command',
      '[step] step 4: [B] → [K=B]/[S]',
      // CRITICAL: regular wording, NOT "paused before halt (after walkToBlank)".
      // Halt-BP is off; this after-pause is purely from state.debug.after.
      '[pause] paused at state walkToBlank after applying command',
      "[step] step 5: [*=' '] → ['*']/[S]",
    ]);
  });

  test('halt-BP only, no state BPs — only halt-imminent lines fire, no per-state after lines', async () => {
    const result = await runScenario({
      engine: 'turing',
      exampleId: 'callable-subtree',
      bp: { halt: true },
    });
    // Halt-imminent fires on iter 4 (walkToBlank's halt-bound transition,
    // in-frame halt → pops to writeMarker) and iter 5 (writeMarker's
    // halt-bound transition, real halt → program-end).
    expect(result.logs.map((l) => `[${l.kind}] ${l.text}`)).toEqual([
      "[step] step 1: [*='a'] → [K='a']/[R]",
      "[step] step 2: [*='b'] → [K='b']/[R]",
      "[step] step 3: [*='a'] → [K='a']/[R]",
      '[step] step 4: [B] → [K=B]/[S]',
      '[pause] paused before halt (after walkToBlank)',
      "[step] step 5: [*=' '] → ['*']/[S]",
      '[pause] paused before halt (after writeMarker)',
    ]);
  });

  test('walkToBlank.debug.after + halt-BP — iter 4 + 5 get halt-imminent wording, other iters get regular after', async () => {
    const result = await runScenario({
      engine: 'turing',
      exampleId: 'callable-subtree',
      bp: { states: { walkToBlank: { after: true } }, halt: true },
    });
    expect(result.logs.map((l) => `[${l.kind}] ${l.text}`)).toEqual([
      "[step] step 1: [*='a'] → [K='a']/[R]",
      '[pause] paused at state walkToBlank after applying command',
      "[step] step 2: [*='b'] → [K='b']/[R]",
      '[pause] paused at state walkToBlank after applying command',
      "[step] step 3: [*='a'] → [K='a']/[R]",
      '[pause] paused at state walkToBlank after applying command',
      '[step] step 4: [B] → [K=B]/[S]',
      // walkToBlank.after fires AND halt-BP fires on iter 4 — single after-pause
      // dispatched, halt-imminent wording wins (writeMarker.after isn't armed,
      // but the per-state BP on walkToBlank also triggers via shared debugRef).
      '[pause] paused before halt (after walkToBlank)',
      "[step] step 5: [*=' '] → ['*']/[S]",
      // Iter 5: writeMarker.after isn't armed → no per-state pause. But halt-BP
      // is on AND iter 5 is halt-bound → halt-imminent fires.
      '[pause] paused before halt (after writeMarker)',
    ]);
  });

  test('walkToBlank.debug.before only — every iter gets the before line with read symbols', async () => {
    const result = await runScenario({
      engine: 'turing',
      exampleId: 'callable-subtree',
      bp: { states: { walkToBlank: { before: true } } },
    });
    expect(result.logs.map((l) => `[${l.kind}] ${l.text}`)).toEqual([
      "[pause] paused at state walkToBlank before applying command for symbols: [*='a']",
      "[step] step 1: [*='a'] → [K='a']/[R]",
      "[pause] paused at state walkToBlank before applying command for symbols: [*='b']",
      "[step] step 2: [*='b'] → [K='b']/[R]",
      "[pause] paused at state walkToBlank before applying command for symbols: [*='a']",
      "[step] step 3: [*='a'] → [K='a']/[R]",
      // Iter 4 reads the blank ' '; matches via the specific `[blankSymbol]`
      // transition (literal, not wildcard) → no `*=` prefix. Blank renders
      // as `B` to match the step-log convention (step 4: [B] → ...).
      '[pause] paused at state walkToBlank before applying command for symbols: [B]',
      '[step] step 4: [B] → [K=B]/[S]',
      // No after-pause (only `before` armed); no halt-imminent (halt-BP off).
      "[step] step 5: [*=' '] → ['*']/[S]",
    ]);
  });
});
