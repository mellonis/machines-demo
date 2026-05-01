# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`mellonis/machines-demo` is a Vite vanilla-JS interactive demo for the upstream Turing and Post machine libraries. Single-page app with two tabs (Turing, Post). User code runs in a Web Worker. Deployed at `demo.machines.mellonis.ru` via the `mellonis/vps` repo (manual rsync of `dist/` into `vps/static/demo.machines.mellonis.ru/`; no CI yet).

## Commands

- `npm run dev` — Vite dev server.
- `npm run build` — emits `dist/`.
- `npm run preview` — preview the built bundle.

## Architecture

Files that matter for understanding flow:

- **`src/main.js`** — top-level wiring. Per-tab state machine, demo loop, run/step/load/take-control handlers. Imports `package.json` for the in-app version line.
- **`src/uiBelt.js`** — virtualized horizontal belt with the head pinned at viewport center. Owns its own `(symbols, head)` model, independent of the worker's tape until the next reseed via `setFromSnapshot`. `apply({symbol, movement}, {animate})` does the prep-shift trick: re-render with new head, set `transform: translateX(±pitch)` (no transition), force reflow, add `.transitions-on`, set `transform: translateX(0)`. CSS variables drive cell width/gap/visible-cells so the mobile breakpoint shrinks layout without JS changes.
- **`src/controlPanel.js`** — the L/S/R + alphabet + Apply UI. Selection state `{movement, symbol|KEEP}` (`KEEP` is a `Symbol.for(...)`). `reflect(cmd)` mirrors a command (used by demo and step-by-step), `flashApply()` briefly highlights Apply.
- **`src/worker.js`** — runs the user's machine. Drives the upstream `runStepByStep` generator. Tracks a `pendingCommand` (the next-yielded value, captured but not yet applied) so each `step()` response carries `{command, nextCommand}` — `command` is the one just applied, `nextCommand` is a preview shown on the panel after the slide finishes.
- **`src/runner.js`** — main-thread wrapper around the Web Worker. Spawns/terminates, serializes one in-flight request at a time, enforces a 5s timeout (terminates the worker on timeout — that's the "infinite loop" guard).
- **`src/icons.js`** — re-exports Tabler SVGs as raw strings via Vite `?raw` imports.

## State machine (in `main.js`)

`MODE = DEMO | MANUAL | RUNNING_STEP | RUNNING_AUTO | RUNNING_CONTINUOUS | HALTED`.

| Mode | Panel | Apply visible | Take control | Belt behavior |
|---|---|---|---|---|
| `DEMO` | disabled mirror | yes (flashes during sequence) | yes | timer-driven random commands; auto-stops on first user-clicked Load |
| `MANUAL` | enabled | yes | hidden | user-driven via Apply |
| `RUNNING_STEP` | disabled mirror | hidden | yes | one slide per Step click; also serves as the **paused** state for `RUNNING_AUTO` |
| `RUNNING_AUTO` | disabled mirror | hidden | yes | timer-driven worker steps; Step button shows pause icon + label "Pause"; click → `RUNNING_STEP` |
| `RUNNING_CONTINUOUS` | disabled, neutral cmd shown | hidden | hidden | snap-to-final, transitions off; per-step commands batch-logged after the worker returns |
| `HALTED` | disabled mirror | hidden | yes | frozen at final state |

Take control is the only entry into `MANUAL`. Once the user takes control, demo never restarts (`demoEnabled = false`).

## Worker contract

Messages from main thread → worker:

- `{type: 'load', mode, code}` → `{type: 'loaded', tape, alphabet, halted, stepsApplied, nextCommand}`
- `{type: 'step'}` → `{type: 'stepped', tape, halted, applied, command, nextCommand, stepsApplied}`
- `{type: 'run', maxSteps?}` → `{type: 'ran', tape, halted, ranSteps, truncated, commands, startSteps, stepsApplied}`

`command` shape: `{movement: 'L'|'R'|'S', symbol: string | null}` (`null` = KEEP — the upstream resolved symbol matched what was already under the head, so no effective write).

`commands` (only on `ran`) is every per-step command in order; `startSteps` is the step counter before the run, so the i-th command has step number `startSteps + i + 1`.

## Conventions

- Reactive button label/icon swaps go through `setButtonIcon(btn, svg)` which preserves `.btn-label`. The Step button uses `setStepIcon(mode)` to swap forward/pause icons + "Step"/"Pause" labels.
- `report(text, kind)` is the single status/log entry point — updates the status line (mobile-only, single-line ellipsis) and appends a `.log-line` to the log panel (desktop-only).
- `localStorage` keys `machines-demo:code:turing` and `machines-demo:code:post` persist the editor contents.
- Animation timings: belt slide 400ms (`BELT_ANIM_MS`), demo reflect-then-apply delay 700ms (`DEMO_REFLECT_DELAY_MS`), demo cycle 1600ms (`DEMO_INTERVAL_MS`), auto-step minimum interval 500ms (`MIN_AUTO_INTERVAL_MS`).
- Run-button enabled state is gated through `setRunDisabled(intent)` which combines the intent flag with interval-validity (when `with pause` is checked) and mirrors the result onto the checkbox's `disabled`.

## Deploy

`dist/` lands in `mellonis/vps`'s `static/demo.machines.mellonis.ru/`, then rsynced to `/var/web-apps/demo.machines.mellonis.ru/` on the box. Served by the `demo.machines.mellonis.ru` nginx site (CSP includes `'unsafe-eval'` because user-supplied JS still runs via `new Function()` inside a Web Worker — the worker is the security boundary, CSP narrows everything else: no third-party scripts, no inline event handlers, no embedding).
