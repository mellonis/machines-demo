# Worker `run()` mode with `onDebugBreak` hook

Tracks: [#40](https://github.com/mellonis/machines-demo/issues/40). Prerequisite for [#38](https://github.com/mellonis/machines-demo/issues/38) (Debugger-breakpoints example).

## Problem

The worker drives execution through `runStepByStep` only (`src/lib/machineWorker.ts:205,239`). v4's `onDebugBreak` is a `run()`-only hook — it cannot fire from a step generator. To wire the v4 debugger end-to-end in the UI, the worker needs to call async `machine.run({ onStep, onDebugBreak })` and let the main thread suspend execution at a break.

## Decisions

- **Always-runWithBreaks dispatch.** The Run button always uses the new path. If user code never sets `state.debug` / `haltState.debug`, no breaks fire and behavior is identical to today's sync run. The old `run` request type is dropped — one path, no main-thread introspection of user State needed to choose.
- **Dedicated paused-at-break mode.** A new `RUNNING_PAUSED_AT_BREAK` is introduced rather than overloading the existing `RUNNING_STEP`. The two states are conceptually different: `RUNNING_STEP` is paused between full steps and *can* single-step; `RUNNING_PAUSED_AT_BREAK` is paused inside `run()` and *cannot* (the engine's `for` loop owns the iteration).
- **`RUNNING_AUTO` unchanged.** Auto-step uses `runStepByStep`, so breakpoints don't fire there. Documented as a known constraint in the #38 example.
- **"Debug mode" UI gate.** A user-facing checkbox controls whether breaks pause execution at all, so `state.debug` / `haltState.debug` assignments in user code stay valid across both modes (no edit-and-comment-out churn). Demo-side emulation today (the worker's `onDebugBreak` resolves instantly when off); cross-references [turing-machine-js#106](https://github.com/mellonis/turing-machine-js/issues/106) which proposes the same gate as a `debug: boolean` parameter on upstream `run()`.

## Worker contract

Drop `run`. Add `runWithBreaks` and `resume`. Add `paused` response. `build` / `step` unchanged. `stepped` / `ran` / `error` shapes unchanged.

| Direction | Type | Payload |
|---|---|---|
| → | `runWithBreaks` | `{ maxSteps?, debug }` |
| → | `resume` | `{}` |
| ← | `paused` | `{ tapes, commands, stepsApplied, state, currentSymbols, debugBreak }` |

`debug: boolean` is required (no default at the wire — main thread is always explicit). When `false`, the worker's `onDebugBreak` resolves instantly without posting `paused`. When `true`, the pause/resume flow runs.

Field shapes:

- `tapes: TapeSnapshot[]` — full snapshot at break time (same producer as `built` / `ran` / `error`).
- `commands: Command[][]` — per-step commands buffered since the previous `paused` (or since `runWithBreaks` started). Mirror replays them in the Log; tape state is restored from `tapes`.
- `stepsApplied: number` — running total across all segments of this run (matches `stepped` / `ran` semantics).
- `state: string` — `m.state.name`. The user's `State` instance does not cross the boundary.
- `currentSymbols: string[]` — the symbols under each head at break time.
- `debugBreak: { before?: true; after?: true }` — copied from `m.debugBreak` (omitted shape = field absent, never `undefined`).

Inside the worker, `runWithBreaks` calls:

```ts
await machine.run({
  initialState,
  stepsLimit: req.maxSteps ?? MAX_STEPS,
  onStep: (m) => { /* buffer per-step commands */ },
  onDebugBreak: async (m) => {
    send({ type: 'paused', ... });
    await new Promise<void>((resolve) => { resumeResolve = resolve });
  },
});
```

A module-scoped `resumeResolve: (() => void) | null` holds the pending Promise. The `resume` request handler resolves it and clears the slot. `runWithBreaks` and `resume` are the only message types that touch this slot; concurrent `runWithBreaks` is rejected (existing `not built` / state-error pattern).

After `run()` resolves (halt or stepsLimit), the worker sends the existing `ran` response. Errors thrown from inside `run()` (e.g. no edge for current symbol) flow through the existing catch and produce `error` with partial tape state.

## Main-thread modes

```
ExecutionMode = 'DEMO' | 'MANUAL' | 'RUNNING_STEP' | 'RUNNING_AUTO'
              | 'RUNNING_CONTINUOUS' | 'RUNNING_PAUSED_AT_BREAK' | 'HALTED'
```

`RUNNING_CONTINUOUS` now dispatches `runWithBreaks` instead of the dropped `run`.

`RUNNING_PAUSED_AT_BREAK`:

| Affordance | State |
|---|---|
| Run button | label "Continue", icon retained, sends `resume` |
| Step button | hidden |
| Stop button | visible (terminates worker, → `HALTED`) |
| Take Control | hidden (consistent with other RUNNING_* modes) |
| Editor | read-only-effective (Build remains available, see below) |
| Belt | snap-to-paused-state, transitions off |

Build from `RUNNING_PAUSED_AT_BREAK` is allowed and follows the existing pattern: terminate worker, `reloadWorker(code)`, mode → `MANUAL`. The pending Promise dies with the worker.

`runDisabled` / `stepDisabled` / etc. derived flags pick up `RUNNING_PAUSED_AT_BREAK` so existing UI gating composes.

## "Debug mode" UI

A checkbox lives in `Toolbar.svelte` next to `with pause`. State name `debugMode`, owned by `MachineView.svelte`, persisted to `localStorage` under `machines-demo:<engine>:debugMode` (mirroring the existing `withPause` pattern). Default off.

The checkbox is purely a request-payload gate: every `runWithBreaks` request includes `debug: debugMode`. The UI never disables `withPause` when `debugMode` is on (or vice versa) — they target different execution modes:

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

- `runWithBreaks` sent → start 5s.
- `paused` received → stop the timer. (User is inspecting; no clock.)
- `resume` sent → start a fresh 5s.
- `ran` / `error` received → stop.

If any segment exceeds 5s, the existing terminate-on-timeout path runs (worker killed, respawned on next request).

`MachineRunner` gains internal `pauseTimeout()` / `resumeTimeout()` helpers; the rest of the API is unchanged.

## `MAX_STEPS`

Still caps total work across all resumes. Enforced inside `run()` via `stepsLimit`. On overrun, `run()` throws — surfaces as `error` with partial tapes (existing path).

## Line 258 (mirror await)

`MachineView.svelte:258` calls `mirrorMachine.run({ initialState: oneStep })` without `await`. Currently correct under v4 (the `run()` body runs synchronously when no `onDebugBreak` is set), but fragile against any internal yield the upstream might add.

Make `_runMirrorStep` async and `await mirrorMachine.run(...)`. Propagate to its callers as needed. Aligns with the new `runWithBreaks` flow and is future-proof.

## Out of scope

- The bundled "Debugger breakpoints" example itself ([#38](https://github.com/mellonis/machines-demo/issues/38)).
- Click-to-toggle UI for breakpoints ([#37](https://github.com/mellonis/machines-demo/issues/37)).
- Public `onDebugBreak` parameter on `PostMachine.run()` — closed as not planned ([post-machine-js#62](https://github.com/mellonis/post-machine-js/issues/62)). The worker calls the underscored hook directly when running a `PostMachine`.
- Public state-by-instruction-label lookup on `PostMachine` ([post-machine-js#63](https://github.com/mellonis/post-machine-js/issues/63)).
- Breakpoints in `RUNNING_AUTO` (engine constraint — documented in the #38 example).
