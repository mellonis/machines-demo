# Bidirectional breakpoint sync — engine → UI mirror — design

Tracks: [#78](https://github.com/mellonis/machines-demo/issues/78). Follow-up to [#37](https://github.com/mellonis/machines-demo/issues/37) (parent feature spec) and [PR #76](https://github.com/mellonis/machines-demo/pull/76) (shipped scope option 1 — UI → engine).

## Problem

PR #76 shipped click-to-toggle breakpoints in one direction only: the user clicks a state node, the worker mutates `state.debug` via `toggleBreakpoint`, the worker echoes a `breakpointToggled` response, and the indicator dot renders on the graph. User-typed JS code that sets `state.debug` programmatically in the worker (`state.debug = { before: true };`) fires at runtime via `onPause` — but the graph panel shows no indicator, because the main thread never knew the breakpoint exists. From the student's perspective there's a *"where did my breakpoint go?"* gap when they try the API in code.

This issue covers scope option 2 (read-only mirror — engine → UI) and combines it with option 1 to deliver scope option 3 (bidirectional) from #37's original three-option scope spec.

## Decisions

### Detection cadence: build-time only

User code in this demo runs **exactly once per build** — `new Function('imports', userCode)` at `machineWorker.ts:285-289` constructs the machine. After that, the engine takes over and user code does not run again. There is no realistic execution path where `state.debug` mutates mid-run. The worker therefore scans once, immediately after build completes, before sending the `built` response.

Per-iter / per-pause scanning is deliberately rejected: it would add an `O(|states|)` map walk per engine iteration without addressing any realistic case in this demo. (#78's body sketched per-iter as a defensive option; it's not needed here.)

### Visual distinction: same indicator

Code-set breakpoints render with the same red dot as click-set ones. No filled-vs-hollow distinction, no tooltip branch. Rationale: matches #37's own spec note that having the indicator is the educational value; tracking origin adds protocol surface for low return. Clicking a code-set indicator clears it just like a click-set one (engine setter accepts the write regardless of source).

### Protocol shape: bundle in the `built` response

The worker computes code-set BPs via `scanCanonicalBreakpoints`, then attaches the resulting entries as an optional `codeSetBreakpoints: Array<{stateId, before, after}>` field on the `built` response. The main thread's build success path applies them after `graph` is set and after the UI-clicked-BP replay loop has filtered out their ids — see "Why bundled instead of unsolicited `breakpointToggled`" below.

**Why bundled instead of unsolicited `breakpointToggled` (the initially-shipped design that broke).** The first attempt emitted code-set BPs as separate unsolicited `breakpointToggled` messages preceding `built` (reusing PR #76's echo channel). That broke for two compounding reasons surfaced during smoke testing:

1. **`graph` is null when the unsolicited messages arrive.** Main's `onBreakpointToggled` handler at `MachineView.svelte:229` calls `bareIdOf(data.stateId, graph)` to canonicalize. `bareIdOf` is null-safe (returns the raw id when graph is null), so the map gets populated with the worker-emitted canonical id — fine on its own. But:
2. **The UI-clicked-BP replay loop double-toggles them OFF.** When `built` arrives and the build success path runs, the replay at `MachineView.svelte:473-476` iterates the `breakpoints` map and calls `runner.toggleBreakpoint(id, kind)` for every entry — including the just-set code-set entries. The worker toggles `state.debug` (which user code set to `{before: true}` or similar), getting back to `null`, and echoes `breakpointToggled` with `value: 'off'`. The main handler removes the entry. Net effect: indicator never appears.

The bundled approach avoids both problems: (a) `graph` is set in the same handler tick before the code-set entries are applied, so `bareIdOf` works correctly; (b) the replay loop is filtered to skip ids present in `res.codeSetBreakpoints`, so no double-toggle.

Alternative considered earlier: a new `breakpointSnapshot` response carrying the full Map atomically. Rejected because (a) it requires a new message type and main-side handler, (b) replacement semantics conflict with any UI-side optimistic state. The bundled `codeSetBreakpoints` field on `built` is essentially a snapshot but scoped to code-set entries only and processed alongside the existing graph-replay flow.

## Components

### New pure helper: `scanCanonicalBreakpoints`

Add to `src/lib/breakpointCoordination.ts` (sibling to the existing `mergeDebugKinds`):

```ts
export type CanonicalBreakpointEntry = {
  stateId: number;
  before: boolean;
  after: boolean;
};

/**
 * Walk the engine's reachable state graph from `initialState` (resolved via
 * `State.collectStates`) and surface every state whose `debug` field has a
 * `before` or `after` bit set. Dedupes wrapper/bare pairs via `bareIdOf`
 * (they share a `#debugRef` so emitting twice would be a phantom). Halt-
 * class negative ids canonicalize to `0` to match the existing
 * `toggleBreakpoint` handler's normalization.
 *
 * Returns only states with at least one bit set; empty machines or
 * machines with no programmatic state.debug writes return [].
 */
export function scanCanonicalBreakpoints(
  initialState: turing.State,
  tapeBlock: turing.TapeBlock,
): CanonicalBreakpointEntry[];
```

The helper is pure and engine-agnostic (works for both Turing and Post). All canonicalization decisions (bare dedup, halt normalization) match the existing `toggleBreakpoint` handler in `machineWorker.ts`, so the indicators produced by code-set BPs are byte-identical to those produced by click-set ones.

### Worker wiring

In `src/lib/machineWorker.ts`, in the `build` handler, after the machine is constructed and the `Graph` snapshot is captured, call `scanCanonicalBreakpoints` and attach the result to the `built` response as `codeSetBreakpoints`. Omit the field when the scan returns `[]` so the on-the-wire `built` shape stays minimal for the common case.

```ts
const codeSetBPs = scanCanonicalBreakpoints(stateMap, currentGraph);
send({
  type: 'built',
  tapes, alphabets, halted, graph: currentGraph,
  codeSetBreakpoints: codeSetBPs.length > 0 ? codeSetBPs : undefined,
});
```

(`stateMap` is the result of `turing.State.collectStates(initialState, tapeBlock)`.)

### Main side: extend the build success path

In `MachineView.svelte`'s build success path, AFTER `graph = res.graph` and BEFORE the existing replay loop:

1. Build `codeSetIds = new Set<number>(res.codeSetBreakpoints?.map((e) => bareIdOf(e.stateId, graph)) ?? [])`.
2. Run the existing stale-prune over the `breakpoints` map (unchanged).
3. Run the existing UI-clicked-BP replay — but **skip any id present in `codeSetIds`**. Those are already in the worker (set by user code during `userFn`); replaying them would toggle them OFF.
4. After replay, walk `res.codeSetBreakpoints` and write each entry into the `breakpoints` SvelteMap directly (no `toggleBreakpoint` round-trip — the worker already has them). Canonicalize via `bareIdOf` so the map's key matches the click-set convention. Code wins on overlap with a stale UI click.

The `$derived` chain that produces `breakpointIndicatorSet` re-runs reactively from the map updates; the graph component re-renders with indicators.

## Data flow

```
main → worker:  build { engine, code }
worker:         userFn(imports, ...) runs (user code)
worker:         machine constructed, Graph captured
worker:         scanCanonicalBreakpoints(stateMap, graph) → entries[]
worker → main:  built { tapes, alphabets, halted, graph, codeSetBreakpoints? }
main:           graph set; codeSetIds computed
main:           stale-prune over breakpoints map
main:           UI-clicked-BP replay (skip codeSetIds)
main:           apply codeSetBreakpoints to breakpoints map
main:           graph renders with indicators
```

The single message preserves ordering naturally — code-set BPs are applied in the same handler tick as `graph` is set, before the graph component first renders.

## Edge cases

- **Re-build clears stale BPs.** `MachineView.svelte:470-472` already deletes BPs for state ids absent from the new graph after each `built` arrives. The new code-set entries run AFTER the prune; cleanup unchanged.
- **Wrapper/bare canonicalization.** Engine `state.debug` is shared via `#debugRef`. The scan dedupes by canonical bare id; one emit per logical BP regardless of how many wrappers reference the same bare.
- **Halt class.** Negative ids canonicalize to `0`, matching the existing `toggleBreakpoint` handler's normalization. Halt markers (per-call-site sentinels with `isHaltMarker: true`) and the `haltState` singleton (`isHalt: true`) both fold into the halt-class indicator.
- **Empty machines / no programmatic writes.** Scan returns `[]`; `codeSetBreakpoints` field omitted from `built`; build proceeds normally.

- **Overlap with stale UI click.** When the previous build had a UI-clicked BP on state X and the new code also sets `state.debug` on X, the code-set entry overwrites the map entry (code wins). The UI click is lost — acceptable per the spec's "same indicator regardless of source" design.
- **Mid-run mutations.** Not supported. User code does not run between iters in this demo. If a future change adds user-defined callbacks invoked during run, per-iter scanning can be added incrementally without changing the message protocol.

## Testing

### Unit tests for `scanCanonicalBreakpoints`

Add to `src/lib/breakpointCoordination.test.ts`:

| case | setup | assertion |
|---|---|---|
| empty machine | minimal halt-only graph | returns `[]` |
| single `before` | one state, `state.debug = { before: true }` | one entry, `{stateId, before: true, after: false}` |
| single `after` | one state, `state.debug = { after: true }` | one entry, `{stateId, before: false, after: true}` |
| both kinds | one state, `state.debug = { before: true, after: true }` | one entry, both bits true |
| multi-state | three states with various combinations | three entries, correct shape each |
| wrapper/bare dedup | `withOverriddenHaltState`-wrapped state with `debug` on the bare | one entry, canonical bare id |
| halt-class canonicalization | `haltState.debug = { before: true }` | one entry, `stateId === 0` |
| no debug writes | states with `debug === null` everywhere | returns `[]` |

### Integration via existing scenario harness

Add to `scenarioRunner.test.ts` (or a sibling `breakpointMirror.test.ts` if it grows beyond a handful of cases):

| scenario | code | expectation |
|---|---|---|
| code-set BP appears | user code sets `state.debug` on the initial state | main's `breakpoints` SvelteMap contains the entry after `built` arrives |
| code-set + click-set coexist | user code sets one BP; UI then toggles another | both entries in the SvelteMap; UI toggle still works on the code-set one (engine accepts the clear) |
| clear via click | user code sets `state.debug = { before: true }`; UI clicks the indicator to toggle off | post-toggle, the SvelteMap entry's `before` bit is `false` |

### No new E2E

Cold-start E2E (`e2e/cold-start.spec.ts`) doesn't need a new scenario — the unit + integration coverage exercises the same code path without the cost of a Playwright run. E2E is reserved for cross-boundary scenarios that unit tests can't reach.

## Doc backfill (bundled into the same PR)

The doc surfaces that summarize the worker protocol have drifted since PR #76 landed in May. This PR catches them up alongside the #78 implementation:

### `CLAUDE.md` § Worker contract

Current table covers `build` / `step` / `run` / `resume` / `setDebug` requests + `built` / `stepped` / `ran` / `paused` responses + `paused` interleave semantics. Missing rows:

- **Request:** `pause` (click-pause from RUNNING_AUTO), `toggleBreakpoint` (UI → engine, shipped in PR #76)
- **Response:** `idle` / `busy` (auto-mode throttle gates), `breakpointToggled` (echo for `toggleBreakpoint` only — code-set BPs flow through the new `BuiltResponse.codeSetBreakpoints` field instead, not through this response)

Add a paragraph noting the bundled `codeSetBreakpoints` field on `built` and why the seemingly-simpler "unsolicited `breakpointToggled`" approach was rejected (replay-loop interaction in the build handler). Reference #78.

### `README.md` lines 70-71

The ASCII protocol summary in the architecture diagram currently reads:

```
requests:   build / step / run / resume / setDebug
responses:  built / stepped / ran / paused / error
```

Update to include `pause` / `toggleBreakpoint` in requests, and `idle` / `busy` / `breakpointToggled` in responses. The `built` response now also carries an optional `codeSetBreakpoints` field; the README's terse summary doesn't need to enumerate per-message fields, but the type changed.

### `src/lib/types.ts` `BreakpointToggledResponse` JSDoc

Currently describes the response as the echo for `toggleBreakpoint`. Add a sentence noting that code-set BPs (#78) do NOT flow through this response — they're carried in `BuiltResponse.codeSetBreakpoints` instead — and briefly explain the replay-loop reason. Also expand `BuiltResponse`'s JSDoc to describe the new `codeSetBreakpoints` field.

## Out of scope

- **Visual distinction between UI-set and code-set BPs.** Same indicator for both per "Decisions" above.
- **Per-iter or per-pause scanning.** Build-only per "Decisions" above. Easy to add later without protocol change.
- **Engine-side change events for `state.debug` writes.** Engine doesn't expose them; would require an engine PR. The build-time scan is sufficient for this demo's user-code execution model.
- **Reopening #37.** Per #78's body, #37 stays closed as "scope option 1 shipped"; this issue tracks the remaining scope 2 → 3 progression and closes on this PR's merge.
- **New E2E scenario.** Unit + integration coverage suffices; E2E reserved for cross-boundary cases unit tests can't reach.

## Closes

Closes #78.
