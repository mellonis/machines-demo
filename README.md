# machines-demo

[![GitHub issues](https://img.shields.io/github/issues/mellonis/machines-demo)](https://github.com/users/mellonis/projects/5)

Interactive in-browser playground for **Turing** and **Post** machines.

**Live demo:** [demo.machines.mellonis.ru](https://demo.machines.mellonis.ru)

A landing page (`/`) introduces both engines through a column of showcase panels — each panel auto-plays a prerecorded run of one small program, with the state graph, tape, and a step-by-step execution-trace table laid out beside human-readable lesson notes that describe what the program is doing. From there, two engine tabs (`/turing`, `/post`) drop you into an editor where you write JavaScript that builds a machine — using the published [`@turing-machine-js/machine`](https://www.npmjs.com/package/@turing-machine-js/machine), [`@post-machine-js/machine`](https://www.npmjs.com/package/@post-machine-js/machine), and [`@turing-machine-js/visuals`](https://www.npmjs.com/package/@turing-machine-js/visuals) (highlight + graph-indexing surface) libraries — and watch it execute on an animated tape. Manual control of the tape head via a movement/symbol/Apply panel, single-step and paused-auto-step execution, a log of every command applied, and clipboard copy/paste of the tape-block state for sharing or restoring snapshots.

## Running locally

```sh
npm install
npm run dev
```

The dev server prints a URL; open it in a browser.

## Scripts

```sh
npm run dev            # Vite dev server
npm run build          # type-check + production build into dist/
npm run preview        # preview the built bundle
npm run check          # svelte-check + tsc (no emit)
npm run lint           # ESLint flat config
npm test               # Vitest one-shot (runner / helper tests)
npm run test:watch     # Vitest watch mode
npm run test:coverage  # Vitest with v8 coverage; output in coverage/
npm run test:e2e       # Playwright E2E (Chromium; builds, then runs `vite preview` automatically)
npm run test:e2e:ui    # Playwright interactive mode for local debugging (builds first)
```

Static bundle emitted to `dist/`. Serve with any static host. The build references hashed assets, so far-future caching is safe.

## Tech

- [Vite](https://vitejs.dev/) + [Svelte 5](https://svelte.dev/) (runes mode) + TypeScript
- [CodeMirror 6](https://codemirror.net/) via [`svelte-codemirror-editor`](https://www.npmjs.com/package/svelte-codemirror-editor); Lezer-based syntax preflight before Load
- [Tabler Icons](https://tabler.io/icons) (SVG `?raw` imports)
- User code runs inside a Web Worker — terminate-on-timeout sandbox, with `'unsafe-eval'` only at the worker level so the worker is the actual security boundary
- `@turing-machine-js/machine` and `@post-machine-js/machine` (peer-dependency relationship preserved); `@turing-machine-js/visuals` for the highlight + graph-indexing surface that drives `MachineGraph.svelte`'s breakpoint dots, pulse animations, frame-active marks, and the engine edge-label log notation

## Architecture: two lands

User code and the engine live inside a Web Worker. The main thread holds the UI plus a *mirror* — a real `TuringMachine` instance whose tapes shadow the worker's state by replaying every command the worker reports. The two sides only communicate by `postMessage`, and only plain data crosses.

```
                          browser tab

   ┌────────────────────────────┬────────────────────────────┐
   │  MAIN THREAD               │  WEB WORKER                │
   │  (Svelte UI + mirror)      │  (user code + engine)      │
   │                            │                            │
   │  <MachineView>             │  new Function(userCode)    │
   │  Editor / Toolbar / Log    │     ↓                      │
   │                            │  user-built machine        │
   │  mirrorMachine             │   + State graph            │
   │  mirrorTapeBlock           │   + TapeBlock / Tapes      │
   │   rebuilt from             │   + runStepByStep gen      │
   │   TapeSnapshots;           │                            │
   │   replays worker           │                            │
   │   commands one step        │                            │
   │   at a time                │                            │
   └────────────────────────────┴────────────────────────────┘

                      ↕  postMessage

        requests:   build / step / run / resume / pause / setDebug / toggleBreakpoint
        responses:  built / stepped / ran / paused / idle / busy / breakpointToggled / error
```

**Crosses the boundary:** `TapeSnapshot[]` (on `built` / `ran` / `error` / `paused`), per-step `Command[]` (movement + written symbol), tape alphabets, plus pause metadata (state name, current symbols, the `pause: {side?, cause}` descriptor) on `paused` — plain data only.

**Never crosses:** the user's code, the `TuringMachine` / `State` / `Reference` instances it constructs, and the upstream library singletons (`haltState`, `ifOtherSymbol`, the `movements` Symbols). Identity-checked sentinels wouldn't survive `structuredClone`, and keeping user code worker-side is what justifies `'unsafe-eval'` in CSP — the worker is the actual security boundary.

## Layout

```
src/
├── App.svelte                  # header + tab nav + popstate routing
├── app.ts                      # entry; mounts <App>
├── app.css                     # global tokens + base styles
├── components/
│   ├── MachineView.svelte      # per-engine orchestrator (one $state, derived disabled flags)
│   ├── Landing.svelte          # `/` route — engine switcher + showcase grid; owns the single IntersectionObserver and dispatches `active: boolean` so only one snippet plays at a time
│   ├── SnippetPanel.svelte     # showcase tile — two-column layout (player + lesson notes); 4-state playback machine driven by `active`
│   ├── ExecutionTraceTable.svelte  # 6-column read-only execution trace inside the player column
│   ├── TapesStack.svelte       # multi-tape stack with shared head-thread
│   ├── Tape.svelte             # virtualized belt with prep-shift slide trick
│   ├── ControlPanel.svelte     # L/S/R + alphabet chips + Apply
│   ├── Toolbar.svelte          # Build/Step/Run/Stop + with-pause + examples menu
│   ├── Toolbar.test.ts         # Vitest suite for Toolbar — 5 topic groups
│   ├── Editor.svelte           # CodeMirror wrapper + localStorage persist
│   ├── Log.svelte              # entries list (desktop) / latest line (mobile)
│   ├── IconButton.svelte       # icon + optional label
│   ├── DiagnosticsCounter.svelte  # E / W / I pill overlay in the editor's bottom-right; each pill hides at count 0
│   └── SettingsPanel.svelte    # header gear — modal exposing the tunable caps (max run steps / worker timeout / log render cap)
└── lib/
    ├── types.ts                # Engine, Command, Alphabets, WorkerRequest/Response (TapeSnapshot + Graph imported from @turing-machine-js/{visuals,machine})
    ├── caps.ts                 # numeric caps: VIEWPORT_WIDTH, MAX_STEPS, WORKER_TIMEOUT_MS, MAX_TAPES, PROGRESS_INTERVAL_MS
    ├── settings.ts             # user-tunable caps over localStorage — validated overrides of the caps.ts defaults
    ├── machineRunner.ts        # main-thread worker wrapper; per-segment timeout; injected workerFactory
    ├── machineRunner.test.ts   # Vitest suite for MachineRunner — protocol-shape / timer / pending / error
    ├── machineWorker.ts        # spawns user code via new Function inside worker
    ├── workerHelpers.ts        # pure helpers extracted from machineWorker (movementCode, commandsFromYield, snapshot*, expectPhase, armStepAfter)
    ├── workerHelpers.test.ts   # Vitest suite for workerHelpers — 5 topic groups
    ├── testUtils.ts            # FakeWorker + makeFakeFactory test helpers
    ├── log.ts                  # log-entry types + helpers
    ├── logStore.svelte.ts      # per-MachineView log store — buffer + throttled view + overflow cap
    ├── logStore.test.ts        # Vitest suite for LogStore
    ├── initialBoot.ts          # pure helper — engine-page boot priority (?example > ?snippet > localStorage > default)
    ├── initialBoot.test.ts     # Vitest suite for initialBoot
    ├── completions/            # context-aware, schema-driven CodeMirror autocomplete
    │   ├── schema/               # typed const describing engine + post API surface
    │   ├── scan/                 # Lezer walker — infers user-local types + tracks imports destructure
    │   ├── contexts/             # 5 CompletionSource factories (memberAccess, debugAssignment, optionsBag, destructureBag, namespaceIdentifier)
    │   ├── apply/                # auto-import — inserts undestructured names into the top `const {…} = imports;` block
    │   ├── hints/                # signature help — tooltip describing the active argument of the enclosing call
    │   └── lint/                 # schema-driven linters — arg count, Post cross-references, unbound identifiers
    ├── syntaxLinter.ts         # Lezer-based syntax-error markers
    ├── persist.ts              # localStorage helpers per engine
    ├── tapeSnapshot.ts         # serialize/parse tape-block snapshots for copy+paste
    ├── tapeSnapshot.test.ts    # Vitest suite for tapeSnapshot
    ├── defaultCode.ts          # starter Turing / Post snippets — Example.lessonNotes carries the showcase prose
    ├── format.ts               # LogEntry assemblers (commandsEntry / tapesEntry); per-step string rendering from @turing-machine-js/visuals
    ├── lessonMarkdown.ts       # tiny markdown subset (paragraphs / bullets / inline code) for SnippetPanel lesson prose
    ├── icons.ts                # Tabler icon namespace
    ├── theme.svelte.ts         # theme (light / dark) state + matchMedia watcher
    ├── diagnosticsCounter.svelte.ts  # DiagnosticsCounter class (runes counts by severity) + ViewPlugin that retallies per transaction
    └── diagnosticsCounter.test.ts    # Vitest suite for DiagnosticsCounter

e2e/
├── abort.spec.ts                 # Playwright E2E — abort outcome + terminal highlight, both engines
├── cold-start.spec.ts            # Playwright E2E — cold-start scenarios for engine pages
├── completions.spec.ts           # Playwright E2E — smart completions roundtrip
├── diagnostics-counter.spec.ts   # Playwright E2E — counter pills fed by real lint sources; pill clears when the code is fixed
├── landing.spec.ts               # Playwright E2E — landing page panels + engine switch + deep-link to editor
├── settings.spec.ts              # Playwright E2E — settings persistence + a lowered step cap bounding a real run
├── stale-build.spec.ts           # Playwright E2E — stale-build notice on the Build button
└── worker-termination.spec.ts    # Playwright E2E — tape restore from the last progress heartbeat after timeout / hand Stop

playwright.config.ts              # Chromium project; webServer = vite preview
```

## License

[GPL-3.0-or-later](LICENSE)
