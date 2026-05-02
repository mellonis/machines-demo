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

## Layout

```
src/
├── App.svelte               # header + tab nav + popstate routing
├── app.ts                   # entry; mounts <App>
├── app.css                  # global tokens + base styles
├── components/
│   ├── MachineTab.svelte    # per-engine orchestrator (one $state, derived disabled flags)
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
