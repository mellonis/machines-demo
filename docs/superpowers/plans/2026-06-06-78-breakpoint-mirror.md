# Engine → UI Breakpoint Mirror Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mirror code-set `state.debug` writes in the UI's breakpoint indicators (machines-demo issue [#78](https://github.com/mellonis/machines-demo/issues/78); spec at `docs/superpowers/specs/2026-06-06-78-breakpoint-mirror-design.md`).

**Architecture:** Worker scans engine states once after build for non-empty `state.debug` bits, dedupes wrapper/bare via `bareIdOf`, canonicalizes halt-class negative ids to `0`, and emits one unsolicited `breakpointToggled` response per (stateId, kind) before sending `built`. Main side's existing `runner.onBreakpointToggled` handler at `MachineView.svelte:229` ingests the entries unchanged. Plus a bundled doc backfill for CLAUDE.md / README.md / types.ts that catches up the worker-protocol summaries with PR #76's additions.

**Tech Stack:** TypeScript, Svelte 5 (no Svelte changes here — pure worker side + lib), Vitest, `@turing-machine-js/machine` v7 (`State.collectStates`), `@turing-machine-js/visuals` v7 (`bareIdOf`).

**Prerequisite:** Currently on branch `feat/breakpoint-mirror-78` (spec already committed there). All work in this plan continues on the same branch.

---

## File Map

- **Modify:** `src/lib/breakpointCoordination.ts` — add `scanCanonicalBreakpoints` helper + supporting types
- **Modify:** `src/lib/breakpointCoordination.test.ts` — add a `describe('scanCanonicalBreakpoints', ...)` block with the unit cases
- **Modify:** `src/lib/machineWorker.ts` — wire the scan + emit after `currentGraph` is computed, before `built` is sent (around line 666)
- **Modify:** `src/lib/types.ts` — update `BreakpointToggledResponse` JSDoc to note the unsolicited-on-build trigger
- **Modify:** `CLAUDE.md` § Worker contract — add missing rows + paragraph
- **Modify:** `README.md` lines 70-71 (ASCII diagram) — update requests + responses

No new files; no Svelte component changes.

---

## Task 1: Helper signature + empty-case test

Add the helper's exported type + empty-stub implementation + the empty-graph regression test. This task locks in the API and gets `breakpointCoordination.test.ts` running against the new function.

**Files:**
- Modify: `src/lib/breakpointCoordination.ts`
- Modify: `src/lib/breakpointCoordination.test.ts`

- [ ] **Step 1: Add the type + stub to `src/lib/breakpointCoordination.ts`**

Add at the bottom of the file (after `mergeDebugKinds`):

```ts
import * as turing from '@turing-machine-js/machine';
import type { Graph } from '@turing-machine-js/machine';
import { bareIdOf } from '@turing-machine-js/visuals';

/**
 * One entry per logical breakpoint found by the post-build scan
 * (machines-demo#78). `stateId` is canonicalized: wrapper/bare pairs
 * fold to the bare's id; halt-class negative ids fold to `0`.
 * `before` / `after` mirror the bits of `state.debug.{before,after}`
 * read from the engine; both `false` is never emitted (the helper
 * filters those out).
 */
export type CanonicalBreakpointEntry = {
  stateId: number;
  before: boolean;
  after: boolean;
};

/**
 * Walk the engine's reachable state map (resolved via
 * `State.collectStates`) and surface every state whose `debug` field
 * has a `before` or `after` bit set. Dedupes wrapper/bare pairs via
 * `bareIdOf` (they share a `#debugRef` so emitting twice would be a
 * phantom). Halt-class negative ids canonicalize to `0` to match the
 * existing `toggleBreakpoint` handler's normalization.
 *
 * Inputs are what `machineWorker.ts` already has at the build-completion
 * site: `collectStates`'s map and the captured `Graph`. The helper is
 * pure — no engine mutations, no postMessage.
 *
 * Returns entries with at least one bit set. Empty input → [].
 */
export function scanCanonicalBreakpoints(
  stateMap: Map<number, { state: turing.State }>,
  graph: Graph,
): CanonicalBreakpointEntry[] {
  return [];
}
```

- [ ] **Step 2: Add the empty-case test to `src/lib/breakpointCoordination.test.ts`**

Add at the bottom of the file:

```ts
import { scanCanonicalBreakpoints } from './breakpointCoordination.ts';
import type { Graph } from '@turing-machine-js/machine';

describe('scanCanonicalBreakpoints (machines-demo#78)', () => {
  it('returns [] for an empty state map', () => {
    const stateMap = new Map();
    const graph: Graph = { initialId: 0, alphabets: [[' ']], nodes: {} } as Graph;
    expect(scanCanonicalBreakpoints(stateMap, graph)).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `npm test -- breakpointCoordination`
Expected: all existing `mergeDebugKinds` tests pass + the new empty-case test passes.

- [ ] **Step 4: Verify svelte-check is clean**

Run: `npm run check`
Expected: 0 errors, 0 warnings.

- [ ] **Step 5: Commit**

```sh
git add src/lib/breakpointCoordination.ts src/lib/breakpointCoordination.test.ts
git commit -m "feat(breakpoint-scan): helper skeleton + empty-case test (#78)

scanCanonicalBreakpoints stub returning []. Locks in the API shape:
takes the State map from collectStates and the captured Graph, returns
canonical breakpoint entries. Subsequent commits drive the
implementation via TDD.

Refs #78."
```

---

## Task 2: Single `before` bit on one non-halt state

Drive the basic walk + read. The implementation reads each entry's `state.debug.before` and emits when truthy.

**Files:**
- Modify: `src/lib/breakpointCoordination.ts`
- Modify: `src/lib/breakpointCoordination.test.ts`

- [ ] **Step 1: Add the failing test**

Append inside the `describe('scanCanonicalBreakpoints', ...)` block:

```ts
it('R-scan-before: single state with before bit → one entry', () => {
  const alphabet = new turing.Alphabet([' ', 'a']);
  const tapeBlock = turing.TapeBlock.fromAlphabets([alphabet]);
  const state = new turing.State('s0');
  state.withCommands({
    [tapeBlock.symbol([' '])]: { nextState: turing.haltState },
  });
  state.debug = { before: true };
  const stateMap = turing.State.collectStates(state, tapeBlock);
  const graph = turing.State.toGraph(state, tapeBlock);
  const entries = scanCanonicalBreakpoints(stateMap, graph);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toEqual({ stateId: entries[0].stateId, before: true, after: false });
  expect(entries[0].stateId).toBeGreaterThanOrEqual(0); // non-halt
});
```

Note: `turing` namespace import is already added in Task 1's Step 1. If not, add `import * as turing from '@turing-machine-js/machine';` to the test imports.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- breakpointCoordination`
Expected: the new test fails ("Expected length: 1, Received length: 0").

- [ ] **Step 3: Implement the walk + read**

Replace the stub body in `scanCanonicalBreakpoints` (`src/lib/breakpointCoordination.ts`) with:

```ts
const entries: CanonicalBreakpointEntry[] = [];
for (const [id, { state }] of stateMap) {
  const debug = state.debug;
  if (debug === null || typeof debug !== 'object') continue;
  const before = (debug as { before?: boolean }).before === true;
  const after = (debug as { after?: boolean }).after === true;
  if (!before && !after) continue;
  entries.push({ stateId: id, before, after });
}
return entries;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- breakpointCoordination`
Expected: all tests pass.

- [ ] **Step 5: Lint + types**

Run: `npm run lint && npm run check`
Expected: clean.

- [ ] **Step 6: Commit**

```sh
git add src/lib/breakpointCoordination.ts src/lib/breakpointCoordination.test.ts
git commit -m "feat(breakpoint-scan): walk state map + read before/after bits (#78)

Iterates the collectStates map, reads each state's debug filter
(treating null and missing bits as off), and returns one entry per
state with at least one bit set. No canonicalization yet — wrapper/
bare dedup and halt-class folding come in the next commits.

Refs #78."
```

---

## Task 3: Multi-state + `after`-only + both-kinds regression cases

Add the remaining straightforward unit cases as regression tests. The implementation from Task 2 should make these pass without changes.

**Files:**
- Modify: `src/lib/breakpointCoordination.test.ts`

- [ ] **Step 1: Add the three regression tests**

Append inside the `describe('scanCanonicalBreakpoints', ...)` block:

```ts
it('R-scan-after: single state with after bit → one entry', () => {
  const alphabet = new turing.Alphabet([' ', 'a']);
  const tapeBlock = turing.TapeBlock.fromAlphabets([alphabet]);
  const state = new turing.State('s0');
  state.withCommands({
    [tapeBlock.symbol([' '])]: { nextState: turing.haltState },
  });
  state.debug = { after: true };
  const stateMap = turing.State.collectStates(state, tapeBlock);
  const graph = turing.State.toGraph(state, tapeBlock);
  const entries = scanCanonicalBreakpoints(stateMap, graph);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ before: false, after: true });
});

it('R-scan-both: single state with both bits → one entry, both true', () => {
  const alphabet = new turing.Alphabet([' ', 'a']);
  const tapeBlock = turing.TapeBlock.fromAlphabets([alphabet]);
  const state = new turing.State('s0');
  state.withCommands({
    [tapeBlock.symbol([' '])]: { nextState: turing.haltState },
  });
  state.debug = { before: true, after: true };
  const stateMap = turing.State.collectStates(state, tapeBlock);
  const graph = turing.State.toGraph(state, tapeBlock);
  const entries = scanCanonicalBreakpoints(stateMap, graph);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ before: true, after: true });
});

it('R-scan-multi: multi-state with mixed bits → entry per state', () => {
  const alphabet = new turing.Alphabet([' ', 'a', 'b']);
  const tapeBlock = turing.TapeBlock.fromAlphabets([alphabet]);
  const s2 = new turing.State('s2');
  s2.withCommands({
    [tapeBlock.symbol([' '])]: { nextState: turing.haltState },
  });
  const s1 = new turing.State('s1');
  s1.withCommands({
    [tapeBlock.symbol([' '])]: { nextState: s2 },
  });
  const s0 = new turing.State('s0');
  s0.withCommands({
    [tapeBlock.symbol([' '])]: { nextState: s1 },
  });
  s0.debug = { before: true };
  s2.debug = { after: true };
  // s1 left with debug=null (default)
  const stateMap = turing.State.collectStates(s0, tapeBlock);
  const graph = turing.State.toGraph(s0, tapeBlock);
  const entries = scanCanonicalBreakpoints(stateMap, graph);
  expect(entries).toHaveLength(2);
  const bits = entries.map((e) => ({ before: e.before, after: e.after })).sort((a, b) =>
    a.before === b.before ? Number(a.after) - Number(b.after) : Number(a.before) - Number(b.before)
  );
  expect(bits).toEqual([{ before: false, after: true }, { before: true, after: false }]);
});

it('R-scan-no-debug: states with debug=null → []', () => {
  const alphabet = new turing.Alphabet([' ', 'a']);
  const tapeBlock = turing.TapeBlock.fromAlphabets([alphabet]);
  const state = new turing.State('s0');
  state.withCommands({
    [tapeBlock.symbol([' '])]: { nextState: turing.haltState },
  });
  // no state.debug write
  const stateMap = turing.State.collectStates(state, tapeBlock);
  const graph = turing.State.toGraph(state, tapeBlock);
  expect(scanCanonicalBreakpoints(stateMap, graph)).toEqual([]);
});
```

- [ ] **Step 2: Run the tests to verify they all pass**

Run: `npm test -- breakpointCoordination`
Expected: all pass.

- [ ] **Step 3: Commit**

```sh
git add src/lib/breakpointCoordination.test.ts
git commit -m "test(breakpoint-scan): regression cases — after, both, multi-state, no-debug (#78)

Lock in the trivial after-bit, both-kinds, multi-state, and empty-debug
behavior as regression tests against future refactors. All pass against
the basic walk+read implementation; no production change.

Refs #78."
```

---

## Task 4: Wrapper/bare dedup via `bareIdOf`

When a state and its `withOverriddenHaltState` wrapper share a `#debugRef`, the scan must emit ONE entry under the canonical (bare) id, not one per wrapper.

**Files:**
- Modify: `src/lib/breakpointCoordination.ts`
- Modify: `src/lib/breakpointCoordination.test.ts`

- [ ] **Step 1: Add the failing test**

Append inside the `describe('scanCanonicalBreakpoints', ...)` block:

```ts
it('R-scan-wrapper-dedup: wrapper + bare share debugRef → one entry on bare', () => {
  const alphabet = new turing.Alphabet([' ', 'a']);
  const tapeBlock = turing.TapeBlock.fromAlphabets([alphabet]);
  const bare = new turing.State('foo');
  bare.withCommands({
    [tapeBlock.symbol([' '])]: { nextState: turing.haltState },
  });
  const continuation = new turing.State('cont');
  continuation.withCommands({
    [tapeBlock.symbol([' '])]: { nextState: turing.haltState },
  });
  const wrapper = bare.withOverriddenHaltState(continuation);
  // Setting debug on the wrapper propagates to the bare via #debugRef.
  wrapper.debug = { before: true };
  const stateMap = turing.State.collectStates(wrapper, tapeBlock);
  const graph = turing.State.toGraph(wrapper, tapeBlock);
  const entries = scanCanonicalBreakpoints(stateMap, graph);
  // Even though both wrapper and bare appear in the state map, the
  // canonical entry sits on the bare's id (bareIdOf folds wrapper → bare).
  expect(entries).toHaveLength(1);
  expect(entries[0].before).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- breakpointCoordination`
Expected: this test fails because the current impl emits two entries (one for wrapper, one for bare).

- [ ] **Step 3: Add the dedup logic**

In `src/lib/breakpointCoordination.ts`, replace the loop body in `scanCanonicalBreakpoints` with:

```ts
const seen = new Set<number>();
const entries: CanonicalBreakpointEntry[] = [];
for (const [id, { state }] of stateMap) {
  const debug = state.debug;
  if (debug === null || typeof debug !== 'object') continue;
  const before = (debug as { before?: boolean }).before === true;
  const after = (debug as { after?: boolean }).after === true;
  if (!before && !after) continue;
  // Canonicalize via bareIdOf so wrapper/bare pairs (sharing a
  // #debugRef) emit once on the bare's id.
  const canonicalId = bareIdOf(id, graph);
  if (seen.has(canonicalId)) continue;
  seen.add(canonicalId);
  entries.push({ stateId: canonicalId, before, after });
}
return entries;
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- breakpointCoordination`
Expected: all pass (the multi-state test in Task 3 still passes because non-wrapper ids map to themselves under `bareIdOf`).

- [ ] **Step 5: Commit**

```sh
git add src/lib/breakpointCoordination.ts src/lib/breakpointCoordination.test.ts
git commit -m "feat(breakpoint-scan): dedup wrapper/bare via bareIdOf (#78)

Wrapper and bare share a #debugRef, so a single logical breakpoint
appears in both the wrapper's and the bare's state-map entries. Fold
to the bare's canonical id via bareIdOf (from @turing-machine-js/
visuals) and de-dupe.

Refs #78."
```

---

## Task 5: Halt-class canonicalization

Halt markers and the `haltState` singleton get folded to `stateId: 0`, matching the existing `toggleBreakpoint` handler's normalization at `machineWorker.ts:794ish`.

**Files:**
- Modify: `src/lib/breakpointCoordination.ts`
- Modify: `src/lib/breakpointCoordination.test.ts`

- [ ] **Step 1: Add the failing test**

Append inside the `describe('scanCanonicalBreakpoints', ...)` block:

```ts
it('R-scan-halt-canonical: haltState.debug → entry with stateId 0', () => {
  const alphabet = new turing.Alphabet([' ', 'a']);
  const tapeBlock = turing.TapeBlock.fromAlphabets([alphabet]);
  const state = new turing.State('s0');
  state.withCommands({
    [tapeBlock.symbol([' '])]: { nextState: turing.haltState },
  });
  // Save + restore haltState.debug so this test doesn't leak global state.
  const previous = turing.haltState.debug;
  try {
    turing.haltState.debug = true;
    const stateMap = turing.State.collectStates(state, tapeBlock);
    const graph = turing.State.toGraph(state, tapeBlock);
    const entries = scanCanonicalBreakpoints(stateMap, graph);
    expect(entries).toHaveLength(1);
    expect(entries[0].stateId).toBe(0);
    // haltState debug is a single boolean → we surface it as `before: true`
    // by convention (matches the existing UI which shows one "Pause" toggle).
    expect(entries[0].before).toBe(true);
  } finally {
    turing.haltState.debug = previous;
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- breakpointCoordination`
Expected: fails — current impl `typeof debug !== 'object'` short-circuits on `boolean`, returning [].

- [ ] **Step 3: Implement haltState branch**

In `src/lib/breakpointCoordination.ts`, add the haltState branch before the existing loop body, and fold negative ids to `0`:

```ts
const seen = new Set<number>();
const entries: CanonicalBreakpointEntry[] = [];

// haltState (engine #207) — debug is a single boolean, not a DebugConfig.
// Surface as a `before: true` entry under canonical id 0 (matches the UI's
// single "Pause" toggle for halt and the toggleBreakpoint handler's
// stateId 0 normalization).
if (turing.haltState.debug === true) {
  entries.push({ stateId: 0, before: true, after: false });
  seen.add(0);
}

for (const [id, { state }] of stateMap) {
  const debug = state.debug;
  if (debug === null || typeof debug !== 'object') continue;
  const before = (debug as { before?: boolean }).before === true;
  const after = (debug as { after?: boolean }).after === true;
  if (!before && !after) continue;
  // Negative ids are halt-class markers — fold to 0 (matches the
  // toggleBreakpoint handler at machineWorker.ts).
  const rawId = id < 0 ? 0 : bareIdOf(id, graph);
  if (seen.has(rawId)) continue;
  seen.add(rawId);
  entries.push({ stateId: rawId, before, after });
}
return entries;
```

- [ ] **Step 4: Run the tests**

Run: `npm test -- breakpointCoordination`
Expected: all pass.

- [ ] **Step 5: Lint + types**

Run: `npm run lint && npm run check`
Expected: clean.

- [ ] **Step 6: Commit**

```sh
git add src/lib/breakpointCoordination.ts src/lib/breakpointCoordination.test.ts
git commit -m "feat(breakpoint-scan): halt-class canonicalization (#78)

haltState.debug is a single boolean (engine #207); surface as a
before:true entry under canonical stateId 0 to match the UI's single
'Pause' toggle for halt. Negative ids in the state map (per-call-site
halt markers) also fold to 0. Matches the existing toggleBreakpoint
handler's normalization in machineWorker.ts.

Refs #78."
```

---

## Task 6: Worker wiring — scan + emit after build, before `built`

Hook `scanCanonicalBreakpoints` into the worker's build handler. The scan runs after `currentGraph` is computed and emits one `breakpointToggled` per non-empty bit before the `built` response goes out.

**Files:**
- Modify: `src/lib/machineWorker.ts`

- [ ] **Step 1: Add the import**

At the top of `src/lib/machineWorker.ts`, add `scanCanonicalBreakpoints` and `CanonicalBreakpointEntry` to the existing `./breakpointCoordination.ts` import line (or add the import if it doesn't exist):

```ts
import { scanCanonicalBreakpoints } from './breakpointCoordination.ts';
```

- [ ] **Step 2: Wire the scan + emit**

Find the build-completion site (around `machineWorker.ts:662-672`, currently:

```ts
currentGraph = turing.State.toGraph(
  initialState as turing.State,
  machine!.tapeBlock as unknown as turing.TapeBlock,
) as Graph;
send({
  type: 'built',
  tapes: snapshotTapes(tapes),
  alphabets: snapshotAlphabets(tapes),
  halted: built.halted,
  graph: currentGraph,
});
return;
```

Insert the scan + emit between `currentGraph = ...` and `send({type: 'built', ...})`:

```ts
currentGraph = turing.State.toGraph(
  initialState as turing.State,
  machine!.tapeBlock as unknown as turing.TapeBlock,
) as Graph;

// machines-demo#78: mirror code-set state.debug writes into the UI.
// User code in the worker may have set state.debug programmatically
// during `userFn`. Walk the state map, emit one `breakpointToggled`
// per non-empty bit so the main thread's existing onBreakpointToggled
// handler (MachineView.svelte:229) populates the breakpoints SvelteMap
// before the graph renders.
{
  const stateMap = turing.State.collectStates(
    initialState as turing.State,
    machine!.tapeBlock as unknown as turing.TapeBlock,
  );
  const codeSetBPs = scanCanonicalBreakpoints(stateMap, currentGraph);
  for (const entry of codeSetBPs) {
    if (entry.before) {
      send({ type: 'breakpointToggled', stateId: entry.stateId, kind: 'before', value: 'on' });
    }
    if (entry.after) {
      send({ type: 'breakpointToggled', stateId: entry.stateId, kind: 'after', value: 'on' });
    }
  }
}

send({
  type: 'built',
  tapes: snapshotTapes(tapes),
  alphabets: snapshotAlphabets(tapes),
  halted: built.halted,
  graph: currentGraph,
});
return;
```

- [ ] **Step 3: Verify svelte-check + lint + existing tests**

Run: `npm run check && npm run lint && npm test`
Expected: clean. 160+ tests pass (the existing worker tests don't touch the build-time scan path; they pass because the scan returns [] when no user code sets `state.debug`).

- [ ] **Step 4: Manual smoke**

Run: `npm run dev`
Open `/turing` in a browser. Replace the default code with:

```js
const alphabet = new imports.turing.Alphabet([' ', 'a']);
const tapeBlock = imports.turing.TapeBlock.fromAlphabets([alphabet]);
const s0 = new imports.turing.State('s0');
s0.withCommands({
  [tapeBlock.symbol([' '])]: { nextState: imports.turing.haltState },
});
s0.debug = { before: true };
return new imports.turing.TuringMachine({ tapeBlock, initialState: s0 });
```

Click Build. The `s0` node should render with a breakpoint indicator dot (the same one click-set indicators get).

- [ ] **Step 5: Commit**

```sh
git add src/lib/machineWorker.ts
git commit -m "feat(worker): mirror code-set state.debug writes after build (#78)

Wire scanCanonicalBreakpoints into the build handler. After the Graph
snapshot is captured (and before sending the built response), walk the
state map and emit one breakpointToggled per non-empty bit. Main's
existing onBreakpointToggled handler at MachineView.svelte:229 ingests
them into the breakpoints SvelteMap without changes.

Verified manually: state.debug = { before: true } in user code now
lights up the indicator on Build.

Refs #78."
```

---

## Task 7: Doc backfill — `CLAUDE.md` § Worker contract

Catch up the worker contract documentation in CLAUDE.md with PR #76's additions (`toggleBreakpoint` request, `idle` / `busy` / `breakpointToggled` responses) and #78's expansion of `breakpointToggled`.

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Locate and update the Worker-contract table**

Find the "## Worker contract" section (search for `| Request | Response |` table). Add two new rows to the request column and three to the response column.

The current table reads:

```
| Request | Response |
|---|---|
| `{ type: 'build', engine, code }` | `{ type: 'built', tapes, alphabets, halted }` |
| `{ type: 'step' }` | `{ type: 'stepped', halted, commands, nextCommands, stepsApplied }` |
| `{ type: 'run', maxSteps?, debug?, step? }` | `{ type: 'ran', tapes, truncated, commands, startStep, stepsApplied }` (or interleaved `paused`s, see below) |
| `{ type: 'resume', step? }` | `paused` (next break) or `ran` (halt) |
| `{ type: 'setDebug', on }` | (no response — fire-and-forget; flips worker-side `debugEnabled` flag) |
```

Replace with:

```
| Request | Response |
|---|---|
| `{ type: 'build', engine, code }` | `{ type: 'built', tapes, alphabets, halted, graph }` (preceded by 0..N unsolicited `breakpointToggled` for code-set `state.debug` — see "Bidirectional breakpoints" below) |
| `{ type: 'step' }` | `{ type: 'stepped', halted, commands, nextCommands, stepsApplied }` |
| `{ type: 'run', maxSteps?, debug?, step?, intervalMs? }` | `{ type: 'ran', tapes, truncated, commands, startStep, stepsApplied }` (or interleaved `paused`s, see below) |
| `{ type: 'resume', step?, intervalMs? }` | `paused` (next break) or `ran` (halt) |
| `{ type: 'pause' }` | (no response — fire-and-forget; cancels auto-mode throttle, triggers a synthetic `paused` from the next `onStep`) |
| `{ type: 'setDebug', on }` | (no response — fire-and-forget; flips worker-side `debugEnabled` flag) |
| `{ type: 'toggleBreakpoint', stateId, kind }` | `{ type: 'breakpointToggled', stateId, kind, value: 'on' \| 'off' }` (echo after the worker mutates `state.debug`) |
| (none — auto-mode throttle gate) | `{ type: 'idle' }` / `{ type: 'busy' }` (sent by `onIter` during RUNNING_AUTO to signal whether the throttle is open) |
```

- [ ] **Step 2: Add a Bidirectional-breakpoints paragraph**

Add a paragraph below the table (or at the end of the section) titled `**Bidirectional breakpoints (machines-demo#37, #78).**`:

```markdown
**Bidirectional breakpoints (machines-demo#37, #78).** Two paths set `state.debug`:

- **UI → engine** (PR #76, scope option 1). User clicks a state node in the graph; main sends `toggleBreakpoint { stateId, kind }`; worker mutates `state.debug` via `mergeDebugKinds` and echoes `breakpointToggled { stateId, kind, value }`.
- **Engine → UI** (PR for #78, scope option 2/3). User code sets `state.debug` programmatically; the worker scans the state map once after build (via `scanCanonicalBreakpoints`), dedupes wrapper/bare via `bareIdOf`, canonicalizes halt-class negative ids to `0`, and emits one **unsolicited** `breakpointToggled` per non-empty bit *before* the `built` response. Main's `runner.onBreakpointToggled` at `MachineView.svelte:229` handles both echo and unsolicited paths identically — the indicator dot in the graph reflects the engine's actual `state.debug` state regardless of which direction set it.

Mid-run scans are deliberately omitted: user code in the worker runs exactly once per build (`new Function(...)` at `machineWorker.ts:285-289`), so there's no realistic path for `state.debug` to change between iters.
```

- [ ] **Step 3: Verify the file still renders cleanly**

Open `CLAUDE.md` and skim the Worker contract section. Make sure the table aligns (markdown table syntax is sensitive to row-length consistency).

- [ ] **Step 4: Commit**

```sh
git add CLAUDE.md
git commit -m "docs(CLAUDE.md): backfill worker contract — toggleBreakpoint, idle/busy, breakpointToggled (#78)

Catches up the worker-contract table with PR #76's additions
(toggleBreakpoint request, breakpointToggled response, idle/busy
auto-mode throttle gates) and adds a Bidirectional-breakpoints
paragraph explaining the two paths into state.debug and the
unsolicited-on-build emit added in this PR.

Refs #78."
```

---

## Task 8: Doc backfill — `README.md` ASCII protocol summary

The architecture-diagram protocol summary in README has the same drift as CLAUDE.md.

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the protocol summary lines**

Find lines 70-71 (the comma-separated requests + responses lists in the ASCII architecture block). Replace:

```
        requests:   build / step / run / resume / setDebug
        responses:  built / stepped / ran / paused / error
```

with:

```
        requests:   build / step / run / resume / pause / setDebug / toggleBreakpoint
        responses:  built / stepped / ran / paused / idle / busy / breakpointToggled / error
```

- [ ] **Step 2: Verify the surrounding ASCII art still aligns**

The protocol lines sit inside a box-drawn architecture diagram. Make sure column widths still line up after the additions; adjust spacing if needed.

- [ ] **Step 3: Commit**

```sh
git add README.md
git commit -m "docs(README): backfill worker protocol summary (#78)

Catch up the architecture-diagram protocol lists with PR #76's
additions (pause, toggleBreakpoint, idle, busy, breakpointToggled).

Refs #78."
```

---

## Task 9: Doc backfill — `types.ts` `BreakpointToggledResponse` JSDoc

The inline JSDoc on the response type currently says it's an echo for `toggleBreakpoint`. Add a note about the unsolicited-on-build trigger.

**Files:**
- Modify: `src/lib/types.ts`

- [ ] **Step 1: Locate `BreakpointToggledResponse`**

Around line 262 in `src/lib/types.ts`:

```ts
/**
 * Echo of a `toggleBreakpoint` request after the worker mutates
 * `state.debug` (machines-demo#37 layer 1). `value` is the new state of the
 * ...
 * indicator dot in the rendered graph reflects the engine's actual state.
 */
export type BreakpointToggledResponse = {
  type: 'breakpointToggled';
  stateId: number;
  kind: BreakpointKind;
  value: 'on' | 'off';
};
```

- [ ] **Step 2: Expand the JSDoc**

Append a paragraph to the JSDoc block describing the unsolicited trigger:

```ts
/**
 * Echo of a `toggleBreakpoint` request after the worker mutates
 * `state.debug` (machines-demo#37 layer 1). `value` is the new state of the
 * ...
 * indicator dot in the rendered graph reflects the engine's actual state.
 *
 * Also fired **unsolicited** per non-empty `state.debug` bit found by the
 * worker's post-build scan (machines-demo#78). When user code in the
 * worker writes `state.debug = { before: true }` programmatically, the
 * worker walks the state map after build (via `scanCanonicalBreakpoints`)
 * and emits one of these per (stateId, kind) before sending `built`. The
 * main thread treats both triggers identically — the indicator lights up
 * regardless of whether the click or the code set the breakpoint.
 */
```

- [ ] **Step 3: Verify svelte-check + lint**

Run: `npm run check && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```sh
git add src/lib/types.ts
git commit -m "docs(types): note unsolicited trigger for breakpointToggled (#78)

The response was previously documented only as an echo for
toggleBreakpoint. Now it also fires per state.debug bit found by the
worker's post-build scan — main handles both identically.

Refs #78."
```

---

## Task 10: Push + open PR

Wrap up.

- [ ] **Step 1: Push the branch**

Run: `git push -u origin feat/breakpoint-mirror-78`
Expected: branch created on origin.

- [ ] **Step 2: Open the PR**

Run:

```sh
gh pr create --base master --title "feat: bidirectional breakpoint sync — engine → UI mirror (#78)" --body "$(cat <<'EOF'
## Summary

Closes #78. Implements scope option 2/3 from #37 — mirroring code-set \`state.debug\` writes back into the UI's breakpoint indicators.

After build, the worker walks the engine state map via \`State.collectStates\`, dedupes wrapper/bare pairs via \`bareIdOf\`, canonicalizes halt-class negative ids to \`0\`, and emits one **unsolicited** \`breakpointToggled\` response per non-empty \`state.debug\` bit *before* sending the \`built\` response. Main's existing \`runner.onBreakpointToggled\` handler at \`MachineView.svelte:229\` ingests them unchanged.

User code in the worker that does \`state.debug = { before: true };\` now lights up the indicator dot on the graph, matching what a UI click would produce.

Spec: \`docs/superpowers/specs/2026-06-06-78-breakpoint-mirror-design.md\`.

## Bundled doc backfill

PR #76's additions to the worker protocol (\`toggleBreakpoint\` request, \`breakpointToggled\` / \`idle\` / \`busy\` responses) never made it into the documentation surfaces that summarize the protocol. This PR catches them up:

- \`CLAUDE.md\` § Worker contract — full table + a Bidirectional-breakpoints paragraph
- \`README.md\` lines 70-71 (ASCII diagram) — protocol summary
- \`src/lib/types.ts\` \`BreakpointToggledResponse\` JSDoc — unsolicited-trigger note

## Test plan

- [x] \`npm run check\` clean
- [x] \`npm run lint\` clean
- [x] \`npm test\` — new \`scanCanonicalBreakpoints\` unit tests pass (empty, before-only, after-only, both kinds, multi-state, wrapper/bare dedup, halt-class canonical, no-debug-writes); existing tests unchanged
- [x] \`npm run build\` clean
- [x] Manual smoke: \`/turing\` with code setting \`state.debug = { before: true }\` shows the indicator dot on Build
- [ ] CI green

Refs #95 unrelated to a11y; this is functional.
EOF
)"
```

Expected: PR URL printed.

- [ ] **Step 3: Report URL**

Capture the PR URL and report it back to the user.

---

## Spec coverage check

Spec section → tasks that implement it:

- **Decisions / Detection cadence: build-time only** → Task 6 (single scan call placed after build, before `built`)
- **Decisions / Visual distinction: same indicator** → no code change (no new visual surface); covered by reusing `breakpointToggled` response shape
- **Decisions / Protocol shape: reuse `breakpointToggled` unsolicited** → Task 6 (worker emits without preceding `toggleBreakpoint`)
- **Components / New pure helper `scanCanonicalBreakpoints`** → Tasks 1-5 (skeleton + walk + dedup + halt canonicalization)
- **Components / Worker wiring** → Task 6
- **Components / Main side: zero changes** → confirmed; no main-side task
- **Edge cases / Re-build clears stale BPs** → no code change required; existing `MachineView.svelte:470-472` handles it
- **Edge cases / Wrapper/bare dedup** → Task 4
- **Edge cases / Halt class** → Task 5
- **Edge cases / Empty machines** → Task 1
- **Edge cases / Mid-run mutations** → out of scope; no task
- **Testing / Unit tests for `scanCanonicalBreakpoints`** → Tasks 1-5 (8 unit cases across the helper tasks)
- **Testing / Integration via existing scenario harness** → **NOT covered.** The spec sketches this; in practice, the scenarioRunner harness uses FakeWorker stubs without running `new Function(...)`, so a true integration test would require new infrastructure. Manual smoke in Task 6 Step 4 fills this gap. If a future refactor makes integration testable, add it then; not blocking this PR.
- **Testing / No new E2E** → confirmed; no task
- **Doc backfill / CLAUDE.md** → Task 7
- **Doc backfill / README.md** → Task 8
- **Doc backfill / types.ts JSDoc** → Task 9
- **Out of scope items** → not implemented (intentional)

The integration-test gap is the only spec-vs-plan deviation. Manual smoke in Task 6 plus the unit tests for the canonicalization logic give reasonable confidence; the worker-side wiring is mechanical and small (one helper call + a loop). Worth noting in the PR description.
