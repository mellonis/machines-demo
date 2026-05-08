# Execution model and debugger semantics

> Canonical reference for what each mode does, what each user action triggers, and where the machine lands. Tests in [#47](https://github.com/mellonis/machines-demo/issues/47) cite the scenario IDs (`S-...`) defined throughout. Working conventions and file structure remain in [`CLAUDE.md`](../CLAUDE.md).

## 1. Overview

The demo runs user-typed JavaScript inside a Web Worker that drives a `@turing-machine-js/machine` v4 instance. The main thread tracks the worker's progress with a 7-mode state machine: three resting states (DEMO, IDLE, MANUAL), three running states (RUNNING_AUTO, RUNNING_CONTINUOUS, RUNNING_PAUSED), and one terminal (HALTED).

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
The worker is running inside `machine.run({ onStep })` with a per-step throttle (the `withPause` interval). Belt animations follow the cadence; the user can click Pause to suspend.
Entry: Run from IDLE / MANUAL / HALTED with `withPause=on`; Continue from RUNNING_PAUSED with `withPause=on`.
Exit: Pause (→ RUNNING_PAUSED), debug break with `debug=on` (→ RUNNING_PAUSED), Stop (→ HALTED), run completion (→ HALTED), Take Control (→ MANUAL).

### RUNNING_CONTINUOUS
The worker is running inside `machine.run({ onStep })` with no throttle — snap-to-final. Belt animation is suppressed; per-step commands batch-log on completion. Same control surface as RUNNING_AUTO.
Entry: Run from IDLE / MANUAL / HALTED with `withPause=off`; Continue from RUNNING_PAUSED with `withPause=off`.
Exit: debug break with `debug=on` (→ RUNNING_PAUSED), Stop (→ HALTED), run completion (→ HALTED), Take Control (→ MANUAL).

### RUNNING_PAUSED
The worker is suspended inside `machine.run()` awaiting a `resume` message from the main thread. Reachable from any RUNNING_* mode via debug break, click-pause, or cold-start arming. The button labeled "Run" elsewhere reads "Continue" here.
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

The loop is entirely a main-thread effect; the worker doesn't see DEMO. The mirror machine receives commands directly via the same `ifOtherSymbol` one-step path used by Apply.

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
- **Step** — reload, arm `initialState.debug.after = true` (preserving any user-authored `state.debug.before`), call `runner.run({ debug: debugMode, step: true })`. Worker pauses at iter 1's after-fire → RUNNING_PAUSED. With `debug=on` and a user-authored `state.debug.before` on `initialState`, the before-fire interposes first; same target mode.
- **Run** — reload, call `runner.run({ debug: debugMode })`. → RUNNING_AUTO (`withPause=on`, with throttled `onStep`) or RUNNING_CONTINUOUS (`withPause=off`, no throttle). Debug breaks during the run land → RUNNING_PAUSED.

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
    Action -->|Step| ArmAfter[arm initialState.debug.after = true; preserve user-authored .before]
    ArmAfter --> RunStep[runner.run debug=debugMode, step=true]
    RunStep --> PauseOut[→ RUNNING_PAUSED at iter 1 after-fire]
    Action -->|Run| WithPause{withPause?}
    WithPause -->|true| RunAuto[runner.run debug=debugMode, with throttled onStep]
    RunAuto --> AutoOut[→ RUNNING_AUTO]
    WithPause -->|false| RunCont[runner.run debug=debugMode, no throttle]
    RunCont --> ContOut[→ RUNNING_CONTINUOUS]
    AutoOut -. user-authored break .-> PauseOut
    ContOut -. user-authored break .-> PauseOut
    RunStep -. user-authored .before fires before iter 1 after .-> PauseOut
```

**Cold-start scenario IDs.** Each origin (IDLE / MANUAL / HALTED) gets the same set:

- `S-build-{idle,manual,halted}` — reload, → IDLE / MANUAL by `userTookControl`.
- `S-step-{idle,manual,halted}-{off,on}` — Step cold-start. Off / on selects `debug` flag.
- `S-run-{idle,manual,halted}-{off,on}-{auto,cont}` — Run cold-start. Off / on selects `debug`; auto / cont selects `withPause`.

**DEMO origin.** Build / Step / Run from DEMO uses the same cold-start path; the click signals intent (kills the auto-loop) but doesn't flip `userTookControl`, so post-RUNNING_* completion and Build resolution land IDLE. Scenario IDs `S-build-demo`, `S-step-demo-{off,on}`, `S-run-demo-{off,on}-{auto,cont}` mirror the IDLE entries.

**Post-RUNNING_* completion** — when a run reaches halt naturally (or via Stop), the resolution is HALTED. The next Build / Step / Run from HALTED then resolves to IDLE or MANUAL by `userTookControl`. The track is preserved across the run.
