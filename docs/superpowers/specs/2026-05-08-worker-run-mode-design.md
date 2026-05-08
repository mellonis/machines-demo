# Worker `run()` mode with `onDebugBreak` hook

Tracks: [#40](https://github.com/mellonis/machines-demo/issues/40). Prerequisite for [#38](https://github.com/mellonis/machines-demo/issues/38) (Debugger-breakpoints example).

## Problem

The worker drives execution through `runStepByStep` only (`src/lib/machineWorker.ts:205,239`). v4's `onDebugBreak` is a `run()`-only hook — it cannot fire from a step generator. To wire the v4 debugger end-to-end in the UI, the worker needs to call async `machine.run({ onStep, onDebugBreak })` and let the main thread suspend execution at a break.

## Decisions

- **Extend the existing `run` request.** Keep the request type name `run`; add an optional `debug` flag and break-pause support. The worker switches from the synchronous `runToEnd` helper to `await machine.run({ ... })`. Single request type, no dispatch decision on the main thread.
- **Dedicated paused-at-break mode.** A new `RUNNING_PAUSED_AT_BREAK` is introduced rather than overloading the existing `RUNNING_STEP`. The two states are conceptually different: `RUNNING_STEP` is paused between full steps and *can* single-step; `RUNNING_PAUSED_AT_BREAK` is paused inside `run()` and *cannot* (the engine's `for` loop owns the iteration).
- **`RUNNING_AUTO` unchanged.** Auto-step uses `runStepByStep`, so breakpoints don't fire there. Documented as a known constraint in the #38 example.
- **"Debug mode" UI gate.** A user-facing checkbox controls whether breaks pause execution at all, so `state.debug` / `haltState.debug` assignments in user code stay valid across both modes (no edit-and-comment-out churn). Demo-side emulation today (the worker's `onDebugBreak` resolves instantly when off); cross-references [turing-machine-js#106](https://github.com/mellonis/turing-machine-js/issues/106) which proposes the same gate as a `debug: boolean` parameter on upstream `run()`. The wire shape matches that proposal.

## Worker contract

Extend `run` with an optional `debug` flag. Add `resume` request and `paused` response. `build` / `step` unchanged. `stepped` / `ran` / `error` shapes unchanged.

| Direction | Type | Payload |
|---|---|---|
| → | `run` | `{ maxSteps?, debug? }` |
| → | `resume` | `{ step? }` |
| ← | `paused` | `{ tapes, commands, stepsApplied, state, currentSymbols, debugBreak }` |

`debug: boolean` defaults to `false` — no surprise pauses if user code has leftover `state.debug` assignments. When `true`, the worker's `onDebugBreak` posts `paused` and awaits `resume`. When `false`, `onDebugBreak` returns immediately (pauses short-circuited at the wrapper level).

Field shapes:

- `tapes: TapeSnapshot[]` — full snapshot at break time (same producer as `built` / `ran` / `error`).
- `commands: Command[][]` — per-step commands buffered since the previous `paused` (or since `run` started). Mirror replays them in the Log; tape state is restored from `tapes`.
- `stepsApplied: number` — running total across all segments of this run (matches `stepped` / `ran` semantics).
- `state: string` — `m.state.name`. The user's `State` instance does not cross the boundary.
- `currentSymbols: string[]` — the symbols under each head at break time.
- `debugBreak: { before?: true; after?: true }` — copied from `m.debugBreak` (omitted shape = field absent, never `undefined`).

Inside the worker, `run` now calls:

```ts
const debug = req.debug ?? false;
await machine.run({
  initialState,
  stepsLimit: req.maxSteps ?? MAX_STEPS,
  onStep: (m) => { /* buffer per-step commands */ },
  onDebugBreak: debug
    ? async (m) => {
        send({ type: 'paused', ... });
        await new Promise<void>((resolve) => { resumeResolve = resolve });
      }
    : undefined,
});
```

When `debug` is `false`, `onDebugBreak` is omitted entirely — upstream's `run()` then skips break-handling without our wrapper paying any per-step cost. Once [turing-machine-js#106](https://github.com/mellonis/turing-machine-js/issues/106) lands, we can pass `debug` straight through to upstream and drop this conditional.

A module-scoped `resumeResolve: (() => void) | null` holds the pending Promise. The `resume` request handler resolves it and clears the slot. `run` and `resume` are the only message types that touch this slot; concurrent `run` is rejected (existing `not built` / state-error pattern).

After `run()` resolves (halt or stepsLimit), the worker sends the existing `ran` response. Errors thrown from inside `run()` (e.g. no edge for current symbol) flow through the existing catch and produce `error` with partial tape state.

## Main-thread modes

```
ExecutionMode = 'DEMO' | 'MANUAL' | 'RUNNING_STEP' | 'RUNNING_AUTO'
              | 'RUNNING_CONTINUOUS' | 'RUNNING_PAUSED_AT_BREAK' | 'HALTED'
```

`RUNNING_CONTINUOUS` sends `run` with `debug` set to the user's "Debug mode" checkbox state.

`RUNNING_PAUSED_AT_BREAK`:

| Affordance | State |
|---|---|
| Run button | label "Continue", icon retained, sends `resume` (no step flag) |
| Step button | visible — sends `resume { step: true }`, advances one iteration, re-pauses |
| Stop button | visible (terminates worker, → `HALTED`) |
| Take Control | hidden (consistent with other RUNNING_* modes) |
| Editor | read-only-effective (Build remains available, see below) |
| Belt | snap-to-paused-state, transitions off |

Build from `RUNNING_PAUSED_AT_BREAK` is allowed and follows the existing pattern: terminate worker, `reloadWorker(code)`, mode → `MANUAL`. The pending Promise dies with the worker.

`runDisabled` / `stepDisabled` / etc. derived flags pick up `RUNNING_PAUSED_AT_BREAK` so existing UI gating composes.

### Step from `RUNNING_PAUSED_AT_BREAK`

Step advances exactly one engine iteration and re-pauses, by mutating `nextState.debug = { before: true }` so the next iteration breaks regardless of the user's `state.debug` config. Stash the original `debug` value; restore on entry to the synthesized break before pausing again.

Two paths depending on which kind of break we're paused at:

- **`before` break.** `m` is the current `machineState`; `m.nextState` is the actual next iteration's state. Apply the trick directly inside `onDebugBreak`.
- **`after` break.** `m` is `prevYield` (the engine substitutes for context). The un-substituted `machineState` isn't reachable here. Set a `pendingStepNext` flag and defer the trick to the *next* `onStep` call, which fires with the un-substituted yield.

```ts
let pendingStepNext = false;
let pendingRestore: (() => void) | null = null;

onStep: (m) => {
  if (pendingStepNext) {
    const ns = m.nextState;
    const original = ns.debug;
    ns.debug = { before: true };
    pendingRestore = () => { ns.debug = original; };
    pendingStepNext = false;
  }
  // existing per-step buffering
},
onDebugBreak: async (m) => {
  if (pendingRestore) { pendingRestore(); pendingRestore = null; }
  // post `paused`, await `resume` (sets resumeAction = 'continue' | 'step')
  if (resumeAction === 'step') {
    if (m.debugBreak?.before) {
      const ns = m.nextState;
      const original = ns.debug;
      ns.debug = { before: true };
      pendingRestore = () => { ns.debug = original; };
    } else {
      pendingStepNext = true;
    }
  }
}
```

`nextState.debug` mutation is shared across `withOverrodeHaltState` wrappers (per upstream docs); the stash-and-restore covers this — whatever the user had on the underlying state is preserved.

## "Debug mode" UI

A checkbox lives in `Toolbar.svelte` next to `with pause`. State name `debugMode`, owned by `MachineView.svelte`, persisted to `localStorage` under `machines-demo:<engine>:debugMode` (mirroring the existing `withPause` pattern). Default off.

The checkbox is purely a request-payload gate: every `run` request includes `debug: debugMode`. The UI never disables `withPause` when `debugMode` is on (or vice versa) — they target different execution modes:

| `withPause` | `debugMode` | Run button → | Breakpoints fire? |
|---|---|---|---|
| off | off | `RUNNING_CONTINUOUS` | no (current behavior) |
| off | on  | `RUNNING_CONTINUOUS` | yes — pauses at breaks |
| on  | off | `RUNNING_AUTO` | no (current behavior) |
| on  | on  | `RUNNING_AUTO` | no — engine constraint |

The bottom-right cell is the one wart: with both checked, breakpoints don't fire because `RUNNING_AUTO` uses `runStepByStep` (no `onDebugBreak`). The #38 example documents this. No UI change to flag it; the simpler matrix is worth keeping.

## Mirror behavior across breaks

On `paused`:

1. Rebuild `mirrorMachine` from the snapshot tapes (snap, no animation) — same path as `ran`.
2. Replay the buffered `commands: Command[][]` to the Log via `report` + `commandsEntry` — user sees the trace that led to the break.
3. Append a single `ok`-styled log entry: `paused at <state.name> [before|after]: <symbols-under-heads>`.
4. Update `lastSnapshots`, set `executionMode = 'RUNNING_PAUSED_AT_BREAK'`.

On `resume` (Continue clicked): nothing changes locally — wait for the next worker response (`paused`, `ran`, or `error`).

On the final `ran`: existing flow — render final tapes, batch-log buffered commands, mode → `HALTED`.

## Timeout

Per-segment 5s budget instead of per-request:

- `run` sent → start 5s.
- `paused` received → stop the timer. (User is inspecting; no clock.)
- `resume` sent → start a fresh 5s.
- `ran` / `error` received → stop.

If any segment exceeds 5s, the existing terminate-on-timeout path runs (worker killed, respawned on next request).

`MachineRunner` gains internal `pauseTimeout()` / `resumeTimeout()` helpers; the rest of the API is unchanged.

## `MAX_STEPS`

Still caps total work across all resumes. Enforced inside `run()` via `stepsLimit`. On overrun, `run()` throws — surfaces as `error` with partial tapes (existing path).

## Line 258 (mirror await)

`MachineView.svelte:258` calls `mirrorMachine.run({ initialState: oneStep })` without `await`. Currently correct under v4 (the `run()` body runs synchronously when no `onDebugBreak` is set), but fragile against any internal yield the upstream might add.

Make `_runMirrorStep` async and `await mirrorMachine.run(...)`. Propagate to its callers as needed. Aligns with the new async `run` request flow and is future-proof.

## Out of scope

- The bundled "Debugger breakpoints" example itself ([#38](https://github.com/mellonis/machines-demo/issues/38)).
- Click-to-toggle UI for breakpoints ([#37](https://github.com/mellonis/machines-demo/issues/37)).
- Public `onDebugBreak` parameter on `PostMachine.run()` — closed as not planned ([post-machine-js#62](https://github.com/mellonis/post-machine-js/issues/62)). The worker calls the underscored hook directly when running a `PostMachine`.
- Public state-by-instruction-label lookup on `PostMachine` ([post-machine-js#63](https://github.com/mellonis/post-machine-js/issues/63)).
- Breakpoints in `RUNNING_AUTO` (engine constraint — documented in the #38 example).
