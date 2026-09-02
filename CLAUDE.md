# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`mellonis/machines-demo` is a **Vite + Svelte 5 (runes) + TypeScript** interactive demo for the upstream Turing and Post machine libraries and for the Rust machine toolchains. Single-page app with four tabs, in header order: Turing · Post · TM-1 · PM-1 (each pair Turing-machine first). User code runs in a Web Worker. Deployed at `demo.machines.mellonis.ru` via GitHub Actions on push to `master` (`.github/workflows/main.yml`: build + rsync straight to the VPS; matches the `mellonis/contacts` CI pattern). Doc-only changes are skipped via `paths-ignore`.

## Commands

- `npm run dev` — Vite dev server
- `npm run build` — `svelte-check` + production build into `dist/`
- `npm run preview` — preview the built bundle
- `npm run check` — `svelte-check` + `tsc --noEmit`
- `npm run lint` — ESLint flat config (typescript-eslint + eslint-plugin-svelte)
- `npm test` — Vitest one-shot. Runner / helper tests run in node; component tests opt into happy-dom via the `// @vitest-environment happy-dom` per-file pragma. `vitest.setup.ts` registers `@testing-library/jest-dom` matchers globally.
- `npm run test:watch` — Vitest watch mode
- `npm run test:coverage` — Vitest with v8 coverage; output in `coverage/` (gitignored)
- `npm run test:e2e` — Playwright E2E (Chromium; tests in `e2e/`). Runs `npm run build` first, then `vite preview` via `playwright.config.ts`'s `webServer`. **The build step is load-bearing:** `vite preview` serves `dist/` exactly as it finds it and never rebuilds, so without it the suite silently tests a stale bundle — passing on deleted code or failing on working code. Putting the build in the npm script rather than `webServer.command` is deliberate: `reuseExistingServer` is true outside CI, so a leftover preview server would skip the command entirely.
- `npm run test:e2e:ui` — Playwright interactive mode for local debugging (builds first, same reason)
- `npm run fetch:wasm` — fetches the pinned machine-toolchains wasm bundle into `vendor/mtc-wasm/` (also runs on `postinstall`; no-op when the cache already verifies against `toolchains-wasm.json`)
- `npm run test:scripts` — `node --test` over `scripts/*.test.mjs` (the fetch/verify/override logic in `scripts/fetch-toolchains-wasm.mjs`, outside the Vitest suite since it exercises real filesystem, tar, and a loopback HTTP server)

## Dependency notes

**`typescript` is held at `^6` on purpose — do not bump it to 7 yet.** TypeScript 7 (the native port) changed the shape of the published module: it no longer exposes a CommonJS `default`. `svelte-check` reads `typescript.default.sys`, so it throws `Cannot read properties of undefined (reading 'useCaseSensitiveFileNames')` at startup on TS 7 — which breaks both `npm run check` and `npm run build`, since the build begins with `svelte-check`. This is upstream in `svelte-check` (4.7.3, the current latest, has no TS 7 support). Re-attempt once a `svelte-check` release advertises it; everything else in the toolchain tracks latest.

Bumping `@playwright/test` requires a matching browser download — run `npx playwright install chromium` after the install, or the suite fails with `Executable doesn't exist`. CI does this in its own step, keyed on the `package-lock.json` hash, so it self-heals there.

**`@types/node`'s major tracks the Node version CI runs on** (`NODE_VERSION` in `.github/workflows/`), not npm's latest — the types should describe the runtime the suite actually tests, not advertise APIs from a newer Node. Currently both are 24 (active LTS). When CI moves to a new Node line, bump the types major in the same change. This policy applies across the sibling repos (turing-machine-js, post-machine-js use the same Node 24 CI).

## Architecture

```
src/
├── App.svelte               header + tab nav + popstate routing
├── app.ts                   entry; mount()s <App>
├── app.css                  global tokens + base styles
├── components/
│   ├── MachineView.svelte   per-engine orchestrator (state + handlers) — JS engines (`/turing`, `/post`); untouched by the toolchain-engines work
│   ├── ToolchainView.svelte  per-engine orchestrator for the toolchain engines (`/tm1`, `/pm1`) — same shape as MachineView.svelte over `ToolchainRunner` instead of `MachineRunner`; see "Toolchain engines (TM-1 / PM-1)" below
│   ├── Landing.svelte       `/` route — engine switcher + snippet-grid; owns the single IntersectionObserver across all panels and dispatches an `active: boolean` to the most-visible SnippetPanel (one snippet plays at a time)
│   ├── SnippetPanel.svelte  showcase tile — two-column layout (player + lesson notes; stacks under 768px); 4-state playback machine (`idle | playing | paused | done`) driven by the `active` prop; `done` is sticky (no auto-replay on re-activation, Replay only). Reduced-motion pins to final frame on mount, IO orchestration is skipped.
│   ├── ExecutionTraceTable.svelte  read-only 6-column trace (Step | State | Head reads | Write | Move | Goto); sticky thead inside `max-height` scroll, `aria-current="step"` + accent row, manual `scrollTop` math (no `Element.scrollIntoView`, which would yank the page)
│   ├── TapesStack.svelte    multi-tape stack with shared head-thread; optional `actions` snippet renders in the corner slot (the toolchain pages' tape-block Load/Save buttons)
│   ├── TapesStack.test.ts   Vitest suite for TapesStack — actions-snippet present / absent (cites C-stack-...)
│   ├── Tape.svelte          single horizontal belt (renders a turing.Tape)
│   ├── ControlPanel.svelte  L/S/R + alphabet chips + Apply
│   ├── FileTabs.svelte      toolchain-engine file-tab bar — `main.<ext>` / `std.<ext>` tabs plus the source↔asm kind `<select>`
│   ├── FileTabs.test.ts     Vitest suite for FileTabs — tab naming / select / kind-change + disabled-while-pending (cites C-tabs-...)
│   ├── Toolbar.svelte       Build/Step/Run/Stop + with-pause + examples menu
│   ├── Toolbar.test.ts      Vitest suite for Toolbar — runLabel / disabled / visibility / interval / callbacks / stale-build (cites C-toolbar-...)
│   ├── Editor.svelte        CodeMirror 6 wrapper + reset overlay; `readOnly` prop routes to the wrapper's own `readonly`/`editable` props (used for the toolchain pages' std tab)
│   ├── Log.svelte           log entries (desktop)
│   ├── IconButton.svelte    shared corner-overlay icon button (reset / clear)
│   ├── DiagnosticsCounter.svelte  three-pill overlay (#106) — E / W / I pills, each hidden when count is 0; bottom-right absolute-positioned, click-through (pointer-events: none) in Phase 1. Colors from --diag-error / --diag-warning / --diag-info palette tokens.
│   ├── SettingsPanel.svelte  gear in the header (#65) — native `<dialog>` modal exposing the three tunable caps (max run steps / worker timeout / log render cap) with per-field validation, inline error, and reset-to-default; valid input persists immediately via lib/settings.ts
│   └── SettingsPanel.test.ts Vitest suite for SettingsPanel — open / valid-persists / invalid-error / infinity / reset (cites C-settings-...)
├── vite-plugins/
│   └── snippets.ts           build-time Vite plugin recording `virtual:snippets` — evaluates each `showcase: true` JS example under Node and captures a `Snippet` per the `@turing-machine-js/visuals` `recordSnippet` format for the Landing page's SnippetPanel tiles; imports `jsExamples.ts` directly (see above) since it runs under plain Node, not Vite's transform pipeline
└── lib/
    ├── types.ts                Engine, Command, Alphabets, WorkerRequest/Response (TapeSnapshot + Graph imported from @turing-machine-js/{visuals,machine})
    ├── caps.ts                 numeric caps: VIEWPORT_WIDTH, MAX_STEPS, WORKER_TIMEOUT_MS, MAX_TAPES, PROGRESS_INTERVAL_MS, plus toolchain-only TOOLCHAIN_SLICE_BUDGET (see Caps below)
    ├── settings.ts             user-tunable caps (#65) — SETTING_SPECS (defaults from caps.ts + min/max; maxSteps also accepts Infinity), read-through getSetting / write-through setSetting / resetSetting / parseSettingValue over `machines-demo:settings:<key>`; plain TS (no runes) so node-env suites import it
    ├── settings.test.ts        Vitest suite for settings — defaults / roundtrip / invalid-stored-falls-back / infinity / reset / parse (cites S-settings-...)
    ├── machineRunner.ts        main-thread worker wrapper; WORKER_TIMEOUT_MS per-segment cap; injected workerFactory; stashes the run-loop progress heartbeat (lastProgress, kept across terminate) and rejects run timeouts with WorkerTimeoutError carrying it
    ├── machineRunner.test.ts   Vitest suite for MachineRunner — protocol-shape / timer / pending / error / progress categories (cites R-... / S-... scenario IDs)
    ├── machineWorker.ts        spawns user code via new Function inside worker; imports pure logic from workerHelpers.ts
    ├── workerHelpers.ts        pure helpers extracted from machineWorker — movementCode, commandsFromYield, snapshot*, expectPhase, createProgressGate
    ├── workerHelpers.test.ts   Vitest suite for workerHelpers — 6 topic groups (movement-code, commands, snapshot, phase-guard, step-arm, progress-gate)
    ├── testUtils.ts            FakeWorker + makeFakeFactory test helpers
    ├── log.ts                  log-entry types + helpers shared by Log.svelte
    ├── logStore.svelte.ts      per-MachineView log store — non-reactive #buffer + setTimeout-throttled $state view, LOG_RENDER_CAP slice with synthetic overflow header, buffer-sourced reactive `latest` getter
    ├── logStore.test.ts        Vitest suite for LogStore — buffer-append / cap / separator / latest / clear / dispose / flush-* (cites R-logstore-...)
    ├── initialBoot.ts          pure helper computing engine-page initial state from URL params + localStorage — 4-tier priority (?example=<id> > ?snippet=<id> > localStorage > first bundled example), with badExampleId/badUrlId for not-found logging
    ├── initialBoot.test.ts     Vitest suite for initialBoot — M-boot-example-query / M-boot-example-unknown / M-boot-priority-example-over-snippet / M-boot-priority-snippet-over-localstorage / M-boot-priority-localstorage-over-default / M-execution-mode-union
    ├── interval.ts             parseInterval + MIN_AUTO_INTERVAL_MS for the RUNNING_AUTO throttle
    ├── toolchain/              TM-1 / PM-1 engines over the machine-toolchains wasm bundle — see "Toolchain engines (TM-1 / PM-1)" below
    │   ├── types.ts              protocol types (ToolchainRequest/Response, DriveMode, PauseCause, LineMap, SeedTape, ExampleSeed) + Lang/Arch/BufferKind helpers (`langFor`, `kindOfLang`, `extOf`); re-exports the wasm module's own types ($mtc)
    │   ├── types.test.ts         Vitest suite for the Lang/Arch helpers and ENGINES/route wiring (cites T-engines-... / T-lang-for)
    │   ├── toolchainWorker.ts    thin Web Worker shell — initialises the wasm module once, forwards every request to a ToolchainCore; the only file that imports `$mtc` at runtime (types-only elsewhere). A failed init is remembered and answered per request as `error { fatal: true, message: 'toolchain module failed to load: …' }`
    │   ├── workerCore.ts         `ToolchainCore` — the pump-loop brain, kept free of `self` so it runs under Node in tests; drives `step`/`auto`/`continuous` via `Session.pump()`, guards the loop with a session generation counter (a build/start during a yield abandons the old loop silently), honours Stop on a paused exit, races the auto-mode interval against a `wake` resolver so Pause/Stop cut it short (`sleepInterval`) and a woken Stop finalises before any `busy`, reports a `WebAssembly.RuntimeError` as `error { fatal: true }`, and a `deviceWait` pump event as a plain non-fatal error
    │   ├── workerCore.test.ts    Vitest suite for ToolchainCore against the real wasm module — build/start/pump/breakpoints/panic/deviceWait (cites T-core-...)
    │   ├── toolchainRunner.ts    main-thread wrapper (parity with `machineRunner.ts`) — FIFO queue of simple requests (lint/format/codec/build; only a `start` overlap throws), watchdog armed at dequeue, progress stash kept across terminate, single `killAll` path (either watchdog, a fatal error or `onerror` takes down both channels and the queue) and a lazy respawn on the next request; `resume`/`pause`/`stop` no-op without a live run
    │   ├── toolchainRunner.test.ts  Vitest suite for ToolchainRunner — build / handlers / idle-busy / error-routing / maxSteps-from-settings / fatal-respawn / cross-channel-kill categories (cites T-runner-...)
    │   ├── toolchainTestUtils.ts FakeToolchainWorker + factory helper — toolchain-side counterpart of `lib/testUtils.ts`
    │   ├── toolchainHelpers.ts   pure helpers: seed tapes ↔ wasm/glyph/snapshot conversions, `buildLineMap` (addr ↔ `{file, line}` via the program's `lineOf`, deliberately not `addressForLine`, which snaps forward), stdlib export index
    │   ├── toolchainHelpers.test.ts  Vitest suite for the pure helpers against the real wasm module — seeds / linemap / layouts-equal / delta-clamp (cites T-delta-... / T-linemap-... / T-layouts-... / T-seed-...)
    │   ├── testModule.ts         test-only: loads the vendored wasm module from bytes under Node, once per process
    │   ├── module.test.ts        smoke test — the vendored wasm module loads and exposes `Toolchain` (cites T-module-loads)
    │   ├── examples.ts           bundled TM-1 / PM-1 examples with seeds — TM-1: `binary-increment`, `two-tape-copy`, `pow2`, `binary-increment-asm`; PM-1: `unary-increment`, `sum`, `unary-increment-asm`
    │   ├── examples.test.ts      Vitest suite for the bundled examples — build + seed shape against the real wasm module (cites T-examples-...)
    │   ├── examples/              example source files (`?raw`-imported by examples.ts): binary-increment.tma, binary-increment.tmc, pow2.tmc, sum.pmc, two-tape-copy.tmc, unary-increment.pma, unary-increment.pmc
    │   ├── download.ts           browser download of an in-memory blob (source-file Save and tape-block Save both use it)
    │   ├── persistToolchain.test.ts  Vitest suite for the toolchain-specific slice of `lib/persist.ts` — kind / seeds / snippet seed+kind round-trip (cites T-persist-...)
    │   ├── lang/                 CodeMirror stream-language modes hand-ported from the toolchains' TextMate grammars
    │   │   ├── index.ts            composes the four stream parsers into `toolchainLanguage(lang)`; exports `tokenizeLine` for tests
    │   │   ├── lang.test.ts        Vitest suite tokenizing sample lines per mode (cites T-lang-...)
    │   │   ├── tokens.ts           shared token table / styles for the four stream modes
    │   │   ├── pmc.ts              PM-1 `.pmc` source stream mode
    │   │   ├── pma.ts              PM-1 `.pma` assembly stream mode (mnemonic alternation longest-first so `jm.s` isn't shadowed by `jm`)
    │   │   ├── tmc.ts              TM-1 `.tmc` source stream mode
    │   │   └── tma.ts              TM-1 `.tma` assembly stream mode
    │   └── editor/                CodeMirror extensions specific to the toolchain debugger view
    │       ├── breakpointGutter.ts   gutter keyed by 1-based line — CodeMirror renders a gutter element only for lines with a marker (plus one hidden spacer); a click resolves by y-coordinate, not by an existing element; unmappable lines carry the refuse tooltip
    │       ├── breakpointGutter.test.ts  Vitest suite (happy-dom) — render / click / refuse (cites T-bp-...)
    │       ├── ipHighlight.ts        line decoration for the paused instruction pointer; scrolls with manual `scrollTop` math, never `scrollIntoView`
    │       ├── ipHighlight.test.ts   Vitest suite (happy-dom) — show/hide/out-of-range (cites T-ip-...)
    │       ├── lint.ts               editor lint source over the toolchain's `check` channel; positions arrive as UTF-16 offsets (CodeMirror's own coordinate), so they map 1:1 after clamping
    │       ├── lint.test.ts          Vitest suite (happy-dom) for the lint source — clamp / fix-action / fix-machine-applicable / map (cites T-lint-...)
    │       ├── stdCompletion.ts      `std::` completion built from `stdlibSource` so the list can't drift from what the module actually links
    │       ├── stdCompletion.test.ts Vitest suite for `stdCompletionSource` — activation / options (cites T-stdcomp-...)
    │       ├── stdLink.ts            Cmd/Ctrl-click on a stdlib reference opens the stdlib tab at its definition — `stdNameAt` matches the qualified `std::name` and the bare imported `name` alike, reporting `qualified` so the orchestrator can stay silent on an ordinary identifier (it does the tab switch + search)
    │       └── stdLink.test.ts       Vitest suite for `stdNameAt` — hit / bare / miss / asm (cites T-stdlink-...)
    ├── completions/            context-aware, schema-driven CodeMirror autocomplete (#103)
    │   ├── index.ts              completionExtensions(engine) — composes the layers below
    │   ├── schema/               typed const describing engine + post API surface
    │   │   ├── types.ts            EngineSchema / NamespaceEntry / ClassSpec / ShapeSpec / TypeRef / ParamSpec / MemberSpec
    │   │   ├── turing.ts           TURING_SCHEMA (namespace, classes, shapes, constants)
    │   │   ├── post.ts             POST_SCHEMA (post-instruction flattened kind for mark/erase/call/check/$tag/...)
    │   │   ├── index.ts            getSchema(engine)
    │   │   └── engine.test.ts      drift guard against `* as turingNs` / `* as postNs` + TypeRef closure
    │   ├── scan/                 Lezer walker over the editor buffer
    │   │   ├── types.ts            InferredType / InferredLocals / ImportsBinding / ScannerResult
    │   │   ├── locals.ts           scanLocals + inferLocalsFor + localsField (StateField cache, schema-keyed)
    │   │   └── locals.test.ts      Phase 1 + Phase 2 inference rules (cites S-scan-...)
    │   ├── contexts/             five per-context CompletionSource factories, composed in priority order
    │   │   ├── types.ts            Env, CompletionSourceFactory
    │   │   ├── memberAccess.ts     after `<ident>.` — instance members / namespace classes / constants (movements/symbolCommands)
    │   │   ├── debugAssignment.ts  `<state>.debug = ▮` RHS + `{ before, after }` keys; haltState boolean-only
    │   │   ├── optionsBag.ts       inside `new <Class>({ ▮ })` — top-level + nested shape-path walk (State dictionary-ctor entry)
    │   │   ├── destructureBag.ts   inside `const { ▮ } = imports;` or `const { ▮ } = <local-class>;`
    │   │   └── namespaceIdentifier.ts  bare word at expression position — ranked by destructure status; snippet expand in `new` callee + post-instruction with params; rename emits two entries (original-name applies the alias)
    │   ├── apply/
    │   │   └── import.ts           applyAutoImport + computeDestructureChange — inserts not-yet-destructured names into the top `const { … } = imports;` block; format-aware single/multi-line; rename suppression
    │   ├── hints/                signature-help / parameter hints (#105) — StateField → showTooltip
    │   │   ├── types.ts            SignatureInfo / ParamRender / ResolvedCallee
    │   │   ├── format.ts           formatTypeRef(TypeRef): string — schema TypeRef → human-readable
    │   │   ├── signature.ts        computeSignatureInfo(state, env) (Lezer walk + callee resolution + comma-count active arg) + signatureHelp(env) StateField wiring; exports resolveCallee for reuse by the lint layer
    │   │   ├── format.test.ts      Vitest specs for formatTypeRef (cites S-fmt-...)
    │   │   └── signature.test.ts   Vitest specs for computeSignatureInfo across namespace functions / member methods / constructors / post-instructions / renamed imports (cites S-sig-...)
    │   └── lint/                 schema-driven semantic linters (#114)
    │       ├── argCount.ts         computeArgCountDiagnostics(state, env) + argCountLinter(env) — walks CallExpression/NewExpression, reuses resolveCallee, emits error for missing-required + bare-only-called-as-fn (`stop()`), warning for too-many
    │       ├── argCount.test.ts    Vitest specs across required/too-many/bare-only/ctor/member-method/negative-space (cites S-lint-...)
    │       ├── crossRef.ts         computeCrossRefDiagnostics(state, env) + crossRefLinter(env) — for each `new PostMachine(...)`, collects a tree-shaped `ScopeNode` (numeric keys = instruction indices, string keys = subroutines that may nest), then walks with a `ScopeChain` (innermost → root). Indexed instructions (mark/erase/noop/left/right/check) validate args against the current scope's indices; `call(name)` resolves names by walking the chain local-to-root (subroutines nest, lookup walks lexically — confirmed against post-machine-js semantics); `call(name, ix)`'s `ix` uses caller-local scope. Flags indexed forms inside array groups. Also flags empty subroutine bodies (`sss: {}`) — PostMachine throws "there is no instructions" at construction.
    │       ├── crossRef.test.ts    Vitest specs for scope tree collection + top-level / subroutine-local / call (incl. nested-subroutine resolution) / array-group / empty-subroutine cases (cites S-cref-...)
    │       ├── unbound.ts          computeUnboundDiagnostics(state, env) + unboundLinter(env) — walks VariableName nodes at function-scope depth 0, flags any not in scanLocals' rawLocals + a depth-0 `VariableDefinition` pre-pass + a small GLOBAL_ALLOWLIST of common JS built-ins + the `imports` bridge. Function/arrow bodies are skipped (FunctionDeclaration / FunctionExpression / ArrowFunction / Method / Class) to avoid false positives on params and inner-scope locals. The pre-pass exists because `rawLocals` carries only top-level `const`/`let` + import destructures, so for / for-of / for-in headers and block-scoped declarations would otherwise read as undefined (#119); it walks the whole tree up front, so forward refs and `var` hoisting fall out for free. Two consequences: block scoping is **flattened** — a `const` inside any top-level block marks that name bound file-wide, so a genuinely undefined use elsewhere goes unreported (deliberate; this linter errs toward false negatives) — and function-declaration names are **not** collected, since entering a FunctionDeclaration bumps the depth before the walk reaches the node carrying the name, so a top-level call to a hoisted `function foo() {}` is still flagged. Both engines.
    │       └── unbound.test.ts     Vitest specs across not-destructured / destructured-ok / local-const / imports-allowlisted / common-globals / arrow-skipped / function-skipped / renamed-destructure / both-engines / multi-undeclared / for-loop-let-binding / for-of-binding / for-in-binding / fn-param-does-not-suppress-toplevel-use (cites S-unbound-...)
    ├── syntaxLinter.ts         Lezer-based syntax-error markers
    ├── persist.ts              localStorage helpers per engine — code, example, snippets (UUID-keyed)
    ├── tapeSnapshot.ts         serialize/parse for tape-block copy+paste snapshots — JSON with `format`/`version` discriminator, categorized ParseError, no DOM/clipboard knowledge
    ├── tapeSnapshot.test.ts    Vitest suite for tapeSnapshot — roundtrip / parse-not-json / wrong-format / unsupported-version / wrong-shape-* / length-mismatch (cites R-snapshot-...)
    ├── defaultCode.ts          shared `Example` type (carries optional `lessonNotes` — markdown subset authored per showcase for the SnippetPanel right column — plus the toolchain-only `kind` / `seeds`) + `examples(engine)` composing `jsExamples.ts` (Turing/Post) and `toolchain/examples.ts` (TM-1/PM-1)
    ├── jsExamples.ts           starter Turing / Post snippets (`POST_EXAMPLES`, `TURING_EXAMPLES`) — split out of `defaultCode.ts` because `vite-plugins/snippets.ts` imports examples under plain Node at build time, where the toolchain examples' `?raw` imports (in `toolchain/examples.ts`) cannot resolve; this file holds no such imports, so it stays Node-loadable
    ├── format.ts               LogEntry assemblers: commandsEntry / tapesEntry / CommandsApplication; per-step string rendering (`formatStepNotation`, `formatTape`) is consumed from `@turing-machine-js/visuals`
    ├── lessonMarkdown.ts       tiny markdown renderer for `Example.lessonNotes` — HTML-escapes input, then handles paragraphs (blank-line split), bullet lists (`- ` prefix), and inline `` `code` ``. Build-time author content only; injected via `{@html}` in `SnippetPanel.svelte` (same policy as the SVG-icon `{@html}` use).
    ├── icons.ts                Tabler icon namespace (?raw imports)
    ├── caretColors.ts          shared 5-entry caret palette — `TapesStack.svelte` / `ControlPanel.svelte` index it modulo its length (`lib/caretColors.ts`'s own doc comment), so a toolchain program with more bands than colors still gets one per belt without collision; `MachineView.svelte` keeps its own identical inline copy (untouched by this work)
    ├── theme.svelte.ts         theme (light / dark) state + matchMedia watcher (Svelte 5 .svelte.ts module)
    ├── diagnosticsCounter.svelte.ts  class DiagnosticsCounter (Svelte 5 runes — three $state counts for errors / warnings / info; info severity folds in info + hint) + diagnosticsCounterPlugin(counter) ViewPlugin that recomputes via forEachDiagnostic on every transaction. Per-Editor instance.
    └── diagnosticsCounter.test.ts    Vitest specs (happy-dom env) — empty / errors-only / mixed / hint-folded / replace-on-update (cites S-diag-...)

e2e/
├── abort.spec.ts               abort outcome + terminal highlight, both engines (cites E-abort-...)
├── cold-start.spec.ts          boot / step / run / pause / stop scenarios (cites E-cold-start-..., M-boot-...)
├── completions.spec.ts         member access / state.debug RHS / auto-import roundtrip (cites E-completions-...)
├── diagnostics-counter.spec.ts counter pills fed by syntaxLinter + unboundLinter; pill clears when the code is fixed (cites E-diag-...)
├── landing.spec.ts             `/` route — snippet panels, engine switch, deep link, scroll-triggered playback
├── no-wasm-on-js-pages.spec.ts the JS engine pages (`/turing`, `/post`) never request a `.wasm` file, through a full Run (cites E-tc-no-wasm-...)
├── settings.spec.ts            settings panel — persist across reload, invalid input dropped, lowered maxSteps truncates a real run (cites E-settings-...)
├── stale-build.spec.ts         stale-build notice — edit / example load shows the Build dot, successful Build clears it, failed Build keeps it (cites E-stale-build-...)
├── toolchain-pm1.spec.ts       PM-1 (`/pm1`) — boot / boot-priority / build-error / run / step / step-into-std / breakpoint (incl. refused) / format / kind-switch-disassemble / reset-restores-kind / seed-persists / tape-block round-trip / std tab / std:: completion / go-to-definition on a bare imported name (cites E-tc-...)
├── toolchain-tm1.spec.ts       TM-1 (`/tm1`) — binary-increment run, two-tape copy, a lowered maxSteps truncating pow2, the assembly example (cites E-tc-tm-...)
└── worker-termination.spec.ts  progress restore after worker termination — watchdog timeout and hand Stop restore the last heartbeat, auto-run Stop doesn't regress (cites E-term-...)

playwright.config.ts            Chromium project; webServer runs `npm run preview`

scripts/
├── fetch-toolchains-wasm.mjs      fetches the wasm bundle pinned in `toolchains-wasm.json` (tag + per-file SHA-256) into the gitignored `vendor/mtc-wasm/`; runs on `postinstall`, no-op when the cache already verifies; `MTC_WASM_DIR=<dir>` copies an unpacked local bundle instead (skips the hash check, warns)
└── fetch-toolchains-wasm.test.mjs `node --test` suite for the fetch/verify/override logic (`npm run test:scripts`)

toolchains-wasm.json             the wasm bundle pin — release tag + SHA-256 per file, checked by `fetch-toolchains-wasm.mjs`
vendor/mtc-wasm/                 (gitignored) the fetched/verified wasm bundle — mtc_wasm_bg.wasm, mtc_wasm.js, mtc_wasm.d.ts, manifest.json; populated by `npm run fetch:wasm` / `postinstall`, resolved at `$mtc` (`vite.config.ts`, `tsconfig.json`)

.github/workflows/
├── main.yml                    CD: build + rsync to VPS on push to master
└── test.yml                    PR gate: check / lint / vitest / playwright
```

**`App.svelte`** picks the active engine from the URL pathname (`/turing`, `/post`, `/tm1`, `/pm1`) and renders one engine view keyed by engine — `isToolchainEngine(route.engine)` routes `tm1`/`pm1` to `<ToolchainView>` and `turing`/`post` to `<MachineView>`; switching engines (or switching between a JS and a toolchain tab) unmounts and remounts the tab (kills CodeMirror undo, cheap CPU). Legacy `?machine=<engine>` URLs are rewritten to the path form on first load. SPA-fallback routing is required (nginx `try_files $uri $uri/ /index.html;` in `vps/nginx/sites/demo.machines.mellonis.ru`; Vite default in dev). The footer shows the app version plus each dependency's version, including the pinned `machine-toolchains` release (`virtual:lib-versions`, backed by the vendored bundle's `manifest.json`).

**`MachineView.svelte`** is the orchestrator (UI is split into `TapesStack`, `Toolbar`, `ControlPanel`, `Editor`, `Log`). It owns:

- `executionMode` (`$state<ExecutionMode>`) — see state machine below
- `alphabets`, `lastSnapshots`, `halted`, `code`, `withPause`, `intervalText` — all `$state` (multi-tape: `alphabets`/`lastSnapshots` are per-tape arrays)
- `log` — a per-instance `LogStore` (`lib/logStore.svelte.ts`); owns the unbounded non-reactive `#buffer` and the throttled `entries: $state<LogEntry[]>` view (`setTimeout(_, 16)` coalesce + `LOG_RENDER_CAP = 5000` slice with synthetic overflow header). `log.latest` is the buffer-sourced, reactive (via internal `#version` counter) getter used for mobile status — synchronous on every `report()`, no 16ms lag.
- `selectedExampleId`, `snippets`, `loadedSnippetId` — all `$state`. `loadedSnippetId` is the UUID of the currently loaded user snippet (or `null` for a bundled example); drives `sourceCode`, `dirty`, and `resetVisible` ($derived). See the *Snippets* section below.
- `pendingOp: 'load' | 'run' | null` and `stepInFlight: boolean` — concurrency guards
- `builtSource` (`$state`) — source of the last **successful** build (set in `reloadWorker`; a failed build leaves it) — and `staleBuild` ($derived: `code !== builtSource`, any textual difference, same policy as `dirty`). Drives the accent dot + title on the Toolbar's Build button: the graph/tape view (and any in-flight run) reflects the last Build, not the editor. Complements — does not replace — the one-shot mid-run log warning below.
- `panelEnabled` / `applyVisible` / `takeControlVisible` / `loadDisabled` / `stepDisabled` / `runDisabled` / `tapeCount` — all `$derived` (single source of truth for UI state)
- `mirrorMachine` / `mirrorTapeBlock` — a real `TuringMachine` instance on the main thread that mirrors the worker's tape state. Built by `_buildMirrorMachine` after each `reloadWorker`; advanced one step at a time by `_runMirrorStep` (uses an `ifOtherSymbol` one-step `State` so the upstream library's transitions drive the visualization, not bespoke UI code). `renderFromMirror` hands each `mirrorTapeBlock.tapes[i]` to the matching `<Tape>` via `TapesStack.setFromTape(i, tape, …)`.
- `$effect`s for the demo loop, auto-step loop, belt-transitions toggle, and a code-changed warning (debounced via `codeChangedWarned` flag — fires once per running session)
- `runner = new MachineRunner(engine, () => new MachineWorker())` and the `doLoad` / `doStep` / `doRun` / `takeControl` / `stopMachine` / `resetCodeToSelected` / `onCopy` / `onPaste` handlers; `reloadWorker(source?)` is the shared "build worker + rebuild mirrorMachine" helper, taking optional source code (defaults to current `code`). The factory argument keeps the Vite-specific `?worker` import in `MachineView.svelte`; `machineRunner.ts` is plain TypeScript and accepts any `MachineWorkerLike` (real `Worker` or `FakeWorker` from `testUtils.ts`). `onCopy` / `onPaste` use `navigator.clipboard.{writeText,readText}` and the `lib/tapeSnapshot.ts` serialize/parse pair; paste is mirror-only (next Build reloads the worker from the editor code).

**Execution model and debugger semantics:** see [`docs/execution-model.md`](docs/execution-model.md).

## Worker contract

All shapes are TS discriminated unions in `src/lib/types.ts`. Single canonical `Command = { movement: 'L'|'R'|'S'; symbol: string | null }` (`null` = "keep" — resolved symbol matched current). All response payloads are **per-tape arrays** — N=1 for single-tape, N=K for K-tape (`tapeBlock.fromTapes([...K])`).

| Request | Response |
|---|---|
| `{ type: 'build', engine, code }` | `{ type: 'built', tapes, alphabets, halted, graph, codeSetBreakpoints? }` (the optional `codeSetBreakpoints` field carries one entry per non-empty `state.debug` bit user code set during `userFn` — see "Bidirectional breakpoints" below) |
| `{ type: 'step' }` | `{ type: 'stepped', halted, commands, nextCommands, stepsApplied, outcome }` (`outcome: 'halted' \| 'aborted' \| null` — null while runnable) |
| `{ type: 'run', maxSteps?, debug?, step?, intervalMs? }` | `{ type: 'ran', tapes, truncated, commands, startStep, stepsApplied, outcome, finalStateName, finalStateId, backtrace }` (or interleaved `paused`s, see below). `outcome: 'halted' \| 'aborted'` is captured from the engine session's terminal `'halt'`/`'abort'` event (the RunResult); `backtrace` is `[]` for halted, the engine continuation stack (turing) or the abort site's instruction-level arrival path (post) for aborted |
| `{ type: 'resume', step?, intervalMs? }` | `paused` (next break) or `ran` (halt) |
| `{ type: 'pause' }` | (no response — fire-and-forget; cancels auto-mode throttle, triggers a synthetic `paused` from the next `onStep`) |
| `{ type: 'setDebug', on }` | (no response — fire-and-forget; flips worker-side `debugEnabled` flag) |
| `{ type: 'toggleBreakpoint', stateId, kind }` | `{ type: 'breakpointToggled', stateId, kind, value: 'on' \| 'off' }` (echo after the worker mutates `state.debug`) |
| (none — auto-mode throttle gate) | `{ type: 'idle' }` / `{ type: 'busy' }` (sent by `onIter` during RUNNING_AUTO to signal whether the throttle is open) |
| (none — run-loop heartbeat) | `{ type: 'progress', tapes, stepsApplied, stateName }` (time-gated every `PROGRESS_INTERVAL_MS` from the session's `step` listener during runs; the runner stashes the latest — `lastProgress`, kept across `terminate()` — so a worker termination that never gets a reply, watchdog timeout or hand Stop, can restore the tape view to the last known state. Timeout rejections carry it as `WorkerTimeoutError`; `MachineView` restores only when the heartbeat is ahead of what's rendered, so RUNNING_AUTO / paused displays never regress) |

**Bidirectional breakpoints (machines-demo#37, #78).** Two paths set `state.debug`:

- **UI → engine** (PR #76, scope option 1). User clicks a state node in the graph; main sends `toggleBreakpoint { stateId, kind }`; worker mutates `state.debug` via `mergeDebugKinds` and echoes `breakpointToggled { stateId, kind, value }`.
- **Engine → UI** (PR for #78, scope option 2/3). User code sets `state.debug` programmatically; the worker scans the state map once after build (via `scanCanonicalBreakpoints`), dedupes wrapper/bare via `bareIdOf`, canonicalizes halt-class negative ids to `0`, and bundles the entries in the **`built` response's `codeSetBreakpoints` field**. The main thread's build success path applies them DIRECTLY to the `breakpoints` SvelteMap (no `toggleBreakpoint` round-trip — the worker already has them) AFTER setting `graph` AND AFTER the UI-clicked-BP replay loop has decided which ids to skip (replay skips any id present in `codeSetBreakpoints`, since toggling there would flip the code-set value OFF). Code wins on overlap: a state with both a stale UI click AND a fresh code-set entry takes the code-set value. The indicator dot in the graph reflects the engine's actual `state.debug` state regardless of which direction set it.

Mid-run scans are deliberately omitted: user code in the worker runs exactly once per build (`new Function(...)` at `machineWorker.ts:285-289`), so there's no realistic path for `state.debug` to change between iters.

`paused` interleaves with `ran`/`error` on the run channel: `{ type: 'paused', tapes, commands, stepsApplied, state, currentSymbols, pause }` where `pause: { side: 'before' | 'after'; cause: 'breakpoint' | 'step' | 'manual' }` (engine #102 — mirrors the engine's `m.pause`). **Every pause flows through the engine's single `pause` event** — breakpoints (`state.debug` match, gated by the debug toggle), Step (engine `stepIn()`), and click-Pause (external engine `pause()`). Step and click-Pause are therefore **before-side** (`cause: 'step'` / `'manual'`) — the worker no longer synthesizes side-less pauses in `onIter`, which now carries only the RUNNING_AUTO throttle. The runner's `run({ onPaused })` Promise stays pending across paused/resume cycles; only `ran` / `error` complete it. Per-segment timer suspends on `paused`, restarts on `resume`-send, killed on `ran` / `error`.

On any failure: `{ type: 'error', message, tapes? }`. When the worker errors mid-step / mid-run (typical case: no edge in the state graph for the current symbol), the response also carries the partial tape state. The runner wraps `error` responses in a `WorkerError` (custom class with a `tapes` field); `MachineView.svelte#failHalted` rebuilds the mirror and updates `lastSnapshots` from those tapes — without this, the user would see only the loaded tape and lose every step the worker actually applied before throwing.

`stepped` deliberately omits `tapes` — applying a `Command` to a `Tape` is deterministic, so the main-thread `mirrorMachine` replays the worker's commands and is the source of truth for tape rendering during stepping. The worker only ships full tape state on `built` (initial state) and `ran` (final state after a continuous run, where replaying thousands of commands on the mirror would be wasteful).

`TapeSnapshot = { symbols, position }` is the **wire format** carrying tape data across the worker boundary (not the UI's render input). `position` is the head index into `symbols`. Producer:

- **Worker on `built` / `ran` / `error`** — full tape, no trim. Trimming would lose user-tape data outside the initial render window; once the user takes control and moves the head, blanks would appear where original symbols should be. `machineWorker.ts` does **not** mutate user `t.viewportWidth` (the library's `normalise()` would pad `t.symbols` and surprise user code), and just clones `t.symbols` plus `t.position`.

The main thread converts each `TapeSnapshot` to a `turing.Tape` once via `_buildMirrorMachine` (passes `viewportWidth: VIEWPORT_WIDTH` to the constructor; the library's `normalise()` pads `#symbols` so `tape.viewport` returns exactly `VIEWPORT_WIDTH` cells). Per-step rendering then hands the **library tape itself** to `Tape.svelte#setFromTape`, which reads `tape.viewport` (the library's slice/center math, length guaranteed to be `VIEWPORT_WIDTH`).

**Caps** (all in `lib/caps.ts`):
- `MAX_TAPES = 5` — multi-tape limit; the worker rejects loads with more tapes than the caret palette can color.
- `PROGRESS_INTERVAL_MS = 250` — cadence of the worker's run-loop `progress` heartbeats (see the worker-contract row above). Bounds the tape-snapshot cost while keeping a termination's restored view at most this stale; must stay well under the `workerTimeoutMs` settings floor (1 s).
- `MAX_STEPS = 100_000` — `run`-mode hard cap; if `runToEnd` reaches it before the machine halts, the response sets `truncated: true`. Same backstop as `WORKER_TIMEOUT_MS` but counts steps instead of wall-clock time, so a tight loop that never yields still terminates eventually.
- `WORKER_TIMEOUT_MS = 5_000` — wall-clock cap on a single worker request **segment**. For `build` / `step` / `run`-without-pause it's a round-trip cap. For `run` with paused/resume cycles it's per-segment: timer suspends on each `paused` (user is inspecting; no clock), restarts on `resume`-send, killed on `ran`/`error`. The `MachineRunner` schedules a `setTimeout` and kills the worker (terminate + respawn next request) if any segment exceeds it.
- `VIEWPORT_WIDTH = 23` — see Tape section below.
- `TOOLCHAIN_SLICE_BUDGET = 80_000` — toolchain-only: instructions retired per `pump()` call in a continuous toolchain run, between which the worker yields to its event loop (`pause` / `stop` / lint requests get served, a `progress` heartbeat can go out). Sized for ~20–50ms of work per slice; measured at 28–39ms/slice against the `pow2` example at implementation time (20,000 measured only ~7–12ms, too far under the target). See "Toolchain engines (TM-1 / PM-1)" below.

`MAX_STEPS`, `WORKER_TIMEOUT_MS`, and `LOG_RENDER_CAP` are **defaults**, user-tunable via the header settings panel (#65, `SettingsPanel.svelte` + `lib/settings.ts` — `machines-demo:settings:<key>`, engine-agnostic). Consumers read at use time (`getSetting`): the runner resolves `maxSteps` when posting a `run` request and the timeout when scheduling each segment timer; the LogStore reads the render cap at each flush. `maxSteps` alone also accepts `Infinity` (input `Infinity` / `∞`) — an uncapped run stays bounded by the wall-clock timeout, whereas an Infinity timeout would disable the watchdog and an Infinity log cap would unbound the DOM, so those two stay strict-integer. Invalid stored values fall back to the default (no clamping).

Tape derivation in `machineWorker.ts` prefers `tapeBlock.tapes` so a user adapting the single-tape default snippet to multi-tape doesn't silently see only tape 0.

## Tape (the belt)

`Tape.svelte` renders `VIEWPORT_WIDTH = 23` cells (constant in `lib/caps.ts`, must be odd so the head sits at the exact middle); CSS `--visible-cells` shrinks the visual viewport to show fewer at smaller breakpoints (17 tablet, 11 phone) — extra cells fade behind the mask. The single render path is `setFromTape(tape, delta?, animate?, wrote?)` — `tape` is a `turing.Tape` instance (the upstream library type; mirror tapes have `viewportWidth = VIEWPORT_WIDTH` set, so `tape.viewport` returns exactly the render window), `delta` is ±1/0 (the head movement), `animate` toggles the slide, `wrote` triggers a one-shot flash on the just-written cell (its strip index is `MIDDLE_INDEX - delta` — at slide-start that cell sits at the visual center and rides outward as the strip settles; gated by `prefers-reduced-motion`). `setFromTape(null)` clears.

Cell shape is `Cell = { sym: string; blank: boolean }` — `sym` is the literal alphabet symbol (no UI substitution; the user's chosen blank glyph is rendered as-is), `blank` is a flag that tags cells holding `tape.alphabet.blankSymbol`. The flag drives a CSS sugar (`.cell.blank` — dim border, dim symbol opacity) so blank cells are visually distinct from non-blank ones **without overloading any specific character**. This means a user can put `'␣'` in their alphabet as a non-blank symbol with zero collision: blank cells render their actual blank glyph dimmed, the `'␣'` cells render at full opacity.

The component owns no tape state of its own beyond the fixed-size `viewport: $state<Cell[]>` (length always `VIEWPORT_WIDTH`). The slide animation uses the prep-shift trick: write `viewport`, `await tick()`, snap-translate by ±1 cell without transition, force reflow, transition back to 0. `await tick()` is critical — `queueMicrotask` would race Svelte's scheduler.

The head ▲ marker below each bottom belt is a **CSS-border triangle** (not a Unicode glyph) so its visible edges exactly match its box and `left:50%; translateX(-50%)` aligns pixel-perfect with the head-thread line. `.viewport` (CSS class on the outer wrapper, not the JS variable) carries `background: var(--bg)` to mask the head-thread behind the stack across the whole tape row — without that, the 4px inter-cell gap passes through the head column during slide animations and exposes the line.

**Bundled Turing examples use `' '` (space) as the blank symbol** — matching the Post machine's fixed blank — so both tabs feel consistent. Blank cells render dimmed (`.cell.blank` CSS) regardless of which character is chosen as blank.

## Multi-tape stack and head-thread connector

`TapesStack.svelte` renders `tapeCount` tapes inside `.tapes-stack` (flex column, 4px gap). Only the bottom belt shows the ▲ marker (`showCaret={i === tapeCount - 1}`); each belt gets a per-instance `caretColor` — belt `i` takes `caretColors[i % caretColors.length]`, so the palette repeats rather than requiring one entry per tape. JS engines pass a 5-entry palette matching `MAX_TAPES` (`lib/caps.ts`) straight through, one color per tape; toolchain engines (TM-1 in particular, whose bands aren't capped at `MAX_TAPES`) pass the shared `lib/caretColors.ts` palette and rely on the repeat. The stack owns its own per-tape refs and exposes an imperative API (`setFromTape(i, tape, delta?, animate?, wrote?)`, `clearAll()`, `setTransitionsEnabled(on)`) — `MachineView.svelte` / `ToolchainView.svelte` hold a `tapesStackRef` and call these.

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

## Toolchain engines (TM-1 / PM-1)

`/tm1` and `/pm1` are driven by the Rust machine toolchains compiled to WebAssembly — `mtc-wasm`, the browser bundle every machine-toolchains release attaches. The bundle is **pinned** in `toolchains-wasm.json` (release tag + SHA-256 per file) and fetched by `scripts/fetch-toolchains-wasm.mjs` into the gitignored `vendor/mtc-wasm/` on `postinstall` (no-op when the cache already verifies; `MTC_WASM_DIR=<unpacked bundle>` copies a local build instead, skips the hash check, and warns). Only `src/lib/toolchain/toolchainWorker.ts` imports the glue at runtime (Vite alias `$mtc` → `vendor/mtc-wasm/mtc_wasm.js`, set in `vite.config.ts` / `tsconfig.json`) — `workerCore.ts` imports only its *types* from `$mtc`, which are erased at build, so the JS engine pages never request the wasm file (`e2e/no-wasm-on-js-pages.spec.ts` guards this).

What differs from the JS engines:

- **Orchestrator**: `ToolchainView.svelte` (sibling of `MachineView.svelte`, which this work left untouched) over `ToolchainRunner` (`toolchainRunner.ts`) → `toolchainWorker.ts` → `ToolchainCore` (`workerCore.ts`, testable under Node against the real module via `testModule.ts`). Protocol in `src/lib/toolchain/types.ts`. Same five execution modes (MANUAL / RUNNING_AUTO / RUNNING_CONTINUOUS / RUNNING_PAUSED / HALTED); Step is one `pump(1)` — one *instruction*, not one source-level transition (TM-1 in particular can lower one source line to several instructions, so consecutive steps often share a location) — auto-run is `pump(1)` per interval, continuous is `pump(TOOLCHAIN_SLICE_BUDGET)` slices with a `progress` heartbeat and an event-loop yield between slices. See `docs/execution-model.md` (toolchain engines).
- **Tapes are UI-owned seeds** (`SeedTape` — a sparse map of absolute position → alphabet index, plus `head`) while the page is in MANUAL. The Rust session snapshots tape state for the run's lifetime; every `finished` response (halt, abort, trap, Stop, or Take Control) copies that snapshot back into `seeds`, and so does a segment timeout that still carried a last `progress` heartbeat. Seeds persist per engine (`machines-demo:<engine>:seeds`, glyph form) and travel with examples and snippets. Tape blocks (`.pmt` / `.tmt`) load and save through the wasm codec via the two icon buttons on the tape stack (`TapesStack.svelte`'s `actions` snippet slot).
- **Buffer kind** `source | asm` per engine (`machines-demo:<engine>:kind`); `lang = arch × kind` (`pmc` / `pma` / `tmc` / `tma`). Switching kind restores that kind's kept in-memory buffer if the page has one; otherwise, switching to `asm` with a build behind it disassembles the last Build; otherwise the new buffer starts blank — one deterministic path, no prompt (`onKindChange` in `ToolchainView.svelte`). Each kind's buffer is kept for the page's lifetime. The kind is part of what a buffer *is*, so Reset restores the source's kind alongside its text, and `dirty` (the accent dot / Reset visibility) is true when either differs.
- **Editor is the debugger view**: two tabs (`FileTabs.svelte`) — the user's buffer and the read-only stdlib (`Toolchain.stdlibSource`, the exact text the module links; fetched once per page instance in the source lang, since the stdlib text is the same regardless of buffer kind). Breakpoints are keyed `"<file>:<line>"` and resolved to addresses through `LineMap` at Build / start and on every toggle (a line owns an address only if an instruction's `lineOf` names it — `addressForLine` snaps forward to the next instruction and is deliberately not used here, since a gutter must refuse comment/declaration lines rather than silently retarget a click). The active tab follows the ip across `user` / `std`. Cmd/Ctrl-click jumps to a stdlib definition — both spellings, the qualified `std::name` and the bare `name` a `use std::name;` import brought into scope (`stdNameAt` reports which); an unresolved *qualified* name logs a warning, while an unresolved bare word is just an ordinary identifier and leaves the view alone. `std::` completion lists the stdlib's exports (`indexStdExports`).
- **Stream modes** in `src/lib/toolchain/lang/`, hand-ported from the toolchains' TextMate grammars. Syntax errors surface while typing from the toolchain's `check` (lint channel → `@codemirror/lint`); a failed Build additionally logs each returned diagnostic as its own error/warning log line (not a gutter squiggle).
- **Panic policy**: a `WebAssembly.RuntimeError` (a Rust panic) is reported as `error { fatal: true }`; the runner terminates the worker and respawns it lazily on the next request, and the log says so once (`toolchain module crashed — restarting the worker`). A `deviceWait` pump event — owned devices are out of scope for this UI — is thrown as a plain, non-fatal error instead. A module that never initialised (the wasm asset missing, mis-typed or CSP-refused) answers every request with `error { fatal: true }` carrying `toolchain module failed to load: <reason>`, so the failure reads as itself rather than as a watchdog timeout on the user's program.
- **One kill path**: `ToolchainRunner` runs two channels — the run, and one simple request (build / lint / format / codec) with a FIFO queue behind it. Whatever kills the worker (either channel's watchdog, a fatal error, unmount) goes through `killAll`, which terminates it and rejects *both* channels plus the queue; the channel that timed out reports the real cause as a `ToolchainTimeoutError` (the run's also carries the last `progress` heartbeat, so the tape view can be restored), the other reads `worker terminated`. Leaving one side pending against a dead worker is what stranded a Build behind an orphaned lint. `resume` / `pause` / `stop` are wired to click handlers and no-op when there is no live run.
- **Interruptible auto interval**: the core's auto loop awaits `sleepInterval`, a race between `deps.sleep(intervalMs)` and a `wake` resolver that `pause` and `stop` call. Intervals go up to minutes, so waiting one out would make both actions look dead — and a Stop would outlive the main thread's watchdog. A woken stop finalises before posting `busy`, so the watchdog is never re-armed for a run that is already over.
- **Examples split**: the JS-engine starter snippets moved from `defaultCode.ts` into `src/lib/jsExamples.ts`. The landing page's build-time snippet recorder (`src/vite-plugins/snippets.ts`) imports examples under plain Node, where `?raw` imports — used by the toolchain examples under `src/lib/toolchain/examples/` — cannot resolve; `jsExamples.ts` carries no such imports, so it stays Node-loadable. `defaultCode.ts` now composes both engines' `examples()` from `jsExamples.ts` and `toolchain/examples.ts`.

## Conventions

- **localStorage** keys follow `machines-demo:<engine>:<key>` hierarchy (non-engine keys: `machines-demo:theme`, and `machines-demo:settings:<key>` for the app-wide caps — see `lib/settings.ts`): `code` persists editor contents, `example` the selected bundled example id, `snippets` the user snippet map (keyed by UUID → `{ title, code, savedAt, kind?, seeds? }` — `kind`/`seeds` are toolchain-only, omitted for JS-engine snippets). Toolchain engines also persist `seeds` (input tape per band, glyph form) and `kind` (buffer language) per engine. The currently loaded snippet's UUID is **not** stored here — it lives in the URL (`?snippet=<uuid>`) so it's bookmarkable / shareable. (Via `lib/persist.ts`, errors swallowed.)
- **`log.report(text, kind?)`** in MachineView is the single log entry point — appends to the LogStore buffer and schedules a 16ms flush. `log.reportSeparator()` pushes a `{separator: true}` entry that `Log.svelte` renders as an `<hr>`; called before each Build / first-Step / Run so distinct sessions read as visually grouped. The mobile-status `latestEntry $derived` (now `$derived(log.latest)`) skips separator and overflow-header entries. `LogKind` is `error | warn | ok | pause | abort`; `abort` (crimson, DASHED left stripe — the dash matches the graph's abort sentinel node) marks the aborted-run terminal line and its `↳ <frame>` backtrace lines. HALTED presentation is outcome-flavored: MachineView keeps `terminalOutcome` / `terminalStateId` from the `ran` response, and `deriveGraphHighlight` keeps a terminal highlight (final state → abort node, `toId: -1`) alive in HALTED mode after an abort — a classical halt keeps no highlight, errors clear the flavor.
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

User-saved code lives in `localStorage` under `machines-demo:<engine>:snippets`, keyed by UUID → `{ title, code, savedAt, kind?, seeds? }`. Title is user-visible (matches the save-popover input); UUID is the stable identity that survives renames and is the share key (issue #24). The optional `kind` / `seeds` fields are toolchain-only — `saveSnippet`'s `extra` argument (`lib/persist.ts`) — carrying the buffer language and the input-tape seed alongside the code so a loaded toolchain snippet restores its whole editing context, not just the text.

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
- Extensions: `javascript()` lang, `oneDark` theme, our `completionExtensions(engine)` (the smart-completions layer at `src/lib/completions/` — schema-driven, context-aware; surfaces namespace identifiers ranked by destructure status, member access on user-typed locals, `state.debug` RHS shapes, options-bag keys for known constructors, and auto-import into the top `const { … } = imports;` block; see #103 + the spec at `docs/superpowers/specs/2026-06-07-44-smart-completions-design.md`), plus the signature-help layer at `src/lib/completions/hints/` (#105) — a `StateField<Tooltip | null>` walks the Lezer tree from the cursor up to the enclosing `ArgList`, resolves the parent `CallExpression`/`NewExpression`'s callee against the schema (namespace functions, post-instructions, member methods via `inferLocalsFor`, or constructors — with reverse-rename resolution against `importsBinding.renames`), counts commas before the cursor for the active-arg index, and renders a single-line tooltip via the `showTooltip` facet (header reflects what the user typed, no tooltip past the last declared parameter, zero-param signatures suppressed). Plus an arg-count lint source at `src/lib/completions/lint/argCount.ts` (#114 Phase 1) — walks `CallExpression` / `NewExpression`, reuses `resolveCallee` to classify the callee against the schema, emits `error` for missing required args + bare-only post-instructions called as functions (e.g. `stop()`), `warning` for extras past last declared; renamed-import calls show the user-typed alias in the message. And a cross-reference lint source at `src/lib/completions/lint/crossRef.ts` (#114 Phase 2) — for each `new PostMachine({...})`, recursively collects a `ScopeNode` tree (numeric keys = instruction indices, string keys = nested subroutines), then walks with a `ScopeChain` (innermost → root). Indexed instruction calls (`mark(N)`, `check(N, M)`, …) validate against the current scope's indices; `call(name)` resolves names by walking the chain local-to-root (subroutines nest, lookup is lexical); `call(name, ix)`'s `ix` is in the caller's local scope. Flags indexed forms inside array groups (`1: [mark(2), right]` throws at construction) and empty subroutine bodies. And an unbound-identifier lint source at `src/lib/completions/lint/unbound.ts` — catches bare identifiers used in expression position that aren't destructured from `imports`, declared locally, or in a small JS-built-in allowlist (e.g. `Math`, `JSON`, `console`). A depth-0 `VariableDefinition` pre-pass keeps for / for-of / for-in headers and block-scoped declarations off the report (#119); hoisted `function foo() {}` names are still flagged. Function/arrow bodies are skipped to avoid false positives on their params; conservative-but-safe. Both engines. Also a Lezer-based `syntaxLinter` for syntax-error markers before Build.
- A small reset-to-selected-example button overlays the editor's top-right corner; the log's clear button uses the same shared `IconButton.svelte` (corner-overlay variant) — both are absolutely positioned within their `position: relative` parent (`.editor` / `.log-panel`). The editor also overlays `<DiagnosticsCounter>` at the bottom-right (#106) — three pills (E / W / I) showing aggregate counts across all lint sources, computed by a `DiagnosticsCounter` class (Svelte 5 runes) updated by `diagnosticsCounterPlugin` on every transaction. Pills hide individually when their count is 0; pointer-events: none keeps the overlay click-through. Phase 1 is read-only; click-to-jump is parked.

## Deploy

`dist/` lands in `mellonis/vps`'s `static/demo.machines.mellonis.ru/`, then rsynced to `/var/web-apps/demo.machines.mellonis.ru/` on the box. Served by the `demo.machines.mellonis.ru` nginx site (CSP includes `'unsafe-eval'` because user-supplied JS still runs via `new Function()` inside a Web Worker — the worker is the security boundary, CSP narrows everything else: no third-party scripts, no inline event handlers, no embedding).

The toolchain engines add a wasm payload: the module rsyncs like any other hashed static asset, so nothing about the deploy shape changes, but two host settings decide whether it loads. Confirm the host's `mime.types` maps `.wasm` to `application/wasm` — without it the wasm-bindgen glue cannot use `instantiateStreaming` and falls back to `arrayBuffer()` with a console warning (slower, still functional). And confirm the site's CSP allows WebAssembly compilation: the `'unsafe-eval'` above already covers it; `'wasm-unsafe-eval'` is the narrower alternative if the JS-engine pages ever stop needing `'unsafe-eval'`. A refusal on either count surfaces as the worker's `toolchain module failed to load: <reason>` line, not as a silent hang.
