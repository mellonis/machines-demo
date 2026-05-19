# Execution model and debugger semantics

> Canonical reference for what each mode does, what each user action triggers, and where the machine lands. Tests in [#47](https://github.com/mellonis/machines-demo/issues/47) cite the scenario IDs (`S-...`) defined throughout. Working conventions and file structure remain in [`CLAUDE.md`](../CLAUDE.md).

## 1. Overview

The demo runs user-typed JavaScript inside a Web Worker that drives a `@turing-machine-js/machine` v6 instance. The main thread tracks the worker's progress with a 7-mode state machine: three resting states (DEMO, IDLE, MANUAL), three running states (RUNNING_AUTO, RUNNING_CONTINUOUS, RUNNING_PAUSED), and one terminal (HALTED).

Most user actions are mode transitions; a few — debug toggle, withPause toggle, Apply — are flag changes or in-place mirror writes that don't move the mode.

The diagram below shows every mode-to-mode user-action edge. Conditions appear inline in `[brackets]`; alternations use `or`. Event-driven exits (run completion, error, timeout, truncation, build error) are summarized in the bottom note.

```mermaid
stateDiagram-v2
    [*] --> DEMO

    DEMO --> IDLE : Build
    DEMO --> RUNNING_PAUSED : Step (cold-start)
    DEMO --> RUNNING_AUTO : Run [withPause=on]
    DEMO --> RUNNING_CONTINUOUS : Run [withPause=off]
    DEMO --> MANUAL : Take Control

    IDLE --> IDLE : Build
    IDLE --> RUNNING_PAUSED : Step (cold-start)
    IDLE --> RUNNING_AUTO : Run [withPause=on]
    IDLE --> RUNNING_CONTINUOUS : Run [withPause=off]
    IDLE --> MANUAL : Take Control

    MANUAL --> MANUAL : Build or Apply
    MANUAL --> RUNNING_PAUSED : Step (cold-start)
    MANUAL --> RUNNING_AUTO : Run [withPause=on]
    MANUAL --> RUNNING_CONTINUOUS : Run [withPause=off]

    RUNNING_AUTO --> RUNNING_PAUSED : Pause
    RUNNING_AUTO --> RUNNING_PAUSED : break [debug=on]
    RUNNING_AUTO --> HALTED : Stop or completion
    RUNNING_AUTO --> MANUAL : Take Control

    RUNNING_CONTINUOUS --> RUNNING_PAUSED : break [debug=on]
    RUNNING_CONTINUOUS --> HALTED : Stop or completion
    RUNNING_CONTINUOUS --> MANUAL : Take Control

    RUNNING_PAUSED --> RUNNING_PAUSED : Step or next break
    RUNNING_PAUSED --> RUNNING_AUTO : Continue [withPause=on]
    RUNNING_PAUSED --> RUNNING_CONTINUOUS : Continue [withPause=off]
    RUNNING_PAUSED --> HALTED : Stop or Continue→halt
    RUNNING_PAUSED --> MANUAL : Take Control

    HALTED --> IDLE : Build [!userTookControl]
    HALTED --> MANUAL : Build [userTookControl]
    HALTED --> RUNNING_PAUSED : Step (cold-start)
    HALTED --> RUNNING_AUTO : Run [withPause=on]
    HALTED --> RUNNING_CONTINUOUS : Run [withPause=off]
    HALTED --> MANUAL : Take Control [!userTookControl]

    note right of HALTED : Error, timeout, truncation, or cold-start build error from any non-resting state lands HALTED.
```

## 2. Mode reference

Three lines per mode: what it means, how it's entered, how it's exited. UI / log detail belongs in §8 Action matrix and §10 walk-throughs.

### DEMO
Page-load entry state. A timer-based loop generates random commands and applies them to the mirror, demonstrating the machine without user input. `userTookControl` is false; auto-loop is live.
Entry: page load only.
Exit: Build (→ IDLE), Step or Run (→ RUNNING_*; cold-start path), Take Control (→ MANUAL).

### IDLE
Uncommitted resting state. The user has signaled intent (Build / Step / Run from DEMO, or completed a run from IDLE-track) but has not yet taken control. Auto-loop is dead. Apply is hidden. Take Control is visible.
Entry: Build / Step / Run from DEMO; post-RUNNING_* completion when `!userTookControl`; Build from HALTED when `!userTookControl`.
Exit: Build (→ IDLE, reload), Take Control (→ MANUAL), Step (→ RUNNING_PAUSED), Run (→ RUNNING_AUTO / RUNNING_CONTINUOUS).

### MANUAL
Committed resting state. The user drives the machine via Apply. Worker is built but idle (no run/step pending). Take Control is hidden (already taken).
Entry: Take Control from any non-MANUAL mode; post-RUNNING_* completion or Build from HALTED when `userTookControl`.
Exit: Step / Run via §7 cold-start (→ RUNNING_AUTO / RUNNING_CONTINUOUS / RUNNING_PAUSED), Build (→ MANUAL, reload), Apply (stays MANUAL, writes to mirror).

### RUNNING_AUTO
The worker is running inside `machine.run({ onStep, onPause, onIter })` with the throttle inside `onIter` (the `withPause` interval awaited at end-of-iter). Belt animations follow the cadence; the user can click Pause to suspend.
Entry: Run from IDLE / MANUAL / HALTED with `withPause=on`; Continue from RUNNING_PAUSED with `withPause=on`.
Exit: Pause (→ RUNNING_PAUSED), debug break with `debug=on` (→ RUNNING_PAUSED), Stop (→ HALTED), run completion (→ HALTED), Take Control (→ MANUAL).

### RUNNING_CONTINUOUS
The worker is running inside `machine.run({ onStep, onPause, onIter })` with no throttle (`onIter` no-ops in this mode) — snap-to-final. Belt animation is suppressed; per-step commands batch-log on completion. Stop is visible as the user's kill-switch; the Step button stays rendered but disabled (no per-iter checkpoint to pause at).
Entry: Run from IDLE / MANUAL / HALTED with `withPause=off`; Continue from RUNNING_PAUSED with `withPause=off`.
Exit: debug break with `debug=on` (→ RUNNING_PAUSED), Stop (→ HALTED), run completion (→ HALTED), Take Control (→ MANUAL).

### RUNNING_PAUSED
The worker is suspended inside `machine.run()` awaiting a `resume` message from the main thread. Reachable from any RUNNING_* mode via debug break, click-pause, or cold-start arming. The Run button reads "Continue" throughout any RUNNING_* mode (disabled in AUTO/CONTINUOUS, enabled here). Build is disabled while a run is in flight (including PAUSED) — to start over the user must Stop first, then Build, which makes the worker tear-down explicit rather than silent.
Entry: cold-start Step (arms `initialState.debug.after`); break fires from RUNNING_AUTO / RUNNING_CONTINUOUS with `debug=on`; click-pause from RUNNING_AUTO; Step self-loop from RUNNING_PAUSED.
Exit: Step (arm next `.after`, → RUNNING_PAUSED via re-pause), Continue (→ RUNNING_AUTO / RUNNING_CONTINUOUS for the duration of the resume), Stop (terminate worker → HALTED), Take Control (→ MANUAL).

### HALTED
Terminal state. The machine reached its halt state, errored, timed out, or hit `MAX_STEPS` truncation. Tape is frozen at the final state. Build / Step / Run reload-from-code. Take Control is visible only when `!userTookControl`.
Entry: run completion, Stop, error, timeout, or truncation from any RUNNING_*; build error from any cold-start.
Exit: Build (→ IDLE if `!userTookControl`, → MANUAL if `userTookControl`), Step / Run (→ RUNNING_* via cold-start), Take Control (→ MANUAL, only if `!userTookControl`).

## 3. Flag reference

Four flags govern transitions and per-action behavior. Three are user-visible UI controls; one is a sticky latch.

- **`debugMode`** — `boolean`. UI checkbox in the Toolbar, persisted to `localStorage:machines-demo:<engine>:debugMode`. Gates whether user-authored `state.debug` / `haltState.debug` breaks pause execution. Mid-run toggle pushes `setDebug(on)` to the worker (the only mode-aware effect on a flag toggle).
- **`withPause`** — `boolean`. UI checkbox + interval input in the Toolbar. Selects RUNNING_AUTO (with throttle) vs RUNNING_CONTINUOUS (snap-to-final) on the next Run. The toggle itself (`S-withpause-toggle`) has no immediate runtime effect; it's read at Run-click time.
- **`halted`** — `boolean`. Derived from worker `built` / `ran` / `error` responses. Drives the HALTED-mode transition.
- **`userTookControl`** — `boolean`. Sticky latch, starts `false`, set `true` on Take Control click, never re-enables. Marks the "manual track": after RUNNING_* / HALTED, post-action mode resolution lands MANUAL when true, IDLE when false.

The `demoEnabled` flag from earlier versions of the code is dropped — the DEMO ↔ IDLE mode distinction encodes "is the auto-loop alive" directly.

## 4. DEMO mode

DEMO is the page-load entry state — a teaser that shows the machine reacting to inputs without requiring the user to do anything. The demo loop fires on a timer (~1 Hz) and applies one randomly chosen command per tick, drawn from the current tape's alphabet (40 % chance the head stays put with no write; otherwise pick a random symbol and a random direction).

The loop is entirely a main-thread effect; the worker doesn't see DEMO. The mirror machine receives commands directly via the same `ifOtherSymbol` one-step write path that §6 MANUAL exposes through Apply.

**Exits.** DEMO → IDLE on Build / Step / Run (cold-start path; the click signals intent and kills the loop); DEMO → MANUAL on Take Control (the user commits to the manual track). Errors during cold-start lead → HALTED via the cold-start error branch.

**Visible controls.** Build, Step, Run, Take Control. Apply is hidden (the loop generates commands itself; there's no role for a user-fired Apply in DEMO). Stop is hidden (no worker-side run to interrupt).

**Scenario IDs.**
- `S-build-demo` — reload, → IDLE.
- `S-step-demo-{off,on}` — cold-start Step. Worker arms `initialState.debug.after = true`, runs, → RUNNING_PAUSED. Per §7.
- `S-run-demo-{off,on}-{auto,cont}` — cold-start Run. → RUNNING_AUTO or RUNNING_CONTINUOUS by withPause. Per §7.
- `S-takectl-demo` — `userTookControl = true`, → MANUAL.

DEMO is entered only on initial page load. After any of the exits above, the user never returns to DEMO.

## 5. IDLE mode

IDLE is the post-interaction, pre-Take-Control resting state. The user has clicked Build / Step / Run (from DEMO or after a previous run) but hasn't committed to the manual track. The auto-loop is dead; the worker is built; the panel mirrors the worker's state but is read-only.

IDLE differs from MANUAL only by the `userTookControl` latch — once Take Control fires, IDLE → MANUAL and never returns.

**Exits.** Build (→ IDLE, reload — same code, fresh worker); Step / Run (→ RUNNING_*; cold-start path); Take Control (→ MANUAL, latch flips). Errors during cold-start lead → HALTED via the cold-start error branch.

**Visible controls.** Build, Step, Run, Take Control. Apply is hidden (Apply is MANUAL-only). Stop is hidden (no run in flight).

**Scenario IDs.**
- `S-build-idle` — reload, → IDLE.
- `S-step-idle-{off,on}` — cold-start Step. Per §7.
- `S-run-idle-{off,on}-{auto,cont}` — cold-start Run. Per §7.
- `S-takectl-idle` — `userTookControl = true`, → MANUAL.

A user who has run a machine to completion without ever clicking Take Control returns to IDLE — the spec preserves the IDLE track until the user explicitly opts in to MANUAL.

## 6. MANUAL mode

MANUAL is the committed resting state. `userTookControl = true`; the user is driving the machine via Apply. The panel is enabled and the user composes a `Command` (movement + symbol) which writes to the mirror via the same `ifOtherSymbol` one-step state used internally by Step.

Once entered, MANUAL is sticky: subsequent Build / Step / Run / completion all return to MANUAL.

**Exits.** Build (→ MANUAL, reload); Step / Run (→ RUNNING_*; cold-start); Apply (stays MANUAL, in-place mirror write). Errors during cold-start lead → HALTED.

**Visible controls.** Build, Step, Run, Apply. Take Control is hidden (already taken). Stop is hidden (no run in flight).

**Apply scenario.**
- `S-apply-manual` — main thread applies the user-composed `Command` to `mirrorMachine` via the `ifOtherSymbol` one-step state. No worker round-trip; the worker stays idle. Mode stays MANUAL. The log gets a single command entry per Apply.

The Apply button is **hidden** in DEMO, IDLE, and HALTED — it's MANUAL-only. Earlier code variants displayed a flashing "next random command" Apply button in DEMO; the spec drops that affordance and lets the DEMO loop render its commands inline on the panel.

**Cold-start scenarios from MANUAL.** See §7.
- `S-build-manual` — reload, → MANUAL.
- `S-step-manual-{off,on}` — cold-start Step.
- `S-run-manual-{off,on}-{auto,cont}` — cold-start Run.

## 7. Starting and resuming runs

The cold-start path (Build / Step / Run from IDLE, MANUAL, or HALTED — and DEMO's user-clicked equivalent) is unified: reload the worker, then either land back in a resting mode (Build) or enter `machine.run()` (Step / Run). The Resume sub-section covers Continue from RUNNING_PAUSED, which uses the same in-flight `run()` rather than reloading.

### Cold-start

The path is identical from IDLE, MANUAL, and HALTED. Each Build / Step / Run reloads the worker, builds a fresh mirror, then routes by action:

- **Build** — reload only. → IDLE if `!userTookControl`, → MANUAL if `userTookControl`.
- **Step** — reload, call `runner.run({ debug: debugMode, step: true })`. Worker sets `stepRequested = true`; `onIter` dispatches paused at end of iter 1 → RUNNING_PAUSED. With `debug=on` and a user-authored `state.debug.before` on `initialState`, the before-fire `onPause` interposes first; same target mode. **Step is a manual action — it ignores `intervalMs`.** Even if `withPause=on` and `intervalMs=1s`, the Step iter happens immediately (no throttle). The interval applies only to actual RUNNING_AUTO iters; clicking Step is not an auto iter. (Pre-v6.4.0 the Step boundary worked via arming `initialState.debug.after = true` and pausing at the after-fire; the engine's `onIter` hook in v6.4.0 lets the worker do this without mutating user state.)
- **Run** — reload, call `runner.run({ debug: debugMode })`. → RUNNING_AUTO (`withPause=on`, `onIter` awaits the throttle) or RUNNING_CONTINUOUS (`withPause=off`, `onIter` no-ops). Debug breaks during the run land → RUNNING_PAUSED.

If the reload itself fails (build error in user code), → HALTED with an error log; covered by walk-through 7.

```mermaid
flowchart TD
    Start([User clicks Build, Step, or Run from IDLE / MANUAL / HALTED])
    Start --> Reload[reload worker — build, mirror, alphabets]
    Reload --> Action{which action?}
    Reload -. build error .-> ErrorOut[→ HALTED with error log]
    Action -->|Build| Resolve1{userTookControl?}
    Resolve1 -->|true| ManualOut[→ MANUAL]
    Resolve1 -->|false| IdleOut[→ IDLE]
    Action -->|Step| RunStep[runner.run debug=debugMode, step=true]
    RunStep --> PauseOut[worker sets stepRequested; onIter dispatches paused after iter 1 → RUNNING_PAUSED]
    Action -->|Run| WithPause{withPause?}
    WithPause -->|true| RunAuto[runner.run debug=debugMode, intervalMs=N — onIter throttles each iter]
    RunAuto --> AutoOut[→ RUNNING_AUTO]
    WithPause -->|false| RunCont[runner.run debug=debugMode, no intervalMs — onIter no-ops]
    RunCont --> ContOut[→ RUNNING_CONTINUOUS]
```

**Cold-start scenario IDs.** Each origin (IDLE / MANUAL / HALTED) gets the same set:

- `S-build-{idle,manual,halted}` — reload, → IDLE / MANUAL by `userTookControl`.
- `S-step-{idle,manual,halted}-{off,on}` — Step cold-start. Off / on selects `debug` flag.
- `S-run-{idle,manual,halted}-{off,on}-{auto,cont}` — Run cold-start. Off / on selects `debug`; auto / cont selects `withPause`.

**DEMO origin.** Build / Step / Run from DEMO uses the same cold-start path; the click signals intent (kills the auto-loop) but doesn't flip `userTookControl`, so post-RUNNING_* completion and Build resolution land IDLE. Scenario IDs `S-build-demo`, `S-step-demo-{off,on}`, `S-run-demo-{off,on}-{auto,cont}` mirror the IDLE entries.

**Post-RUNNING_* completion** — when a run reaches halt naturally (or via Stop), the resolution is HALTED. The next Build / Step / Run from HALTED then resolves to IDLE or MANUAL by `userTookControl`. The track is preserved across the run.

### Resume from PAUSED

The Run / Continue button (labelled "Continue" throughout any RUNNING_*; only clickable in RUNNING_PAUSED) doesn't reload — it sends `runner.resume({ step: false })` and the worker continues inside the same in-flight `machine.run()` invocation. Two outcomes by `debug`:

- `S-continue-paused-off` — `runner.resume({ step: false })`. Debug breaks are not honored (worker-side `debugEnabled = false`), so the run continues to halt → HALTED on completion. Stop / error / timeout still terminate the worker normally.
- `S-continue-paused-on` — `runner.resume({ step: false })`. Debug breaks fire as encountered → next RUNNING_PAUSED. The user can click Continue again, repeating across multiple paused / resume cycles until halt or Stop.

The button's label is "Run" in the resting modes (DEMO / IDLE / MANUAL / HALTED) where the action is a cold start, and "Continue" in every RUNNING_* mode (resume / let the run finish). The button is enabled in resting modes and in RUNNING_PAUSED; disabled in RUNNING_AUTO / RUNNING_CONTINUOUS (the run is already advancing on its own).

Walk-through 3 expands these scenarios with per-segment timer behavior, log replay, and edge cases.

## 8. Action matrix

Mode-transition outcomes for user actions across the three running / paused modes. Each cell is a scenario ID + one-line outcome, or `—` for hidden / disabled.

**Matrix scope.** The matrix lists *user-action* exits only. Event-driven transitions — debug break firing, run completion, error, timeout, truncation — are not matrix rows. They appear in three other places: §1's master state diagram (edges), each mode's "Exit" line in §2 Mode reference, and walk-throughs 2 and 7-9. A reader looking only at the matrix should not conclude that, e.g., RUNNING_CONTINUOUS exits only via Stop or Take Control.

| Action | RUNNING_AUTO | RUNNING_CONTINUOUS | RUNNING_PAUSED |
|---|---|---|---|
| **Step (debug=off)** | `S-step-auto-off`: pause label — suspend run loop, → PAUSED | — | `S-step-paused-off`: arm `.after` on next state, resume(step), → PAUSED |
| **Step (debug=on)** | `S-step-auto-on`: pause label — suspend, → PAUSED | — | `S-step-paused-on`: arm `.after`, resume(step), → PAUSED (a user break may interpose first) |
| **Stop** | `S-stop-auto`: terminate, → HALTED | `S-stop-cont`: terminate, → HALTED | `S-stop-paused`: terminate, suppress failHalted, → HALTED |
| **Take Control** | `S-takectl-auto`: latch userTookControl=true, terminate, → MANUAL | `S-takectl-cont`: latch, terminate, → MANUAL | `S-takectl-paused`: latch, terminate, → MANUAL |

Notes:
- Every cell is a mode transition (or `—` for hidden / disabled). Flag-change actions (debug toggle, withPause toggle) live in §3 — they don't cause mode transitions.
- **Build is rendered but disabled across all RUNNING_* (AUTO / CONTINUOUS / PAUSED)** — a pending worker request blocks Build, including the paused-but-still-pending case. To rebuild, the user clicks Stop or Take Control first (terminate the worker), then Build is available from HALTED / MANUAL. The Stop → Build sequence keeps the worker tear-down explicit instead of silently destroying paused state on a stray Build click.
- All RUNNING_* paths use `run()`. "Pause" from RUNNING_AUTO suspends inside run-mode (the throttle's setTimeout) and lands in PAUSED — the same paused state used by debug breaks. The Pause affordance is the Step button with its label and icon flipped while RUNNING_AUTO; clicking it sends a `pause` request to the worker. In RUNNING_CONTINUOUS that same button stays labelled `Step` and is disabled (no per-iter checkpoint), so the user's only kill-switch is Stop.
- **RUNNING_CONTINUOUS shares most of RUNNING_AUTO's control surface** — Stop, Take Control, debug toggle all available. The throttle / animation differ, and the Step-→-Pause affordance is suppressed in CONTINUOUS (button rendered but disabled). Take Control mid-CONTINUOUS can lose the race to completion, but no race produces a broken state — terminate-or-complete are both clean exits.
- Run / Continue is a single-column action (only meaningful from RUNNING_PAUSED). It's documented in §7 Resume from PAUSED rather than in the matrix.
- DEMO, IDLE, MANUAL, HALTED are not matrix columns — they have their own sections (§4, §5, §6, §9).

## 9. HALTED mode

HALTED is the terminal state — the machine reached its halt state, was stopped, or hit an error / timeout / `MAX_STEPS` truncation. The tape is frozen at the final state; the worker is alive but idle (no run in flight). Build / Step / Run reload-from-code; Take Control flips the latch.

**Exits.** Build (→ IDLE if `!userTookControl`, → MANUAL if `userTookControl`), Step / Run (→ RUNNING_* via cold-start, see §7), Take Control (→ MANUAL, only when `!userTookControl` — otherwise the button is hidden).

**Visible controls.** Build, Step, Run. Take Control if `!userTookControl`. Apply hidden (Apply is MANUAL-only). Stop hidden (nothing to stop).

**Scenario IDs.**
- `S-build-halted` — reload, → IDLE / MANUAL by `userTookControl`. See §7.
- `S-step-halted-{off,on}` — cold-start Step. See §7.
- `S-run-halted-{off,on}-{auto,cont}` — cold-start Run. See §7.
- `S-takectl-halted` — `userTookControl = true`, → MANUAL. Available only when `!userTookControl`.

HALTED can be reached from any non-resting state. Build / Step / Run from HALTED, plus error and timeout handling, are walk-throughs in §10.

## 10. Scenario walk-throughs

Each walk-through expands a contested or non-obvious path with sequence, log entries, worker calls, and edge cases. Boundary cases only — straightforward paths (Build, Apply, cold-start Run with no breaks) are sufficiently covered by the matrix and §7.

### `S-step-paused-off` / `S-step-paused-on` — Step from break

**Sequence**
1. User clicks Step while in RUNNING_PAUSED.
2. Main thread arms `.after` on the relevant state — `m.state` if the current pause was a `before`-fire, `m.nextState` if it was an `after`-fire. The mutation is captured in `pendingRestore` for later un-application.
3. `runner.resume({ step: true })` resolves the worker's pending Promise with the step intent.
4. Worker un-applies any prior `pendingRestore`, then runs until the armed `.after` fire (or until a user-authored break interposes when `debug=on`).
5. Worker sends `paused`; main thread enters RUNNING_PAUSED with the new break info, runs `pendingRestore` for the new arm.

**Log entries**
- `paused at state <X> after applying command for symbols: [<syms>]`

**Worker calls**
- `resume({ step: true })`

**Edge cases**
- `debug=on`: a user-authored `.before` may interpose before the armed `.after` fires. Both produce a normal `paused` response; the long-format log line distinguishes them by `before` vs `after`.
- The halting iter's armed `.after` never fires (engine quirk). If the next iter halts the machine, the worker sends `ran` instead of a final `paused` — the run lands in HALTED. Tracked in [turing-machine-js#108](https://github.com/mellonis/turing-machine-js/issues/108).

The sequence diagram below shows the complete cycle: Run (debug=on) → break → Step → re-pause → Continue → halt or further breaks.

```mermaid
sequenceDiagram
    actor User
    participant Main as Main thread (MachineView)
    participant Worker
    participant Engine as machine.run()

    User->>Main: click Run [debug=on]
    Main->>Worker: postMessage { type: 'run', debug: true }
    Worker->>Engine: machine.run({ onPause })
    Engine-->>Worker: yield N, state.debug.before fires
    Worker-->>Main: { type: 'paused', state, currentSymbols, debugBreak: { before: true } }
    Note over Worker: timer suspended
    Note over Main: → RUNNING_PAUSED — log paused at state X before applying ...

    User->>Main: click Step
    Main->>Main: arm m.state.debug.after = true (pendingRestore captured)
    Main->>Worker: postMessage { type: 'resume', step: true }
    Note over Worker: timer restarted
    Worker->>Engine: resolve onPause Promise
    Engine-->>Worker: yield N+1, state.debug.after fires (armed)
    Worker->>Worker: pendingRestore() — undo arm
    Worker-->>Main: { type: 'paused', debugBreak: { after: true } }
    Note over Worker: timer suspended
    Note over Main: → RUNNING_PAUSED — log paused at state X after applying ...

    User->>Main: click Run (Continue)
    Main->>Worker: postMessage { type: 'resume', step: false }
    Note over Worker: timer restarted
    Worker->>Engine: resolve
    alt run completes naturally
        Engine-->>Worker: ... runs to halt
        Worker-->>Main: { type: 'ran', tapes, commands }
        Note over Main: → HALTED — log halted after N step(s)
    else another debug break fires (debug=on)
        Engine-->>Worker: yield M, state.debug.before fires
        Worker-->>Main: { type: 'paused', state, currentSymbols, debugBreak: { before: true } }
        Note over Main: → RUNNING_PAUSED — back to the break-cycle above
    end
```

### Walk-through 2 — Run with breakpoints (multi-paused cycle)

A Run with `debug=on` and user-authored `state.debug` triggers a sequence of paused / resume cycles. Each `paused` includes the current state, current symbols, and the `debugBreak` shape (`{ before: true }` or `{ after: true }`).

**Per-segment timer.** The worker's per-segment `WORKER_TIMEOUT_MS` (5 s) suspends on every `paused` and restarts on every `resume`-send. The same suspend/restart pair fires on every `idle`/`busy` bracket inside RUNNING_AUTO's throttle — a user inspecting a paused state for minutes (or picking a 60-second auto interval) does not trigger the timeout; only worker-side engine execution time counts.

**Log replay.** Each `paused` carries a `commands` array — the per-step commands buffered between this `paused` and the previous one. The main thread appends them to the log in order, so the trace is preserved across pauses without the worker re-sending the full history. In RUNNING_AUTO the buffer is drained per iter via `idle` so `paused.commands` is typically `[]` (the iters were already logged at the cadence); RUNNING_CONTINUOUS and cold-start Step use the buffer normally.

**Edge case — Stop while paused.** Worker is terminated; `runner.run()` rejects; `failHalted` is suppressed via `stopRequested`. Mode → HALTED with a `stopped` log entry. See walk-through 4.

### Walk-through 3 — Continue from break (`S-continue-paused-{off,on}`)

**Sequence (debug=off).**
1. User clicks Run while in RUNNING_PAUSED. The button reads "Continue".
2. Main thread sends `resume({ step: false })`.
3. Worker resolves the pending Promise. `debugEnabled = false` so `onPause` returns immediately on subsequent breaks.
4. Run continues to halt; worker sends `ran` → HALTED.

**Sequence (debug=on).**
1. Same start.
2. Worker resolves; `debugEnabled = true` so subsequent breaks pause normally.
3. Run continues until next break (→ another `paused` → RUNNING_PAUSED again), Stop, or halt (→ HALTED).

**Log entries**
- (debug=off, halt) `halted after N step(s)`
- (debug=on, next break) — same long-format line as walk-through 1's log: `paused at state <X> {before|after} applying command for symbols: [<syms>]`

**Worker calls**
- `resume({ step: false })`

### Walk-through 4 — Stop from each running mode

Stop is visible while in RUNNING_AUTO, RUNNING_CONTINUOUS, and RUNNING_PAUSED.

- `S-stop-auto` / `S-stop-cont` — main thread calls `runner.terminate()`. Worker is killed; `runner.run()` rejects with `runner terminated`. `failHalted` runs: rebuild mirror from worker's last-known tape state (or zeroed state if none), → HALTED with `stopped` log entry.
- `S-stop-paused` — same as above, but `stopRequested` is set on the runner first so `failHalted` is **suppressed** when the rejected Promise surfaces (the rejection is the expected outcome of Stop, not an error). → HALTED with `stopped` log entry only — no error log.

**Log entries**
- `stopped`
- (state mirror snapshot in matrix view)

**Edge case.** A Stop click that races with run completion: worker may have already sent `ran` when `terminate()` is called. The runner's `runPending` slot has been cleared; `terminate()` is a no-op on the runner side. The HALTED transition still happens via the normal completion path, with a `halted after N step(s)` log entry instead of `stopped`. No user-visible bug.

### Walk-through 5 — debug toggle mid-run

The `debugMode` UI checkbox is reactive across mode transitions. A change while in any RUNNING_* mode pushes `setDebug(on)` to the worker.

- `S-debug-toggle-auto` / `S-debug-toggle-cont` — `runner.setDebug(on)` posts a fire-and-forget message. Worker flips an internal `debugEnabled` flag. Subsequent `onPause` calls honor the new value (no run restart).
- `S-debug-toggle-paused` — same `setDebug()` send. The current paused state is unaffected; the next break (after Continue) is gated by the new flag value.
- In DEMO / IDLE / MANUAL / HALTED — flag flip only; no worker call (the worker is idle, the flag is read at the next `run()`).

**Log entries**
- (none — toggle is silent)

**Edge case.** Toggling debug=on while paused doesn't cause an immediate break — the user is already paused. After Continue, breaks fire normally.

### Walk-through 6 — Take Control mid-run

Take Control is visible in DEMO, IDLE (visible during cold-start RUNNING_*), HALTED (when `!userTookControl`), and any RUNNING_* mode.

- `S-takectl-auto` / `S-takectl-cont` / `S-takectl-paused` — main thread calls `runner.terminate()`. Worker is killed; `runner.run()` rejects via `rejectAll`. `userTookControl = true`. `failHalted` is suppressed via the same path as `S-stop-paused`. Mode → MANUAL.
- `S-takectl-demo` / `S-takectl-idle` — no run in flight, just latch + mode change. → MANUAL.
- `S-takectl-halted` — `userTookControl = true`, → MANUAL. Available only when `!userTookControl`.

**Log entries**
- `took control`

**Edge case.** Take Control from RUNNING_PAUSED is functionally identical to from RUNNING_AUTO / RUNNING_CONTINUOUS — the worker is paused, but `terminate()` kills it the same way. `runPending`'s onPaused callback is never called again because the runner's pending slot is cleared on terminate.

### Walk-through 7 — Error mid-run (and cold-start build error)

Errors come from two sources:

1. **Build error** — the worker's user-code build (cold-start) throws (parse error, runtime exception during initial setup). Worker sends `error` with no `tapes`. → HALTED with error log.
2. **Mid-run error** — the worker's `machine.run()` throws (typically: no edge in the state graph for the current symbol). Worker sends `error` with partial `tapes` (the snapshot at throw-time). → HALTED with error log.

Both surface as `WorkerError` in the runner; main thread's `failHalted` rebuilds the mirror from the partial `tapes` (when present) so the user sees the state where execution actually stuck — not the loaded tape with no record of the steps that ran.

- `S-error-{auto,cont,paused}` — mid-run error from each running mode. Same flow.

**Log entries**
- `error: <message>`

**Edge case.** Cold-start build errors don't have running-mode-specific scenario IDs in the matrix because they happen before any RUNNING_* mode is entered. Tested against from each cold-start origin (IDLE / MANUAL / HALTED / DEMO) — see §7's flowchart error branch.

### Walk-through 8 — Truncation (`S-truncate-{auto,cont}`)

A run that doesn't halt naturally hits `MAX_STEPS = 100_000` inside the worker's `runToEnd` cap. Worker sends `ran` with `truncated: true`.

- `S-truncate-auto` / `S-truncate-cont` — main thread receives `ran`. → HALTED with `truncated: did not halt within MAX_STEPS steps` log entry. Per-step entries are **suppressed** when `truncated: true` (band-aid until [#45](https://github.com/mellonis/machines-demo/issues/45) lands; rendering 100k log entries freezes the main thread for seconds).

**Log entries**
- `truncated: did not halt within MAX_STEPS steps`

**Edge case.** A debug-paused run that's then continued without `debug=off` won't truncate at the same point — the per-segment cap accrues across resume cycles, so a long-paused-then-resumed run could still hit MAX_STEPS in a later segment.

### Walk-through 9 — Worker timeout per segment (`S-timeout-{auto,cont,paused}`)

`WORKER_TIMEOUT_MS = 5_000` caps wall-clock time on each worker request **segment**. For `build` / `step` / `run`-without-pause it's a round-trip cap; for `run` with paused / resume cycles it's per-segment (suspends on `paused`, restarts on `resume`-send).

- `S-timeout-auto` / `S-timeout-cont` — segment exceeds 5 s. Runner kills the worker (terminate) and rejects with `timeout after 5000ms — worker terminated (likely infinite loop)`. → HALTED with timeout log.
- `S-timeout-paused` — only fires if the user clicks Continue or Step and the **resumed** segment exceeds 5 s. A paused state is not subject to timeout.

**Log entries**
- `timeout after 5000ms — worker terminated (likely infinite loop)`

**Edge case.** Today's API doesn't expose any callback hook to user code — `state.debug.before` / `state.debug.after` are filter values (`true | string[] | null`), not user-supplied functions, and the worker's `onStep` / `onPause` wrap the run on the demo side. So a "stall via async user callback" isn't reachable in the current surface. The per-segment cap defends against the cases that *are* reachable: infinite loops in user code, hung worker-side Promises, and any future API surface that might let user-supplied async logic interpose.

## 11. Current divergences from spec

A punchlist of where today's code differs from the spec, each with a tracking-issue link. Acts as a TODO list for follow-up PRs; #47 cites scenario IDs and `it.skip` divergent ones until they close.

- **IDLE mode does not exist.** Today's code encodes the post-Build, pre-Take-Control resting state via `(executionMode = DEMO, demoEnabled = false)`. Affects all `S-*-idle-*` IDs — they're served by `S-*-demo-*` paths today. Step from DEMO completes back to a still-running auto-loop that overwrites the result. Implementation tracked alongside [#46](https://github.com/mellonis/machines-demo/issues/46) (this spec); follow-up PR introduces IDLE and drops `demoEnabled`.
- **Halting iter's `state.debug.after` never fires.** Affects walk-through 1 edge case. Tracked in [turing-machine-js#108](https://github.com/mellonis/turing-machine-js/issues/108).
- **`haltState.debug.after` silently ignored; `haltState.debug.before` IS honored.** Tracked in [turing-machine-js#108](https://github.com/mellonis/turing-machine-js/issues/108).

## 12. Engine quirks

Upstream behaviors the spec encodes (won't change without a major upstream version, so the spec works around them):

- `onStep` is sync and not awaited (engine docstring: "must not be async"). The demo uses it purely to buffer commands. Per-iter awaited coordination lives on `onIter` (v6.4.0+). Cross-ref [turing-machine-js#163](https://github.com/mellonis/turing-machine-js/issues/163) for the hook's introduction.

§11 vs §12: §11 lists demo-side gaps to be closed; §12 lists engine semantics that won't change. Items can move from §12 to §11 if the upstream issue lands and a corresponding demo-side simplification becomes possible.

## 13. Cross-references

- [`CLAUDE.md`](../CLAUDE.md) — working conventions, file structure, build commands. Runtime-behavior content moved here.
- [`docs/superpowers/specs/2026-05-08-worker-run-mode-design.md`](superpowers/specs/2026-05-08-worker-run-mode-design.md) — the [#40](https://github.com/mellonis/machines-demo/issues/40) design; gives the *why* behind RUNNING_PAUSED and the worker contract.
- [#47](https://github.com/mellonis/machines-demo/issues/47) — test infrastructure that consumes the scenario IDs defined in this doc.
- [#46](https://github.com/mellonis/machines-demo/issues/46) — issue this spec resolves.

## 14. Scenario ID grammar

`<prefix>-<action-or-topic>-<context-or-facet>-<flags?>`

| Slot | Values |
|---|---|
| `S-` | literal prefix; marks the token as a UI-scenario reference. Used throughout §§4–10. |
| `R-` | runner / worker / helper internal scenarios (no UI counterpart). Format `R-<topic>-<facet>`, e.g. `R-protocol-build`, `R-timer-suspend-on-paused`. Used in `*.test.ts` files alongside `S-...` IDs. |
| `C-` | component-test scenarios. Format `C-<component>-<facet>`, e.g. `C-toolbar-run-label-default`, `C-toolbar-disabled-build`. Used in component test files (`*.test.ts` co-located with `.svelte` files). |
| `E-` | end-to-end scenarios — full UI flow including worker round-trip. Format `E-<from-state-or-context>-<facet>`, e.g. `E-cold-start-run-debug-off`. Used in `e2e/*.spec.ts`. |
| `<action>` (S only) | `build`, `step`, `run`, `continue`, `stop`, `takectl`, `apply`, `debug-toggle`, `withpause-toggle`, `error`, `truncate`, `timeout` |
| `<from-state>` (S only) | `demo`, `idle`, `manual`, `auto`, `cont`, `paused`, `halted` |
| `<topic>` (R / C / E) | `machineRunner.test.ts`: `protocol`, `timer`, `pending`, `error`. `workerHelpers.test.ts`: `movement-code`, `commands`, `snapshot`, `phase-guard`, `step-arm`. `logStore.test.ts`: `buffer-append`, `cap-overflow`, `cap-boundary`, `separator-skip-empty`, `latest-skips-separator`, `latest-synchronous`, `clear`, `dispose`, `flush-coalesce`, `flush-no-pending-timer`. `tapeSnapshot.test.ts`: `roundtrip`, `parse-not-json`, `parse-wrong-format`, `parse-unsupported-version`, `parse-wrong-shape-tapes`, `parse-wrong-shape-alphabets`, `parse-length-mismatch`. `Toolbar.test.ts`: `run-label`, `disabled`, `visibility`, `interval`, `callbacks`. `e2e/cold-start.spec.ts`: `cold-start`, `continue-from-step`, `stop-while-paused`. |
| `<facet>` (R only) | short descriptor — `build`, `step-cycle`, `suspend-on-paused`, `reject-overlap`, `wraps-error-with-tapes`, etc. |
| `<flags?>` (S only) | optional flag suffix(es); `on` / `off` (debug), `auto` / `cont` (withPause when ambiguous), or compound like `off-auto` |

Conventions:
- Lowercase + hyphen throughout. No shift key, easy to grep.
- One token per slot. Don't run flags together.
- Drop slots that don't matter — uniform behavior across flags ⇒ no flag suffix.
- Stable across spec edits — prefer adding new IDs over renaming.
- All four prefixes follow the regex `\b[SRCE]-[a-z-]+`. Tests / CI grep this to find every cited scenario.

Where IDs live:
- **Matrix cells** (§8): `S-step-paused-off: arm .after, resume(step), → PAUSED`. Text after `:` is the one-line outcome.
- **Walk-throughs** (§10): each opens with `### \`S-step-paused-off\` / \`S-step-paused-on\` — Step from break` so the ID is the section anchor.
- **Tests** ([#47](https://github.com/mellonis/machines-demo/issues/47)): each `it()` cites at least one ID. UI-flow tests cite `S-...` (component / E2E layers); runner / worker / helper tests cite `R-...`. Failing tests point straight at the spec rule they broke.
- **§11 entries**: cite the IDs they affect when describing today's divergences.
