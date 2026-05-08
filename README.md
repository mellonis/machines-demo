# machines-demo

[![GitHub issues](https://img.shields.io/github/issues/mellonis/machines-demo)](https://github.com/users/mellonis/projects/5)

Interactive in-browser playground for **Turing** and **Post** machines.

**Live demo:** [demo.machines.mellonis.ru](https://demo.machines.mellonis.ru)

Two tabs (Turing, Post) where you write JavaScript that builds a machine — using the published [`@turing-machine-js/machine`](https://www.npmjs.com/package/@turing-machine-js/machine) and [`@post-machine-js/machine`](https://www.npmjs.com/package/@post-machine-js/machine) libraries — and watch it execute on an animated tape. Auto-running demo on first load, manual control of the tape head via a movement/symbol/Apply panel, single-step and paused-auto-step execution, and a log of every command applied.

## Running locally

```sh
npm install
npm run dev
```

The dev server prints a URL; open it in a browser.

## Scripts

```sh
npm run dev        # Vite dev server
npm run build      # type-check + production build into dist/
npm run preview    # preview the built bundle
npm run check      # svelte-check + tsc (no emit)
npm run lint       # ESLint flat config
```

Static bundle emitted to `dist/`. Serve with any static host. The build references hashed assets, so far-future caching is safe.

## Tech

- [Vite](https://vitejs.dev/) + [Svelte 5](https://svelte.dev/) (runes mode) + TypeScript
- [CodeMirror 6](https://codemirror.net/) via [`svelte-codemirror-editor`](https://www.npmjs.com/package/svelte-codemirror-editor); Lezer-based syntax preflight before Load
- [Tabler Icons](https://tabler.io/icons) (SVG `?raw` imports)
- User code runs inside a Web Worker — terminate-on-timeout sandbox, with `'unsafe-eval'` only at the worker level so the worker is the actual security boundary
- `@turing-machine-js/machine` and `@post-machine-js/machine` (peer-dependency relationship preserved)

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

        requests:   build / step / run
        responses:  built / stepped / ran / error
```

**Crosses the boundary:** `TapeSnapshot[]` (on `built` / `ran` / `error`), per-step `Command[]` (movement + written symbol), tape alphabets — plain data only.

**Never crosses:** the user's code, the `TuringMachine` / `State` / `Reference` instances it constructs, and the upstream library singletons (`haltState`, `ifOtherSymbol`, the `movements` Symbols). Identity-checked sentinels wouldn't survive `structuredClone`, and keeping user code worker-side is what justifies `'unsafe-eval'` in CSP — the worker is the actual security boundary.

## Layout

```
src/
├── App.svelte               # header + tab nav + popstate routing
├── app.ts                   # entry; mounts <App>
├── app.css                  # global tokens + base styles
├── components/
│   ├── MachineView.svelte   # per-engine orchestrator (one $state, derived disabled flags)
│   ├── Tape.svelte          # virtualized belt with prep-shift slide trick
│   ├── ControlPanel.svelte  # L/S/R + alphabet chips + Apply
│   ├── Editor.svelte        # CodeMirror wrapper + localStorage persist
│   ├── Log.svelte           # entries list (desktop) / latest line (mobile)
│   └── IconButton.svelte    # icon + optional label
└── lib/
    ├── types.ts             # Engine, Command, WorkerRequest/Response, ...
    ├── runner.ts            # main-thread worker wrapper, 5s timeout
    ├── worker.ts            # spawns user code via new Function inside worker
    ├── demoLoop.ts          # idle-mode random-command loop
    ├── autoStep.ts          # paused-auto-step controller
    ├── completions.ts       # CodeMirror autocomplete from machine namespace
    ├── syntaxLinter.ts      # Lezer-based syntax-error markers
    ├── persist.ts           # localStorage helpers per engine
    ├── defaultCode.ts       # starter Turing / Post snippets
    ├── format.ts            # describeCommand / formatTape / formatAlphabet
    └── icons.ts             # Tabler icon namespace
```

## License

[GPL-3.0-or-later](LICENSE)
