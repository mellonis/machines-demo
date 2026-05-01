# machines-demo

Interactive in-browser playground for **Turing** and **Post** machines.

**Live demo:** [demo.machines.mellonis.ru](https://demo.machines.mellonis.ru)

Two tabs (Turing, Post) where you write JavaScript that builds a machine — using the published [`@turing-machine-js/machine`](https://www.npmjs.com/package/@turing-machine-js/machine) and [`@post-machine-js/machine`](https://www.npmjs.com/package/@post-machine-js/machine) libraries — and watch it execute on an animated tape. Auto-running demo on first load, manual control of the tape head via a movement/symbol/Apply panel, single-step and paused-auto-step execution, and a log of every command applied.

## Running locally

```sh
npm install
npm run dev
```

The dev server prints a URL; open it in a browser.

## Build

```sh
npm run build
```

Static bundle emitted to `dist/`. Serve with any static host. The build references hashed assets, so far-future caching is safe.

## Tech

- [Vite](https://vitejs.dev/) (vanilla JS, no framework)
- [CodeMirror 6](https://codemirror.net/) for the editor
- [Tabler Icons](https://tabler.io/icons) (SVG `?raw` imports)
- User code runs inside a Web Worker — terminate-on-timeout sandbox, with `'unsafe-eval'` only at the worker level so the worker is the actual security boundary
- `@turing-machine-js/machine` and `@post-machine-js/machine` (peer-dependency relationship preserved)

## License

[GPL-3.0-or-later](LICENSE)
