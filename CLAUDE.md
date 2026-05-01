# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`mellonis/machines-demo` is a **Vite + Svelte 5 (runes) + TypeScript** interactive demo for the upstream Turing and Post machine libraries. Single-page app with two tabs (Turing, Post). User code runs in a Web Worker. Deployed at `demo.machines.mellonis.ru` via the `mellonis/vps` repo (manual rsync of `dist/` into `vps/static/demo.machines.mellonis.ru/`; no CI yet).

## Commands

- `npm run dev` — Vite dev server
- `npm run build` — `svelte-check` + production build into `dist/`
- `npm run preview` — preview the built bundle
- `npm run check` — `svelte-check` + `tsc --noEmit`
- `npm run lint` — ESLint flat config (typescript-eslint + eslint-plugin-svelte)

## Architecture

```
src/
├── App.svelte               header + tab nav + popstate routing
├── app.ts                   entry; mount()s <App>
├── app.css                  global tokens + base styles
├── components/
│   ├── MachineTab.svelte    per-engine orchestrator
│   ├── Tape.svelte          virtualized horizontal belt
│   ├── ControlPanel.svelte  L/S/R + alphabet chips + Apply
│   ├── Editor.svelte        CodeMirror 6 wrapper + reset overlay
│   ├── Log.svelte           log entries (desktop)
│   └── IconButton.svelte    icon + optional label
└── lib/
    ├── types.ts             Engine, Command, WorkerRequest/Response, MAX_STEPS
    ├── runner.ts            main-thread worker wrapper, 5s timeout
    ├── worker.ts            spawns user code via new Function inside worker
    ├── demoLoop.ts          idle-mode random-command loop
    ├── autoStep.ts          paused-auto-step controller + parseInterval
    ├── completions.ts       CodeMirror autocomplete: machine namespace + locals
    ├── syntaxLinter.ts      Lezer-based syntax-error markers
    ├── persist.ts           localStorage helpers per engine
    ├── defaultCode.ts       starter Turing / Post snippets
    ├── format.ts            describeCommand / formatTape / formatAlphabet
    └── icons.ts             Tabler icon namespace (?raw imports)
```

**`App.svelte`** picks the active engine from `?machine=` and renders one `<MachineTab engine={...}>` keyed by engine — switching engines unmounts and remounts the tab (kills CodeMirror undo, cheap CPU).

**`MachineTab.svelte`** is the orchestrator. It owns:

- `executionMode` (`$state<ExecutionMode>`) — see state machine below
- `entries`, `alphabet`, `lastSnapshot`, `halted`, `code`, `withPause`, `intervalText` — all `$state`
- `pendingOp: 'load' | 'run' | null` and `stepInFlight: boolean` — concurrency guards
- `panelEnabled` / `applyVisible` / `takeControlVisible` / `loadDisabled` / `stepDisabled` / `runDisabled` — all `$derived` from the above (single source of truth for button-disabled state)
- `$effect`s for the demo loop, auto-step loop, and belt-transitions toggle
- `runner = new MachineRunner(engine)` and the `doLoad` / `doStep` / `doRun` / `takeControl` / `resetCodeToDefault` handlers

## Execution modes

`ExecutionMode = 'DEMO' | 'MANUAL' | 'RUNNING_STEP' | 'RUNNING_AUTO' | 'RUNNING_CONTINUOUS' | 'HALTED'`

| Mode | Panel | Apply visible | Take control | Belt behavior |
|---|---|---|---|---|
| `DEMO` | disabled mirror | yes (flashes) | yes | timer-driven random commands; auto-stops on first user-clicked Load (`demoEnabled = false`) |
| `MANUAL` | enabled | yes | hidden | user-driven via Apply |
| `RUNNING_STEP` | disabled mirror | hidden | yes | one slide per Step click; also serves as the **paused** state for `RUNNING_AUTO` |
| `RUNNING_AUTO` | disabled mirror | hidden | yes | timer-driven worker steps; Step button shows pause icon + "Pause" label; click → `RUNNING_STEP` |
| `RUNNING_CONTINUOUS` | neutral cmd shown | hidden | hidden | snap-to-final, transitions off; per-step commands batch-logged after the worker returns |
| `HALTED` | disabled mirror | hidden | yes | frozen at final state |

Take control is the only entry into `MANUAL`. Once the user takes control, demo never restarts.

## Worker contract

All shapes are TS discriminated unions in `src/lib/types.ts`. Single canonical `Command = { movement: 'L'|'R'|'S'; symbol: string | null }` (`null` = "keep" — resolved symbol matched current).

| Request | Response |
|---|---|
| `{ type: 'load', engine, code }` | `{ type: 'loaded', tape, alphabet, halted, stepsApplied, nextCommand }` |
| `{ type: 'step' }` | `{ type: 'stepped', tape, halted, command, nextCommand, stepsApplied }` |
| `{ type: 'run', maxSteps? }` | `{ type: 'ran', tape, halted, truncated, commands, startStep, stepsApplied }` |

On any failure: `{ type: 'error', message, stack }`.

Worker assumes **single-tape** machines. Multi-tape machines throw a clear error from `commandFromYield` — see [GH issue #1](https://github.com/mellonis/machines-demo/issues/1) for tracking multi-tape display support.

## Tape (the belt)

`Tape.svelte` renders 23 cells (`VISIBLE_CELLS = 19` desktop + 2 buffer each side); CSS `--visible-cells` shrinks the viewport to show fewer at smaller breakpoints (17 tablet, 11 phone) — extra cells fade behind the mask. The `apply()` method does the prep-shift trick: re-render with new head via `$state` mutation, `await tick()`, then snap-translate by ±1 cell without transition, force reflow, transition back to 0. `await tick()` is critical — `queueMicrotask` would race Svelte's scheduler.

The head ▲ marker below each bottom belt is a **CSS-border triangle** (not a Unicode glyph) so its visible edges exactly match its box and `left:50%; translateX(-50%)` aligns pixel-perfect with the head-thread line. `.viewport` carries `background: var(--bg)` to mask the head-thread behind the stack across the whole tape row — without that, the 4px inter-cell gap passes through the head column during slide animations and exposes the line. `.cell.out-of-range` dims only border + symbol (not the whole cell via `opacity`) for the same masking reason.

## Multi-tape stack and head-thread connector

`MachineTab.svelte` renders `tapeCount` tapes inside `.tapes-stack` (flex column, 4px gap). Only the bottom belt shows the ▲ marker (`showCaret={i === tapeCount - 1}`); each belt gets a per-instance `caretColor` from the 5-entry `CARET_COLORS` palette (length must match `MAX_TAPES` in `lib/types.ts`).

A `.head-thread` div sits behind the stack as the first child of `.tapes-stack` and acts as a vertical connector from the top tape's caret box down to the bottom-belt ▲ marker. Implementation:
- `position: absolute; top: 0; bottom: 4px; left: 50%; width: 2px; transform: translateX(-50%);` — the `bottom: 4px` lands the line at the marker's vertical center (CSS triangle is 8px tall).
- `background` is a hard-stop `linear-gradient` built in `headThreadBackground` ($derived): paired stops `color[i] top, color[i] bot` per tape, so each tape row is solid in its color and transitions happen only in the inter-tape gap. Stops are pixel offsets driven by `--cell-h` and `--tape-gap` set on `.tapes-stack`.
- The line is masked invisibly through every tape row by `.viewport`'s opaque `--bg`; only the inter-tape gaps and the bottom-belt's 14px padding (where the marker lives) remain visible.

**Coupling — keep in sync:** `MachineTab.svelte` duplicates Tape.svelte's responsive `--cell-h` (40 / 36 / 34 px at the same breakpoints) on `.tapes-stack` so the gradient stops align with actual tape positions. Touching either file's cell-height values means touching both.

## Conventions

- **localStorage** keys `machines-demo:code:turing` / `machines-demo:code:post` persist editor contents (via `lib/persist.ts`, errors swallowed).
- **`report(text, kind?)`** in MachineTab is the single log entry point — appends to `entries`. The latest entry doubles as the mobile status line via `latestEntry $derived`.
- **Animation timings** are CSS variables in `app.css`: `--anim-belt-slide-ms`, `--anim-belt-enter-ms`, `--anim-belt-enter-delay-panel-ms`, `--anim-button-hover-ms`.
- **Icons**: Tabler outline SVGs imported as raw strings (`?raw`) and rendered via `{@html}` — `eslint-plugin-svelte`'s `no-at-html-tags` is off because all sources are build-time, never user-controlled. The Web Worker is the security boundary for user code.
- **`untrack(() => engine)`** at MachineTab/Editor init: engine is a prop but each MachineTab instance has a fixed engine (parent uses `{#key activeEngine}`); the untrack acknowledges the intentional one-time read and silences Svelte's reactive-prop warning.
- **`:global(...)`** in `Editor.svelte` styles is the official escape hatch for CodeMirror's third-party DOM (`.cm-editor`, `.cm-scroller`, etc.) — Svelte's CSS scoping would otherwise mangle the selectors.

## Editor

- `svelte-codemirror-editor` (Svelte-5-native wrapper around CodeMirror 6) with `bind:value`.
- Extensions: `javascript()` lang, `oneDark` theme, our `importsCompletion(engine)` (boost-99 machine identifiers + local-identifier completion source from `@codemirror/lang-javascript`), and a Lezer-based `syntaxLinter` for syntax-error markers before Load.
- A small reset-to-default button overlays the editor's top-right corner (matches the log-clear pattern).

## Deploy

`dist/` lands in `mellonis/vps`'s `static/demo.machines.mellonis.ru/`, then rsynced to `/var/web-apps/demo.machines.mellonis.ru/` on the box. Served by the `demo.machines.mellonis.ru` nginx site (CSP includes `'unsafe-eval'` because user-supplied JS still runs via `new Function()` inside a Web Worker — the worker is the security boundary, CSP narrows everything else: no third-party scripts, no inline event handlers, no embedding).
