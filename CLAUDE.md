# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`mellonis/machines-demo` is a **Vite + Svelte 5 (runes) + TypeScript** interactive demo for the upstream Turing and Post machine libraries. Single-page app with two tabs (Turing, Post). User code runs in a Web Worker. Deployed at `demo.machines.mellonis.ru` via GitHub Actions on push to `master` (`.github/workflows/main.yml`: build + rsync straight to the VPS; matches the `mellonis/contacts` CI pattern). Doc-only changes are skipped via `paths-ignore`.

## Commands

- `npm run dev` — Vite dev server
- `npm run build` — `svelte-check` + production build into `dist/`
- `npm run preview` — preview the built bundle
- `npm run check` — `svelte-check` + `tsc --noEmit`
- `npm run lint` — ESLint flat config (typescript-eslint + eslint-plugin-svelte)
- `npm test` — Vitest one-shot. Runner / helper tests run in node; component tests opt into happy-dom via the `// @vitest-environment happy-dom` per-file pragma. `vitest.setup.ts` registers `@testing-library/jest-dom` matchers globally.
- `npm run test:watch` — Vitest watch mode
- `npm run test:coverage` — Vitest with v8 coverage; output in `coverage/` (gitignored)
- `npm run test:e2e` — Playwright E2E (Chromium; runs `vite preview` automatically; tests in `e2e/`)
- `npm run test:e2e:ui` — Playwright interactive mode for local debugging

## Architecture

```
src/
├── App.svelte               header + tab nav + popstate routing
├── app.ts                   entry; mount()s <App>
├── app.css                  global tokens + base styles
├── components/
│   ├── MachineView.svelte   per-engine orchestrator (state + handlers)
│   ├── TapesStack.svelte    multi-tape stack with shared head-thread
│   ├── Tape.svelte          single horizontal belt (renders a turing.Tape)
│   ├── ControlPanel.svelte  L/S/R + alphabet chips + Apply
│   ├── Toolbar.svelte       Build/Step/Run/Stop + with-pause + examples menu
│   ├── Toolbar.test.ts      Vitest suite for Toolbar — runLabel / disabled / visibility / interval / callbacks (cites C-toolbar-...)
│   ├── Editor.svelte        CodeMirror 6 wrapper + reset overlay
│   ├── Log.svelte           log entries (desktop)
│   └── IconButton.svelte    shared corner-overlay icon button (reset / clear)
└── lib/
    ├── types.ts                Engine, Command, Alphabets, WorkerRequest/Response, TapeSnapshot
    ├── caps.ts                 numeric caps: VIEWPORT_WIDTH, MAX_STEPS, WORKER_TIMEOUT_MS, MAX_TAPES
    ├── machineRunner.ts        main-thread worker wrapper; WORKER_TIMEOUT_MS per-segment cap; injected workerFactory
    ├── machineRunner.test.ts   Vitest suite for MachineRunner — protocol-shape / timer / pending / error categories (cites R-... / S-... scenario IDs)
    ├── machineWorker.ts        spawns user code via new Function inside worker; imports pure logic from workerHelpers.ts
    ├── workerHelpers.ts        pure helpers extracted from machineWorker — movementCode, commandsFromYield, snapshot*, expectPhase
    ├── workerHelpers.test.ts   Vitest suite for workerHelpers — 5 topic groups (movement-code, commands, snapshot, phase-guard, step-arm)
    ├── testUtils.ts            FakeWorker + makeFakeFactory test helpers
    ├── log.ts                  log-entry types + helpers shared by Log.svelte
    ├── logStore.svelte.ts      per-MachineView log store — non-reactive #buffer + setTimeout-throttled $state view, LOG_RENDER_CAP slice with synthetic overflow header, buffer-sourced reactive `latest` getter
    ├── logStore.test.ts        Vitest suite for LogStore — buffer-append / cap / separator / latest / clear / dispose / flush-* (cites R-logstore-...)
    ├── demoLoop.ts             idle-mode random-command loop
    ├── interval.ts             parseInterval + MIN_AUTO_INTERVAL_MS for the RUNNING_AUTO throttle
    ├── completions.ts          CodeMirror autocomplete: machine namespace + locals
    ├── syntaxLinter.ts         Lezer-based syntax-error markers
    ├── persist.ts              localStorage helpers per engine — code, example, snippets (UUID-keyed)
    ├── tapeSnapshot.ts         serialize/parse for tape-block copy+paste snapshots — JSON with `format`/`version` discriminator, categorized ParseError, no DOM/clipboard knowledge
    ├── tapeSnapshot.test.ts    Vitest suite for tapeSnapshot — roundtrip / parse-not-json / wrong-format / unsupported-version / wrong-shape-* / length-mismatch (cites R-snapshot-...)
    ├── defaultCode.ts          starter Turing / Post snippets
    ├── format.ts               describeAppliedCommand / formatTape / commandsEntry / tapesEntry
    ├── icons.ts                Tabler icon namespace (?raw imports)
    └── theme.svelte.ts         theme (light / dark) state + matchMedia watcher (Svelte 5 .svelte.ts module)

e2e/
└── cold-start.spec.ts          Playwright E2E — 4 cold-start scenarios (cites E-cold-start-...)

playwright.config.ts            Chromium project; webServer runs `npm run preview`

.github/workflows/
├── main.yml                    CD: build + rsync to VPS on push to master
└── test.yml                    PR gate: check / lint / vitest / playwright
```

**`App.svelte`** picks the active engine from the URL pathname (`/turing`, `/post`) and renders one `<MachineView engine={...}>` keyed by engine — switching engines unmounts and remounts the tab (kills CodeMirror undo, cheap CPU). Legacy `?machine=<engine>` URLs are rewritten to the path form on first load. SPA-fallback routing is required (nginx `try_files $uri $uri/ /index.html;` in `vps/nginx/sites/demo.machines.mellonis.ru`; Vite default in dev).

**`MachineView.svelte`** is the orchestrator (UI is split into `TapesStack`, `Toolbar`, `ControlPanel`, `Editor`, `Log`). It owns:

- `executionMode` (`$state<ExecutionMode>`) — see state machine below
- `alphabets`, `lastSnapshots`, `halted`, `code`, `withPause`, `intervalText` — all `$state` (multi-tape: `alphabets`/`lastSnapshots` are per-tape arrays)
- `log` — a per-instance `LogStore` (`lib/logStore.svelte.ts`); owns the unbounded non-reactive `#buffer` and the throttled `entries: $state<LogEntry[]>` view (`setTimeout(_, 16)` coalesce + `LOG_RENDER_CAP = 5000` slice with synthetic overflow header). `log.latest` is the buffer-sourced, reactive (via internal `#version` counter) getter used for mobile status — synchronous on every `report()`, no 16ms lag.
- `selectedExampleId`, `snippets`, `loadedSnippetId` — all `$state`. `loadedSnippetId` is the UUID of the currently loaded user snippet (or `null` for a bundled example); drives `sourceCode`, `dirty`, and `resetVisible` ($derived). See the *Snippets* section below.
- `pendingOp: 'load' | 'run' | null` and `stepInFlight: boolean` — concurrency guards
- `panelEnabled` / `applyVisible` / `takeControlVisible` / `loadDisabled` / `stepDisabled` / `runDisabled` / `tapeCount` — all `$derived` (single source of truth for UI state)
- `mirrorMachine` / `mirrorTapeBlock` — a real `TuringMachine` instance on the main thread that mirrors the worker's tape state. Built by `_buildMirrorMachine` after each `reloadWorker`; advanced one step at a time by `_runMirrorStep` (uses an `ifOtherSymbol` one-step `State` so the upstream library's transitions drive the visualization, not bespoke UI code). `renderFromMirror` hands each `mirrorTapeBlock.tapes[i]` to the matching `<Tape>` via `TapesStack.setFromTape(i, tape, …)`.
- `$effect`s for the demo loop, auto-step loop, belt-transitions toggle, and a code-changed warning (debounced via `codeChangedWarned` flag — fires once per running session)
- `runner = new MachineRunner(engine, () => new MachineWorker())` and the `doLoad` / `doStep` / `doRun` / `takeControl` / `stopMachine` / `resetCodeToSelected` / `onCopy` / `onPaste` handlers; `reloadWorker(source?)` is the shared "build worker + rebuild mirrorMachine" helper, taking optional source code (defaults to current `code`) so DEMO can run the canonical `selectedExample.code` regardless of editor state. The factory argument keeps the Vite-specific `?worker` import in `MachineView.svelte`; `machineRunner.ts` is plain TypeScript and accepts any `MachineWorkerLike` (real `Worker` or `FakeWorker` from `testUtils.ts`). `onCopy` / `onPaste` use `navigator.clipboard.{writeText,readText}` and the `lib/tapeSnapshot.ts` serialize/parse pair; paste is mirror-only (next Build reloads the worker from the editor code).

**Execution model and debugger semantics:** see [`docs/execution-model.md`](docs/execution-model.md).

## Worker contract

All shapes are TS discriminated unions in `src/lib/types.ts`. Single canonical `Command = { movement: 'L'|'R'|'S'; symbol: string | null }` (`null` = "keep" — resolved symbol matched current). All response payloads are **per-tape arrays** — N=1 for single-tape, N=K for K-tape (`tapeBlock.fromTapes([...K])`).

| Request | Response |
|---|---|
| `{ type: 'build', engine, code }` | `{ type: 'built', tapes, alphabets, halted }` |
| `{ type: 'step' }` | `{ type: 'stepped', halted, commands, nextCommands, stepsApplied }` |
| `{ type: 'run', maxSteps?, debug?, step? }` | `{ type: 'ran', tapes, truncated, commands, startStep, stepsApplied }` (or interleaved `paused`s, see below) |
| `{ type: 'resume', step? }` | `paused` (next break) or `ran` (halt) |
| `{ type: 'setDebug', on }` | (no response — fire-and-forget; flips worker-side `debugEnabled` flag) |

`paused` interleaves with `ran`/`error` on the run channel: `{ type: 'paused', tapes, commands, stepsApplied, state, currentSymbols, pause }` where `pause: { side?: 'before' | 'after'; cause: 'breakpoint' | 'step' | 'manual' }` (engine #102 — mirrors the engine's `m.pause`; `side` absent on worker-synthesized Step / click-pause boundaries, whose `cause` is `'step'` / `'manual'`). The runner's `run({ onPaused })` Promise stays pending across paused/resume cycles; only `ran` / `error` complete it. Per-segment timer suspends on `paused`, restarts on `resume`-send, killed on `ran` / `error`.

On any failure: `{ type: 'error', message, tapes? }`. When the worker errors mid-step / mid-run (typical case: no edge in the state graph for the current symbol), the response also carries the partial tape state. The runner wraps `error` responses in a `WorkerError` (custom class with a `tapes` field); `MachineView.svelte#failHalted` rebuilds the mirror and updates `lastSnapshots` from those tapes — without this, the user would see only the loaded tape and lose every step the worker actually applied before throwing.

`stepped` deliberately omits `tapes` — applying a `Command` to a `Tape` is deterministic, so the main-thread `mirrorMachine` replays the worker's commands and is the source of truth for tape rendering during stepping. The worker only ships full tape state on `built` (initial state) and `ran` (final state after a continuous run, where replaying thousands of commands on the mirror would be wasteful).

`TapeSnapshot = { symbols, position }` is the **wire format** carrying tape data across the worker boundary (not the UI's render input). `position` is the head index into `symbols`. Producer:

- **Worker on `built` / `ran` / `error`** — full tape, no trim. Trimming would lose user-tape data outside the initial render window; once the user takes control and moves the head, blanks would appear where original symbols should be. `machineWorker.ts` does **not** mutate user `t.viewportWidth` (the library's `normalise()` would pad `t.symbols` and surprise user code), and just clones `t.symbols` plus `t.position`.

The main thread converts each `TapeSnapshot` to a `turing.Tape` once via `_buildMirrorMachine` (passes `viewportWidth: VIEWPORT_WIDTH` to the constructor; the library's `normalise()` pads `#symbols` so `tape.viewport` returns exactly `VIEWPORT_WIDTH` cells). Per-step rendering then hands the **library tape itself** to `Tape.svelte#setFromTape`, which reads `tape.viewport` (the library's slice/center math, length guaranteed to be `VIEWPORT_WIDTH`).

**Caps** (all in `lib/caps.ts`):
- `MAX_TAPES = 5` — multi-tape limit; the worker rejects loads with more tapes than the caret palette can color.
- `MAX_STEPS = 100_000` — `run`-mode hard cap; if `runToEnd` reaches it before the machine halts, the response sets `truncated: true`. Same backstop as `WORKER_TIMEOUT_MS` but counts steps instead of wall-clock time, so a tight loop that never yields still terminates eventually.
- `WORKER_TIMEOUT_MS = 5_000` — wall-clock cap on a single worker request **segment**. For `build` / `step` / `run`-without-pause it's a round-trip cap. For `run` with paused/resume cycles it's per-segment: timer suspends on each `paused` (user is inspecting; no clock), restarts on `resume`-send, killed on `ran`/`error`. The `MachineRunner` schedules a `setTimeout` and kills the worker (terminate + respawn next request) if any segment exceeds it.
- `VIEWPORT_WIDTH = 23` — see Tape section below.

Tape derivation in `machineWorker.ts` prefers `tapeBlock.tapes` so a user adapting the single-tape default snippet to multi-tape doesn't silently see only tape 0.

## Tape (the belt)

`Tape.svelte` renders `VIEWPORT_WIDTH = 23` cells (constant in `lib/caps.ts`, must be odd so the head sits at the exact middle); CSS `--visible-cells` shrinks the visual viewport to show fewer at smaller breakpoints (17 tablet, 11 phone) — extra cells fade behind the mask. The single render path is `setFromTape(tape, delta?, animate?, wrote?)` — `tape` is a `turing.Tape` instance (the upstream library type; mirror tapes have `viewportWidth = VIEWPORT_WIDTH` set, so `tape.viewport` returns exactly the render window), `delta` is ±1/0 (the head movement), `animate` toggles the slide, `wrote` triggers a one-shot flash on the just-written cell (its strip index is `MIDDLE_INDEX - delta` — at slide-start that cell sits at the visual center and rides outward as the strip settles; gated by `prefers-reduced-motion`). `setFromTape(null)` clears.

Cell shape is `Cell = { sym: string; blank: boolean }` — `sym` is the literal alphabet symbol (no UI substitution; the user's chosen blank glyph is rendered as-is), `blank` is a flag that tags cells holding `tape.alphabet.blankSymbol`. The flag drives a CSS sugar (`.cell.blank` — dim border, dim symbol opacity) so blank cells are visually distinct from non-blank ones **without overloading any specific character**. This means a user can put `'␣'` in their alphabet as a non-blank symbol with zero collision: blank cells render their actual blank glyph dimmed, the `'␣'` cells render at full opacity.

The component owns no tape state of its own beyond the fixed-size `viewport: $state<Cell[]>` (length always `VIEWPORT_WIDTH`). The slide animation uses the prep-shift trick: write `viewport`, `await tick()`, snap-translate by ±1 cell without transition, force reflow, transition back to 0. `await tick()` is critical — `queueMicrotask` would race Svelte's scheduler.

The head ▲ marker below each bottom belt is a **CSS-border triangle** (not a Unicode glyph) so its visible edges exactly match its box and `left:50%; translateX(-50%)` aligns pixel-perfect with the head-thread line. `.viewport` (CSS class on the outer wrapper, not the JS variable) carries `background: var(--bg)` to mask the head-thread behind the stack across the whole tape row — without that, the 4px inter-cell gap passes through the head column during slide animations and exposes the line.

**Bundled Turing examples use `' '` (space) as the blank symbol** — matching the Post machine's fixed blank — so both tabs feel consistent. Blank cells render dimmed (`.cell.blank` CSS) regardless of which character is chosen as blank.

## Multi-tape stack and head-thread connector

`TapesStack.svelte` renders `tapeCount` tapes inside `.tapes-stack` (flex column, 4px gap). Only the bottom belt shows the ▲ marker (`showCaret={i === tapeCount - 1}`); each belt gets a per-instance `caretColor` from the 5-entry `CARET_COLORS` palette (length must match `MAX_TAPES` in `lib/caps.ts`). The stack owns its own per-tape refs and exposes an imperative API (`setFromTape(i, tape, delta?, animate?, wrote?)`, `clearAll()`, `setTransitionsEnabled(on)`) — `MachineView.svelte` holds a `tapesStackRef` and calls these.

A `.head-thread` div sits behind the stack as the first child of `.tapes-stack` and acts as a vertical connector from the top tape's caret box down to the bottom-belt ▲ marker. Implementation:
- `position: absolute; top: 0; bottom: 4px; left: 50%; width: 2px; transform: translateX(-50%);` — the `bottom: 4px` lands the line at the marker's vertical center (CSS triangle is 8px tall).
- `background` is a hard-stop `linear-gradient` built in `headThreadBackground` ($derived inside `TapesStack`): paired stops `color[i] top, color[i] bot` per tape, so each tape row is solid in its color and transitions happen only in the inter-tape gap. Stops are pixel offsets driven by `--cell-h` and `--tape-gap` set on `.tapes-stack`.
- The line is masked invisibly through every tape row by `.viewport`'s opaque `--bg`; only the inter-tape gaps and the bottom-belt's 14px padding (where the marker lives) remain visible.

**Coupling — keep in sync:** `TapesStack.svelte` duplicates `Tape.svelte`'s responsive `--cell-h` (40 / 36 / 34 px at the same breakpoints) on `.tapes-stack` so the gradient stops align with actual tape positions. Touching either file's cell-height values means touching both.

## Machine graph (state diagram)

`MachineGraph.svelte` renders the engine-v7 `Graph` snapshot (captured at Build via `State.toGraph`) as a Mermaid flowchart with ELK layout. The component lazy-loads both `mermaid` and `@mermaid-js/layout-elk` on mount to keep them off the initial bundle.

**Rendering pipeline:**
- `toMermaid(g)` → strip engine `classDef tag_*` (so the demo owns the palette) → `applyDirection(source, isNarrow ? 'TD' : 'LR')` → `mermaid.render(id, source, measureEl)`. The third arg is a hidden offscreen `<div>` we create in `onMount` — without it, mermaid v11's `render()` appends a temp `<div + svg>` to `document.body` for measurement, briefly extending page height and "jumping" the footer on every Build. The measureEl pattern keeps that temp DOM contained.
- Render cache: `lastSource = ${theme.resolved}::${source}`. Skipped on cache hit (same machine + same theme + same direction) so back-to-back Builds don't re-paint identical SVG. Stale-render guard inside the async render kills races when the user mashes Build.
- Responsive direction: `LR` ≥768px, `TD` <768px (watched via `matchMedia`, re-renders on change).
- Fixed-height container (`.body { height: 360px }`) so the panel footprint stays stable across Builds even when the rendered SVG's intrinsic size varies (ELK layout isn't byte-stable). SVG is sized via `zoom: 0.8` (not `transform: scale`) so layout matches visual and `getBoundingClientRect` scroll-into-view math stays accurate.

**Palette tokens** (declared in `src/app.css`, all under `:root` with `:root[data-theme='light']` overrides):
- Defaults: `--graph-node-fill` (uses `--cell-bg`), `--graph-node-stroke`, `--graph-text` — neutral state-node visuals.
- Tagged states: `--graph-node-tagged-fill` / `--graph-node-tagged-stroke`. The engine emits `tag_<name>` classes; demo overrides all tags with one unified accent treatment (so user tags don't get the engine's per-tag hash colors). Selector is `g.node[class*='tag_']`.
- Halt: `--graph-node-halt-stroke`, `--graph-node-halt-inner-fill`. Restored as a double-stroke ring — `.outer-circle { fill: none; stroke: --halt-stroke }` + `.inner-circle { fill: --halt-inner-fill; stroke: --halt-stroke }`. Without per-class rules the two circles collapse into a single solid disc and halt loses its "terminal" affordance.
- Edges: `--graph-edge` for `-->` solid; `--graph-edge-thick` for `==>` (the wrapper-to-bare call arrow, mermaid class `edge-thickness-thick`); `--graph-edge-dotted` for `-. enter / return / halt .->`. All three default to the same color in the current palette — mermaid's per-pattern stroke-dasharray / stroke-width does the differentiation.
- Edge labels: `--graph-edge-label-bg` lifts a bit toward `--fg` so labels "float" over the surface rather than merging into adjacent node fills. Background is set on `g.edgeLabel foreignObject div`, `span.edgeLabel`, `.labelBkg` AND inner `p` — mermaid puts a hardcoded gray on the inner `<p>` that the outer rules don't reach.
- Subgraph wrappers (v7 callable subtrees): `--graph-cluster-fill`/`--graph-cluster-stroke`, plus a forced `stroke-dasharray: 6 4` on `g.cluster rect` (mermaid's default emit leaves dasharray="none" so cluster containers visually merge with state nodes — the dashed border makes them read as structural wrappers).
- Debugger pause highlight (`--graph-highlight`, `--graph-highlight-soft-fill`, `--graph-highlight-strong-fill`): **decoupled from `--head`** — the highlight uses `#f59e0b` (amber) in dark, `#f97316` (vivid orange) in light. The tape head marker keeps `--head` for itself; the graph highlight has its own visual identity as a runtime debugger cue. CSS classes (`mg-highlight-from`, `mg-highlight-to`, `mg-highlight-strong`, `mg-highlight-edge`) are added imperatively to cached SVG elements when `paused` arrives. The highlight-edge selector must qualify with `.flowchart-link` (`path.flowchart-link.mg-highlight-edge`) to beat the dotted/thick edge rules' two-class selectors on specificity.

**Theme swap is live** — `getComputedStyle` follows CSS vars instantly, no re-render needed. Source-cache invalidates on theme change anyway as a safety net.

**Palette sandbox** at `docs/palette-sandbox/` is a standalone HTML page (served by Vite at `/docs/palette-sandbox/variant-a.html`) for iterating on colors without rebuilding the demo. Dual-pane (light + dark side by side), color-picker per token, "Copy CSS (both themes)" button exports a snippet ready to paste into `src/app.css`. Edit `sample.svg` if you need a different machine shape to design against — re-export from the live demo by writing user code to localStorage + clicking Build (see `docs/palette-sandbox/README.md`).

## Conventions

- **localStorage** keys follow `machines-demo:<engine>:<key>` hierarchy (non-engine key `machines-demo:theme` is the only exception): `code` persists editor contents, `example` the selected bundled example id, `snippets` the user snippet map (keyed by UUID → `{ title, code, savedAt }`). The currently loaded snippet's UUID is **not** stored here — it lives in the URL (`?snippet=<uuid>`) so it's bookmarkable / shareable. (Via `lib/persist.ts`, errors swallowed.)
- **`log.report(text, kind?)`** in MachineView is the single log entry point — appends to the LogStore buffer and schedules a 16ms flush. `log.reportSeparator()` pushes a `{separator: true}` entry that `Log.svelte` renders as an `<hr>`; called before each Build / first-Step / Run so distinct sessions read as visually grouped. The mobile-status `latestEntry $derived` (now `$derived(log.latest)`) skips separator and overflow-header entries.
- **CSS nesting** is used throughout (native, no preprocessor) — Vite's CSS pipeline handles it; supported by all evergreen browsers. Keep nesting shallow (≤2 levels) to preserve specificity readability.
- **No UI substitution of alphabet symbols.** The user picks the blank glyph in their alphabet; the UI renders the literal symbol. CSS classes (`Tape.svelte#.cell.blank`, `ControlPanel.svelte#.cp-btn.blank`) provide visual hints (dim border / opacity) so blank cells remain recognisable regardless of which character was chosen — no character is reserved for "blank visualization", so no alphabet glyph collides with one.
- **Upstream-bug workarounds carry an issue link.** When code shapes itself around a bug or quirk in `@turing-machine-js/machine` (or another upstream), add a `WORKAROUND for <repo>#<n> — when that lands, …` block describing what to revert once the upstream fix ships. No current entries.
- **Animation timings** are CSS variables in `app.css`: `--anim-belt-slide-ms`, `--anim-belt-enter-ms`, `--anim-belt-enter-delay-panel-ms`, `--anim-button-hover-ms`.
- **Icons**: Tabler outline SVGs imported as raw strings (`?raw`) and rendered via `{@html}` — `eslint-plugin-svelte`'s `no-at-html-tags` is off because all sources are build-time, never user-controlled. The Web Worker is the security boundary for user code.
- **`untrack(() => engine)`** at MachineView/Editor init: engine is a prop but each MachineView instance has a fixed engine (parent uses `{#key activeEngine}`); the untrack acknowledges the intentional one-time read and silences Svelte's reactive-prop warning.
- **`:global(...)`** in `Editor.svelte` styles is the official escape hatch for CodeMirror's third-party DOM (`.cm-editor`, `.cm-scroller`, etc.) — Svelte's CSS scoping would otherwise mangle the selectors.
- **No static literal fallbacks in `var()`.** A `var()` fallback must itself be another CSS custom property (e.g. `var(--dot, var(--head))`) — never a hardcoded color, length, or time. Literals leak out of the design system and bypass theming. Two patterns satisfy this:
  - **Globally-scoped tokens** (colors, surface vars, animation timings) — declared in `:root` in `app.css`. Optionally promoted to `@property` for type-checking and animatable customs (e.g. `@property --anim-button-hover-ms { syntax: '<time>'; inherits: true; initial-value: 120ms }`). When `@property`'s `initial-value` must mirror another token (it can't reference `var()`), document the coupling with a `/* follows --x — keep in sync when theming */` comment above the literal value.
  - **Optional, per-element customs** (e.g. `--dot` in `ControlPanel.svelte`) — either fall back to another token at the read site (`var(--dot, var(--head))`) or declare a class-level default (`.tape-dot { --dot: var(--head); background: var(--dot) }`). Pick the class-level default when the same custom is read in multiple places, the inline fallback when it's a one-off.
- **Selector convention for E2E**: buttons use accessible names (text content, role-based queries via Playwright's `getByRole`); non-button DOM (tape cells, log entries, container wrappers) uses `data-testid` attributes (e.g. `data-testid="tape-cell"`, `data-testid="log-line"`). Tape cells additionally carry `data-blank={cell.blank}` and log lines carry `data-kind={entry.kind ?? ''}` for filter-by-attribute queries.

## Snippets

User-saved code lives in `localStorage` under `machines-demo:<engine>:snippets`, keyed by UUID → `{ title, code, savedAt }`. Title is user-visible (matches the save-popover input); UUID is the stable identity that survives renames and is the share key (issue #24).

The currently loaded snippet's UUID lives in the URL query string (`?snippet=<uuid>`), not in localStorage. On mount, MachineView reads it; on `loadedSnippetId` change a `$effect` rewrites it via `history.replaceState` (no history entries — switching engines is the only operation that pushes). If the URL UUID isn't in `snippets`, MachineView reports `snippet not found: <uuid>` once and falls back to the `code` localStorage key. The bad param is dropped on the next state change (the `$effect` writes the canonical URL).

Reset and save UIs share two derivations in MachineView:
- `sourceCode` — the code Reset would restore: the loaded snippet's saved code, or the selected bundled example's code, or `null` when the loaded snippet was deleted (no target).
- `dirty` = `sourceCode !== null && code !== sourceCode` — drives the accent dot on the save icon, the popover's *Save changes* button enabled state, and `resetVisible` (alias of `dirty`). When the editor matches its source — or `sourceCode` is null — both the reset button and the dirty dot disappear, since clicking them would be a no-op.

Save UX (Toolbar.svelte):
- Click the floppy → open popover. With a snippet loaded, the popover shows *Save changes to "<title>"* (primary, accent border) plus an *or save as new* section with a name input.
- ⌘S / Ctrl-S → silently saves the loaded snippet via `onSaveChanges`; opens the popover when nothing is loaded.
- ⌘⇧S / Ctrl-Shift-S → always opens the popover (Save As).
- The keydown listener `preventDefault`s to suppress the browser's *Save Page* dialog and is a no-op when the popover is already open (so Enter inside the input keeps its meaning).

`saveSnippet` matches by `title` to preserve the UUID on overwrite, returning `{ id, snippet }` so MachineView can sync `snippets` reactively without re-reading localStorage.

## Editor

- `svelte-codemirror-editor` (Svelte-5-native wrapper around CodeMirror 6) with `bind:value`.
- Extensions: `javascript()` lang, `oneDark` theme, our `importsCompletion(engine)` (boost-99 machine identifiers + local-identifier completion source from `@codemirror/lang-javascript`), and a Lezer-based `syntaxLinter` for syntax-error markers before Build.
- A small reset-to-selected-example button overlays the editor's top-right corner; the log's clear button uses the same shared `IconButton.svelte` (corner-overlay variant) — both are absolutely positioned within their `position: relative` parent (`.editor` / `.log-panel`).

## Deploy

`dist/` lands in `mellonis/vps`'s `static/demo.machines.mellonis.ru/`, then rsynced to `/var/web-apps/demo.machines.mellonis.ru/` on the box. Served by the `demo.machines.mellonis.ru` nginx site (CSP includes `'unsafe-eval'` because user-supplied JS still runs via `new Function()` inside a Web Worker — the worker is the security boundary, CSP narrows everything else: no third-party scripts, no inline event handlers, no embedding).
