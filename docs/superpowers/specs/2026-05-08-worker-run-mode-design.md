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
| → | `run` | `{ maxSteps?, debug?, step? }` |
| → | `resume` | `{ step? }` |
| → | `setDebug` | `{ on }` |
| ← | `paused` | `{ tapes, commands, stepsApplied, state, currentSymbols, debugBreak }` |

`debug: boolean` defaults to `false` — no surprise pauses if user code has leftover `state.debug` assignments. The worker's `onDebugBreak` is **always** wired and self-gates on a module-scoped `debugEnabled` flag, so a `setDebug` request from the main thread can flip behavior mid-run (the user toggling the checkbox without restarting). When `debugEnabled` is off, the hook returns immediately unless the user just clicked Step (see Step semantics below).

`step: boolean` defaults to `false`. When `true`, the worker arms the initial state's `debug.after = true` so iter 1's after-fire is the step boundary (preserving any user-authored `state.debug.before`). Used by the cold-start Step path so the run pauses at the first iter without firing user-unauthored before-pauses.

Field shapes (paused):

- `tapes: TapeSnapshot[]` — full snapshot at break time (same producer as `built` / `ran` / `error`).
- `commands: Command[][]` — per-step commands buffered since the previous `paused` (or since `run` started). Mirror replays them in the Log; tape state is restored from `tapes`.
- `stepsApplied: number` — running total across all segments of this run (matches `stepped` / `ran` semantics).
- `state: string` — `m.state.name`. The user's `State` instance does not cross the boundary.
- `currentSymbols: string[]` — the symbols under each head at break time.
- `debugBreak: { before?: true; after?: true }` — copied from `m.debugBreak` (omitted shape = field absent, never `undefined`).

Inside the worker, `run` now calls:

```ts
debugEnabled = req.debug ?? false;
stepPending = false;

if (req.step && initialState) {
  // Cold-start arm: always .after, preserve user-authored .before.
  const target = initialState as { debug: ... };
  const original = target.debug;
  target.debug = {
    after: true,
    ...(original?.before !== undefined ? { before: original.before } : {}),
  };
  pendingRestore = () => { target.debug = original; };
  stepPending = true;
}

await machine.run({
  initialState,
  stepsLimit: req.maxSteps ?? MAX_STEPS,
  onStep: (m) => { /* buffer per-step commands */ },
  onDebugBreak: async (m) => {
    if (pendingRestore) { pendingRestore(); pendingRestore = null; }
    if (debugEnabled) {
      stepPending = false; // pause at every break
    } else if (!stepPending || !m.debugBreak?.after) {
      return; // debug=off + non-Step-armed → no pause
    } else {
      stepPending = false;
    }
    send({ type: 'paused', ... });
    await new Promise<{ step: boolean }>((resolve) => { resumeResolve = resolve });
    // on resume: if action.step, arm next pause via state.debug.after (see below)
  },
});
```

When `debugEnabled` is `false` AND no Step is pending, `onDebugBreak` returns immediately (upstream's `run()` continues without us paying any per-step cost beyond a flag check). Once [turing-machine-js#106](https://github.com/mellonis/turing-machine-js/issues/106) lands, we can pass `debug` straight through to upstream — the runtime-toggle still requires our wrapper, but the off-path flag check goes away.

A module-scoped `resumeResolve: ((action: { step: boolean }) => void) | null` holds the pending Promise. The `resume` request handler resolves it with the action and clears the slot. `run` and `resume` are the only message types that touch this slot; concurrent `run` is rejected by the phase machine (see below).

After `run()` resolves (halt or stepsLimit), the worker sends the existing `ran` response. Errors thrown from inside `run()` (e.g. no edge for current symbol) flow through the existing catch and produce `error` with partial tape state.

### Worker phases

Defense in depth against bad requests from the main thread. The mode machine on the main side gates buttons, but a future refactor could let an invalid request through; without worker-side validation, that becomes a silent hang (e.g. `resume` with no pending Promise = no-op, paused forever).

```ts
type WorkerPhase =
  | { kind: 'idle' }
  | { kind: 'built'; halted: boolean }
  | { kind: 'running' }
  | { kind: 'paused' };

let phase: WorkerPhase = { kind: 'idle' };
```

Allowed transitions:

| Request | Allowed from | New phase |
|---|---|---|
| `build` | any | `built { halted: <first-yield-done> }` |
| `step` | `built { halted: false }` | `built { halted: <post-step> }` |
| `run` | `built { halted: false }` | `running` → `paused` or `built { halted: true }` |
| `resume` | `paused` | `running` → `paused` or `built { halted: true }` |
| `setDebug` | any | unchanged (side-channel mutation of `debugEnabled`) |

A request from a disallowed phase throws `worker phase <current>, expected <allowed>`, which the existing catch converts into an `error` response. Main thread logs it as a bug via `report('...', 'error')` — this is supposed to be unreachable, so a loud surfacing helps catch UI-side regressions early.

`build` from any phase is intentional: the existing UI allows Build at any time (terminate worker is implicit in the runner; from the worker's POV the request is fresh), and we want to keep that.

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

### Step semantics (cold-start and from paused)

Step is the unified entry point for advancing one engine iteration with a pause boundary. Three cases:

1. **Cold-start Step (DEMO / MANUAL / HALTED → click Step)** — `MachineView.doStep` calls `runner.run({ debug, step: true, onPaused: onPausedHandler })`. The worker arms `initialState.debug.after = true` (preserving user-authored `.before`) so iter 1's after-fire is the step boundary. `stepPending = true`. After iter 1's command applies, the after-fire pauses; main thread enters `RUNNING_PAUSED_AT_BREAK`.

2. **Step from `RUNNING_PAUSED_AT_BREAK`** — `runner.resume({ step: true })`. Inside `onDebugBreak` (during the resume flow), the worker arms `target.debug.after = true` and sets `pendingRestore` to undo the mutation before the user observes the next break. The target depends on which kind of break we're paused at:
   - **`before` break.** `m.state` is the current iteration's state. Arm `m.state.debug.after`. Iter K's command applies, then iter K's after-fire fires (deferred to iter K+1's start, with `prevYield` substituted).
   - **`after` break.** `m.state` is already `prevYield` (the engine substitutes for context). Arm `m.nextState.debug.after`. Iter K+1 starts with `state.debug.after` set, fires its own after-fire at iter K+2's start.

3. **`RUNNING_STEP` (auto-step paused) + Step click** — keeps the legacy `runner.step()` path for one-iteration advancement. Auto-step refactor to run-mode is tracked in [#43](https://github.com/mellonis/machines-demo/issues/43); until that lands, this path doesn't pause at breakpoints.

The unified rule: Step always arms `.after` (never `.before`). Step boundaries are at the *end* of an iteration, not the start, matching the legacy step-by-step mental model — Step click → "I've now seen the result of one more iteration".

```ts
// Inside onDebugBreak, on resume(step: true):
if (action.step) {
  stepPending = true;
  const target = (
    m.debugBreak?.before ? m.state : m.nextState
  ) as { debug: { before?: unknown; after?: unknown } | null };
  const original = target.debug;
  // Preserve user-authored .before (read via getter — DebugConfig accessor; spread skips it).
  target.debug = {
    after: true,
    ...(original?.before !== undefined ? { before: original.before } : {}),
  };
  pendingRestore = () => { target.debug = original; };
}
```

### Pause log format

Reads as "we made a step, here's the result". `.after`-arming means iter K just ran when we pause; the log surfaces iter K's state and just-executed symbols:

```
paused at state <name> after applying command for symbols: [<syms>]
```

Same format for user-authored breakpoints (`state.debug.before` or `state.debug.after`) — uses the appropriate `before`/`after` verb. The `debug` toggle gates whether user-authored breaks fire, not how pauses are logged.

### Halt-iter quirks (engine-side)

Two halt-related quirks visible in the trace, neither caused by our code:

- **Halting iter's `after`-fire never fires.** The engine fires after-fire at iter K+1's start using `prevYield`. When iter K transitions to `haltState`, the `while (!state.isHalt)` loop exits — no iter K+1 — `prevYield`'s after-fire is silently lost.
- **`haltState.debug.after` has no anchor.** Halt is terminal; there's no "iteration after halt" for an after-fire to attach to. The engine silently ignores it. (`haltState.debug.before` IS honored — fires on the iter that transitions to halt, OR'd into that iter's `beforeMatch`.)

Both filed upstream in [turing-machine-js#108](https://github.com/mellonis/turing-machine-js/issues/108) — proposed fix: drain `pendingAfterFromPrev` after the loop, and warn-then-throw on `haltState.debug.after` assignment.

### Halt-iter step entry (uniform)

Cold-start Step (run-mode) reports the halting iter's command via `ran.commands`. `runner.step()` legacy path also reports the halting iter's `res.commands` before logging halt. No path absorbs the halting iter's step entry into the halt log line.

## "Debug mode" UI

A checkbox lives in `Toolbar.svelte` next to `with pause`. State name `debugMode`, owned by `MachineView.svelte`, persisted to `localStorage` under `machines-demo:<engine>:debugMode` (mirroring the existing `withPause` pattern). Default off.

The checkbox feeds two paths:

1. **Run-time**: every `run` request includes `debug: debugMode` so the worker initializes `debugEnabled` correctly at run start.
2. **Mid-run**: a `$effect` in `MachineView.svelte` watches `debugMode` and fires `runner.setDebug(debugMode)` whenever it changes (gated on `workerLive`). The worker's `setDebug` handler updates `debugEnabled` without restarting — flipping the checkbox during a paused break changes how *future* breaks are handled.

The UI never disables `withPause` when `debugMode` is on (or vice versa) — they target different execution modes:

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
3. Append a single `ok`-styled log entry: `paused at state <name> [before|after] applying command for symbols: [<syms>]`. Same format whether the break is user-authored or worker-armed for Step.
4. Update `lastSnapshots`, set `executionMode = 'RUNNING_PAUSED_AT_BREAK'`.

On `resume` (Continue clicked): nothing changes locally — wait for the next worker response (`paused`, `ran`, or `error`).

On the final `ran`: existing flow — render final tapes, batch-log buffered commands, mode → `HALTED`. Both run-mode Step (cold-start path) and the legacy `runner.step()` path log the halting iter's command before the halt entry.

## Default snippets: don't run the machine

User code runs synchronously inside `new Function()`. If they call `machine.run(...)` or iterate `machine.runStepByStep(...)` themselves before returning, the tape is post-execution by the time the worker snapshots it — confusing initial state, no error.

No code-side defense (prototype-patching breaks the "test a different machine alongside" pattern; tape mutation is indistinguishable from legitimate setup). Document the contract instead: add one line to each bundled example header — "The demo runs the machine; don't call `.run()` or `.runStepByStep()` yourself." Three snippets in `src/lib/defaultCode.ts` (Turing single-tape, Turing multi-tape, Post).

## Take Control: log entry

`takeControl()` (`MachineView.svelte:465`) currently transitions silently from `DEMO` / `RUNNING_*` to `MANUAL`. Add `report('user took control', 'ok')` so the mode transition is captured in the log alongside the other logged transitions (Build, Step, Run, halt, paused-at-break). One-line addition; bundled here because we're already touching the log machinery for the break-pause flow.

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
- Breakpoints in `RUNNING_AUTO` (today: engine `runStepByStep` has no `onDebugBreak`). Tracked as a follow-up in [#43](https://github.com/mellonis/machines-demo/issues/43): switch `RUNNING_AUTO` to `run()` with a throttled `onStep`. Until that lands, the constraint is documented in the #38 example.

## Future simplifications when upstream lands

- [turing-machine-js#106](https://github.com/mellonis/turing-machine-js/issues/106) — `debug: boolean` parameter on `run()`. The worker can pass it straight through; the off-path flag-check inside `onDebugBreak` goes away (the runtime-toggle still requires our wrapper).
- [turing-machine-js#108](https://github.com/mellonis/turing-machine-js/issues/108) — drain `pendingAfterFromPrev` after the engine's main loop so the halting iter's `after`-fire actually fires; warn-then-throw on `haltState.debug.after` assignment. The "halt-iter quirks" subsection in Step semantics goes away when this lands.
- [turing-machine-js#107](https://github.com/mellonis/turing-machine-js/issues/107) — un-substituted snapshot for `after`-break consumers. Not needed by our Step path (`.after`-arming on the next iteration uses `m.state` = `prevYield`, which is exactly the just-executed state we want to display). Stays open for other consumers that might want the un-substituted `machineState` at after-fires.
