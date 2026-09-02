# Toolchain engines (PM-1 / TM-1) over the machine-toolchains wasm bundle — design

Tracks: [#136](https://github.com/mellonis/machines-demo/issues/136). Demo-side half of [machine-toolchains#6](https://github.com/mellonis/machine-toolchains/issues/6). Consumes the bundle at [v0.5.0-rc.2](https://github.com/mellonis/machine-toolchains/releases/tag/v0.5.0-rc.2), which folded in the three surfaces this design asked of rc.1 — [#113](https://github.com/mellonis/machine-toolchains/issues/113) (assembly as a language), [#114](https://github.com/mellonis/machine-toolchains/issues/114) (tape-block codec), [#115](https://github.com/mellonis/machine-toolchains/issues/115) (stdlib source + line info); toolchains design note `docs/superpowers/specs/2026-09-02-wasm-rc2-surface-design.md`.

## Problem

The demo shows the two JavaScript machine libraries. The Rust toolchains (`pmt` for the Post machine PM-1, `tmt` for the multi-tape Turing machine TM-1) now compile to a browser bundle — `mtc-wasm`: compile / assemble → link → run, lint, fmt, disassembly, tape-block codec, the standard library's text, both toolchains; 1.18 MB raw / 466 KB gzipped at rc.2, attached to every toolchains release with a checksummed `manifest.json`. Reference: the toolchains' `docs/wasm.md`. Nothing in the demo can load it, and the demo's execution model is built around the JS engines' worker protocol: per-step `Command` replay on a main-thread mirror machine, graph-node breakpoints keyed by state id, a mermaid state graph. The wasm session is a different shape — a pumped `Session` with Rust-owned tapes, snapshots per pause, address-level breakpoints, a line table instead of a graph.

This round adds two engine pages, `/pm1` and `/tm1`, with the whole surface the rc.2 binding offers, reusing the demo's shell and leaf components without touching the JS engines' orchestrator.

## Decisions

1. **Sibling orchestrator, not a generalised `MachineView`.** `ToolchainView.svelte` is mounted for the two new engines; `MachineView.svelte` is not modified. Leaf components are shared: `TapesStack` / `Tape` (via the existing `setTapeViewport(cells, head, blank)` path), `ControlPanel` (speaks `Command`s), `Toolbar`, `Log` + `LogStore`, `SettingsPanel`, `persist`, `initialBoot`, and a generalised `Editor`. Rejected: an engine adapter inside `MachineView` — the two runtimes disagree on where tape truth lives (mirror replay vs Rust snapshots) and on what a breakpoint is (state id vs address), so the adapter would be wide and every step would touch the working pages. Rejected: a separate mini-app — duplicates shell, theme, settings, snippets.
2. **Routes `/pm1` and `/tm1`, header tabs "PM-1" and "TM-1".** `ENGINES` grows to four; the route model is unchanged. Rejected: `/pmc`+`/tmc` (source-language names mean little to a visitor), one `/toolchains` page with a switch (duplicates what tabs do).
3. **The machine-graph panel slot is hidden for toolchain engines this iteration.** No listing / disassembly pane replaces it yet. The editor is the debugger view: gutter breakpoints and an ip line highlight, in both file tabs.
4. **Full surface**: Build, Run (auto / continuous), Step, tapes fed from session snapshots, editor diagnostics from `check`, Format, breakpoints, ip highlight, source file Open / Save, **assembly as a per-buffer language kind**, **tape-block Load / Save**, **a live read-only stdlib tab** (ip placement, breakpoints, go-to-definition), **`std::` completion over the stdlib's exported names**. Landing showcases for the new engines are a separate round.
5. **The UI owns the input tape.** `.pmc` / `.tmc` / `.pma` / `.tma` sources do not declare tape contents (the CLI takes a separate tape block). After Build the alphabets come from `program.tapes()`; the control panel edits seed tapes in MANUAL; a tape block can be loaded into or saved from them; Step / Run create the session from what is on screen; seeds persist next to the code; bundled examples ship a seed. Rejected: an in-source comment convention — invents notation the toolchains do not own.
6. **Two file views per toolchain page**: the user's buffer (`main.<pmc|tmc|pma|tma>`), and the standard library the program links against (`std.pmc` / `std.tmc`, read-only, text from `Toolchain.stdlibSource`, exactly what the module linked). Both tabs are debugger surfaces: `SourceLoc.file` routes the ip and breakpoints to the right one.
7. **Language kind is a property of the buffer**, `source | asm`; `lang = arch × kind` (`pm1` → `pmc` / `pma`, `tm1` → `tmc` / `tma`). It persists per engine and travels with examples and snippets. Switching source → assembly offers to disassemble the last successful Build into the buffer (`Program.disassembly()` is `build`-able as that arch's assembly with identical bytes — the toolchains' text-expressibility gate). Rejected: separate `/pma`-style routes (the arch is the engine; the kind is a view of it).
8. **Bundle consumed as a release artifact**, pinned by tag + per-file SHA-256, cached under a gitignored directory, with a local-path override. Ruled toolchains-side in the binding design; the demo owns the script.
9. **One worker per toolchain page**, owning the wasm module, one `Program`, at most one `Session`. Lint, format and codec requests are served between pump slices during a run. Rejected: a second "language" worker — a second module init for a debounced lint the slice loop already serves in time.
10. **Breakpoints are keyed by `{ file, line }`** in the view and resolved to addresses at Build and at each `start`, since user addresses shift with every edit (stdlib lines are stable per bundle but resolve the same way for uniformity). Lines that lose their mapping are dropped with one log line.
11. **Panic policy**: any throw from the module that is not a documented result is a dead module — the runner terminates the worker; the next request respawns and re-inits it; the log says so once. (`docs/wasm.md`: `panic = "abort"`, no message crosses.)

## File map

```
toolchains-wasm.json                    pinned toolchains tag + SHA-256 per bundle file (committed)
scripts/fetch-toolchains-wasm.mjs       download → unpack → verify → vendor/mtc-wasm/ ; no-op on a verified cache; MTC_WASM_DIR override
vendor/mtc-wasm/                        gitignored: mtc_wasm_bg.wasm, mtc_wasm.js, mtc_wasm.d.ts, manifest.json
src/lib/toolchain/
  types.ts                              worker protocol, SeedTape, LineMap, BufferKind, ToolchainEngine, TOOLCHAIN_ARCH, langFor(engine, kind), isToolchainEngine
  toolchainWorker.ts                    wasm init, Program / Session ownership, pump loops, request dispatch
  toolchainRunner.ts                    main-thread wrapper: injected worker factory, per-segment watchdog, lastProgress, WorkerError / WorkerTimeoutError, panic respawn
  toolchainHelpers.ts                   pure: glyph↔index mapping, SeedTape ↔ wasm Seed, snapshot windowing + head delta, lineMap from listing/lineOf/addressForLine, stdlib export index (definition search + completion list)
  lang/pmc.ts, tmc.ts, pma.ts, tma.ts   CodeMirror StreamLanguage tokenizers ported from editors/grammars/*.tmLanguage.json
  editor/lint.ts                        @codemirror/lint source over runner.check — positions, severities, fix actions
  editor/breakpointGutter.ts            gutter markers + click toggle keyed by line (one instance per tab, file fixed per instance)
  editor/ipHighlight.ts                 line decoration StateField for the paused ip; scrollTop math, never scrollIntoView
  editor/stdLink.ts                     Cmd/Ctrl-click on `std::name` → onGoToStd(name)
  editor/stdCompletion.ts               CompletionSource after `std::` — one entry per stdlib export, declaration line as detail
  examples/*.pmc, *.tmc, *.pma, *.tma   bundled programs as real source files (?raw)
  examples.ts                           Example[] per toolchain engine with kind, glyph seeds, descriptions
src/components/
  ToolchainView.svelte                  orchestrator for pm1 / tm1
  FileTabs.svelte                       tab strip: main.<ext> (with the kind switch) | std.<ext>
  Editor.svelte                         generalised: language + built-in lints chosen by engine kind; new `extensions`, `readOnly`, `lang` props
  Toolbar.svelte                        optional `onFormat`; optional file menu (`onOpenFile`, `onSaveFile`)
  TapesStack.svelte                     optional corner actions slot (used for tape-block Load / Save icon buttons)
  App.svelte                            two more tabs; mounts ToolchainView for toolchain engines
src/lib/types.ts                        ENGINES = ['turing','post','pm1','tm1']
src/lib/defaultCode.ts                  Example gains `kind?: BufferKind`, `seeds?: ExampleSeed[]`
src/lib/persist.ts                      new per-engine keys `seeds`, `kind`; snippet records carry `kind?`, `seeds?`
vite.config.ts                          `$mtc` alias → vendor/mtc-wasm/mtc_wasm.js ; lib-versions plugin also reads vendor manifest
tsconfig.json                           `paths` for `$mtc` → the vendored .d.ts
```

## Bundle pipeline

**Pinning.** `toolchains-wasm.json` (values are the rc.2 release's):

```json
{
  "tag": "v0.5.0-rc.2",
  "files": {
    "mtc_wasm_bg.wasm": "ffe72ee93a31f273685393b067225a2e2dbdb6172f1372bf1385b8e74de25a73",
    "mtc_wasm.js": "c26e045c796496d708dfd09f1247d3e848227c7c02799ee5dee61efd8ed978f2",
    "mtc_wasm.d.ts": "4c4840214894fb69c5097aed2dc2d2f0c679aa798735382f04c3917aa2d2b0b4",
    "manifest.json": "9b1e20397754ab63f755dae0f1f51efc943937ae419b2255c37326120c890e42"
  }
}
```

The three file hashes are the release manifest's, copied so a replaced release asset cannot pass unnoticed; the manifest itself is pinned too. The script downloads `machine-toolchains-wasm-<tag>.tar.gz` from the toolchains release for `tag`, unpacks into `vendor/mtc-wasm/`, verifies every file, fails loudly naming any mismatch, prints what it verified, and is a no-op when the directory already verifies (a few hash checks, no network). No stdlib files: their text comes from the module (`stdlibSource`).

**When.** `postinstall`. Every path needs the directory: `svelte-check` needs the `.d.ts`, the build needs glue + wasm, vitest suites load the module under Node. Every CI job runs `npm ci`, so the workflows do not change. `MTC_WASM_DIR=<unpacked bundle dir>` copies from a local build instead of downloading, skips the hash check, and prints a warning (a stale override must not pass silently).

**Loading.** Only `toolchainWorker.ts` imports `$mtc`, so `/turing` and `/post` keep their payload. The worker calls the glue's default `init({ module_or_path: new URL('mtc_wasm_bg.wasm', import.meta.url) })`; Vite rewrites the URL into a hashed asset. Init happens once per worker, lazily on the first request.

**Version surface.** The `virtual:lib-versions` plugin also exports `toolchainsVersion` from the vendored `manifest.json`; the footer shows `toolchains v0.5.0-rc.2` beside the npm versions, linking to the toolchains repository.

**Deploy.** The wasm rsyncs as a static asset. Verify on the VPS side (separate change if needed): nginx serves `.wasm` as `application/wasm`; the site's CSP already carries `'unsafe-eval'`, which also permits WebAssembly compilation.

## Worker protocol

All shapes in `src/lib/toolchain/types.ts`. `Lang = 'pmc' | 'tmc' | 'pma' | 'tma'` (re-exported from the vendored `.d.ts`); `BufferKind = 'source' | 'asm'`; `TOOLCHAIN_ARCH = { pm1: 'pm', tm1: 'tm' }`; `langFor(engine, kind)`. Wasm data types (`Diagnostic`, `TapeLayout`, `TapeSnapshot`, `RunResult`, `RunStats`, `SourceLoc`, `TapeBlock`, `Seed`) cross the boundary as the plain objects they already are.

| Request | Response |
|---|---|
| `build { lang, code }` | `built { ok: true, tapes: TapeLayout[], diagnostics, lineMap }` — the compile channel's warnings (assembly: none); or `built { ok: false, diagnostics }` (the fatal as one coded error, plus warnings). `LineMap = { addrToLoc: Array<{ addr, file: 'user' \| 'std', line: number \| null, fn: string }>, userLineToAddr: Array<number \| null>, stdLineToAddr: Array<number \| null> }`, built once in the worker from `listing()`, `lineOf`, `addressForLine(line)` and `addressForLine(line, 'std')`, so gutter clicks and ip placement resolve on the main thread with no round trips. |
| `stdlib { lang }` | `stdlibText { text }` — `Toolchain.stdlibSource(lang)`; requested once on mount (the text is per arch and fixed per bundle). |
| `check { lang, code }` | `checked { diagnostics }` — the lint channel. |
| `format { lang, code }` | `formatted { ok: true, text }` or `formatted { ok: false, error: Diagnostic }`. |
| `disassemble` | `disassembled { text }` — `program.disassembly()` of the last successful build; `error` if none. |
| `decodeTapeBlock { bytes }` | `tapeBlockSeeds { seeds: Seed[], tapes: TapeLayout[] }` — `Toolchain.decodeTapeBlock` then `program.seedsFromTapeBlock`; the codec's / mapper's thrown message comes back as `error { message }` verbatim (it names the tape, glyph and band). Requires a built program. |
| `encodeTapeBlock { tapes: TapeBlockTapeInput[] }` | `tapeBlockBytes { bytes }` — `Toolchain.encodeTapeBlock({ tapes })`; the container version follows the block's shape (no `lang`). |
| `start { seeds: Seed[], limits: { maxSteps? }, breakpoints: number[], mode: DriveMode, intervalMs? }` | Creates `program.session(seeds, limits)`, registers breakpoints (when debug is on), drives per `mode`. Stream: `stepped` / `progress` / `paused` / `finished`, or `error`. |
| `resume { mode, intervalMs? }` | Same stream, same session. |
| `pause` | Fire-and-forget: sets the worker's pause flag and calls `session.pause()`. |
| `stop` | `finished { outcome: { kind: 'stopped' }, stats, snapshots }` synthesised from a final `snapshots()` then `session.stop()`. |
| `setBreakpoints { addrs }` | Fire-and-forget; full set, idempotent; applied to the live session (diff against the registered set) and remembered for the next `start`. |
| `setDebug { on }` | Fire-and-forget. Off: no breakpoints are registered on the session, and a `paused { cause: 'brk' }` from a retired `debugger` instruction is not a pause (the loop pumps on). On: re-register the remembered set. |

Stream messages: `stepped { snapshots, ip, stats, retired: boolean }` (one per `pump(1)`; `retired: false` when that pump reported a `paused { breakpoint }` instead of `budgetSpent` — nothing advanced, the next Step will, matching the core's own semantics), `progress { snapshots, steps, ip }` (time-gated by `PROGRESS_INTERVAL_MS`; the runner stashes the latest as `lastProgress`, kept across terminate, so a watchdog kill restores the last known tape), `paused { cause, ip, snapshots, stats }`, `finished { outcome, stats, ip, snapshots }`, `error { message, snapshots? }`.

Every `stepped` carries full snapshots — unlike the JS engines' `stepped`, there is no command trace to replay. Snapshots are trimmed spans (`origin`, `cells`, `head`), cheap at step cadence.

**Drive modes.**

- `step`: one `pump(1)`; respond `stepped`; segment ends.
- `auto`: loop `pump(1)` → `stepped` → `await sleep(intervalMs)` → check the pause flag. Exits on `paused` (breakpoint / brk with debug on, or manual), `finished`, or the flag.
- `continuous`: loop `pump(SLICE_BUDGET)` → if `budgetSpent`: post `progress` if the gate is open, `await yield()` (a resolved-promise / `MessageChannel` hop so queued `pause` / `check` / `format` / codec / `stop` messages are served), check the flag, continue. `SLICE_BUDGET` is a constant in `caps.ts` sized for roughly 20–50 ms of work on a mid-range laptop; calibrate in the plan against the unary power-of-two example. `paused` / `finished` end the segment.
- Any pump reporting `deviceWait` is a bug with owned devices (`docs/wasm.md`) → `error`.

**Limits.** `maxSteps` from settings → `Limits.maxSteps`; the core traps with `step-limit`, which the view reports as the truncated run (`finished { outcome: { kind: 'trapped', trap: { kind: 'step-limit' } } }`), the same words the JS pages use for `truncated: true`. `Infinity` → limit omitted; the wall-clock watchdog stays the backstop. `maxTacts` unused.

**Runner.** `ToolchainRunner` mirrors `MachineRunner`'s shape (injected `workerFactory`, `sendSimple` pairing, per-segment `setTimeout` watchdog reading `getSetting('workerTimeoutMs')` at each segment start — suspended on `paused`, restarted on `resume`, killed on `finished` / `error`; `terminate()` + respawn on next request; `lastProgress`). A separate class, not a generic over `MachineRunner`: the request unions differ end to end and the shared part is ~80 lines of timer bookkeeping. Extracting a shared base is a later refactor if a third runner appears.

## Execution model mapping

The five modes and every user action keep their meaning (`docs/execution-model.md`); only the worker mechanics differ:

| Mode / action | JS engines | Toolchain engines |
|---|---|---|
| Build | `build` → mirror machine rebuilt | `build { lang }` → `built`; seeds kept if bands + alphabets unchanged, else reset to blank (logged); breakpoints re-resolved by `{ file, line }` |
| Step (cold-start / paused) | `run { step }` / `resume { step }` | `start { mode: 'step' }` / `resume { mode: 'step' }` → `stepped` → RUNNING_PAUSED |
| Run, withPause on | `run { intervalMs }` | `start { mode: 'auto', intervalMs }` |
| Run, withPause off | `run` | `start { mode: 'continuous' }` |
| Pause (auto) | `pause` | `pause` → next `paused { cause: 'manual' }` |
| Continue | `resume` | `resume { mode }` |
| Stop | terminate | `stop` → `finished { stopped }` → HALTED |
| Take Control | mode flip (#135 pending) | `stop` the session; copy last snapshots into seeds → MANUAL |
| Apply (MANUAL) | mirror write | seed-tape write on the main thread, re-render |
| Debug toggle | `setDebug` | `setDebug` |
| Completion | `ran` | `finished { halted \| stopped \| trapped }` → HALTED; outcome flavour in the log (trap kind + detail, `at` address → `file:line` via lineMap) |

Belt animation in step / auto mode: per band, `delta = clamp(head_new − head_old, −1, 1)` and `wrote = cell under head_old changed`, fed to `TapesStack.setTapeViewport` + the existing slide / flash. Continuous mode snaps like today.

## Editor

**Modes.** `lang/pmc.ts`, `tmc.ts`, `pma.ts`, `tma.ts`: `StreamLanguage` tokenizers hand-ported from the four TextMate grammars (each cites its source grammar in a header comment), emitting standard tags — `keyword` (`use`, `namespace`, `export`, `goto`, `check`, `mark`…, `alphabet`, `machine`, `tape`, `state`, `entry`, `write`, `move`, `stop`; assembly mnemonics and section keywords), `comment`, `number`, `labelName` (`N:` / assembly labels), `function` names and `@calls`, `string` for glyph literals, `operator`, `namespace` (`std::`). One Dark and the light default style them; no Lezer grammar — syntax errors come from the toolchain.

**Editor generalisation.** `Editor.svelte` keeps `engine` and gains `lang?: Lang` (toolchain engines only; selects the stream mode), `extensions: Extension[]` (appended), `readOnly` (stdlib tab: `EditorState.readOnly.of(true)` + `EditorView.editable.of(false)`, no reset button, no diagnostics counter, no persistence). By engine kind: JS engines keep `javascript()` + completions + the three semantic linters; toolchain engines get the stream mode and nothing else built in. `saveCode` runs only for the editable instance.

**Two file views.** `FileTabs.svelte`: `main.<ext>` and `std.<ext>`. The main tab carries the **kind switch** (source ⇄ asm). Switching to asm with a non-empty buffer and a successful Build behind it offers *Disassemble last Build into the buffer* (worker `disassemble`) or *Start blank*; without a build, blank. Switching back to source restores the last source buffer (kept in view state for the page's lifetime; persistence keeps only the active kind's code). Tab state is view-local, defaults to the main tab, and follows the ip (below). The stdlib tab shows `stdlibText` for the arch — the same text for both kinds, since an assembled program links the same library. Mobile: the strip stays; both tabs render in the same slot.

**Diagnostics.** `editor/lint.ts`: a `linter()` source with `delay: 400` calling `runner.check(lang, code)`; UTF-16 `from`/`to` map directly; severities one-to-one; a diagnostic with `fix` becomes an action named by `fix.description` that applies `edits` as one transaction (`maybeIncorrect` fixes prefixed "(may be incorrect)"). Build warnings from `built` are logged, not shown inline — the lint channel stays the single inline source, the CLI's split. On assembly, `check` runs the assembly lint behind the assemble gate; unknown mnemonics surface here as the coded error. `check` during a continuous run is served between slices; if the worker is dead the source returns `[]`.

**Breakpoints.** `editor/breakpointGutter.ts`: one gutter instance per tab, each bound to a fixed `file`. The view holds `breakpoints: SvelteSet<string>` keyed `"<file>:<line>"`. Resolution to addresses (`userLineToAddr` / `stdLineToAddr`) happens on Build and on `start`; the address set goes out as `setBreakpoints` / `start.breakpoints`. A line with no address refuses the click — marker not set, gutter element `title` explains. After a Build, keys that no longer map are removed with one log line naming them. Debug off: markers stay, nothing pauses (worker-side, see `setDebug`).

**Ip highlight.** `editor/ipHighlight.ts`: a `StateField<DecorationSet>` with a line decoration class `cm-ip-line` (amber `--graph-highlight` tokens, decoupled from `--head` as the graph's is), set from `lineMap.addrToLoc[ip]` whenever the view enters RUNNING_PAUSED or receives a `stepped`; scrolled into view with `scrollTop` math (not `scrollIntoView`). The tab **follows the ip**: `file: 'std'` activates the stdlib tab, `file: 'user'` the main tab; the user can switch tabs freely while paused, and the next step re-follows. Cleared on resume, Build, HALTED. A null line (a function's entry byte) → no highlight; the paused log line reads `paused in <file>:<fn>`.

**Go to definition.** `editor/stdLink.ts`: Cmd/Ctrl-click on a `std::name` token (source kinds; in assembly, on a `std::name` operand) calls `onGoToStd(name)`; the view opens the stdlib tab and scrolls to the first line matching the definition pattern — `.pmc`: `^\s*(export\s+)?name\s*\(`; `.tmc`: `^\s*(export\s+)?(routine|graph|alphabet)\s+name\b` — else opens the tab at the top with a log line `no definition found for std::name`. Pure search in `toolchainHelpers.findStdDefinition(lang, text, name)`.

**`std::` completion.** `editor/stdCompletion.ts`: a `CompletionSource` (via `autocompletion()` with the demo's existing options) that activates when the token before the cursor is `std::<prefix>` — in source kinds anywhere a call is written (`@std::` in `.pmc`, `std::` in `.tmc` `use` lists and call sites), in assembly in a `call std::` operand. Entries come from `toolchainHelpers.indexStdExports(lang, text)`: one per `export` in `stdlibSource` (`.pmc`: `export name()`; `.tmc`: `export routine|graph|alphabet name(...)`), `label = name`, `type` = function / class (alphabet), `detail` = the declaration line trimmed, `info` = the preceding doc-comment block when present. The index is built once per page from the same text the stdlib tab shows, so the list can never drift from the linked library. No user-defined names, keywords, or parse-dependent items — that is the language-server surface and stays out.

**Format.** `Toolbar` gains optional `onFormat`; the button renders only when provided. The result replaces the document via one CodeMirror transaction (undo restores). A format error is a compile / assemble fatal → logged as error with its position; buffer untouched. Available in every mode (does not touch the program); the stale-build dot then shows as usual.

**Open / Save.** `Toolbar` gains an optional file menu (`onOpenFile`, `onSaveFile`). Open: hidden `<input type="file" accept=".pmc,.tmc,.pma,.tma">`; the extension selects the kind when it matches the arch (a `.tma` opened on PM-1 is refused with a log line); the buffer is replaced (undo restores). Save downloads the buffer as `<title>.<ext>` via a blob URL, where title is the loaded snippet's title, else the selected example id, else `main`.

## Tapes, seeds, tape blocks

`SeedTape = { cells: Map<number, number>, head: number }` per band (absolute position → alphabet index; blank = index 0 everywhere else, both toolchains' convention and the wasm's for unseeded cells). Alphabets for the control panel: `program.tapes()[i].glyphs`, index 0 flagged blank (existing dim styling). For a TM-1 **assembled** program the bands are `tape0…` with decimal glyphs `0…card-1` (what the image can say); the panel shows those.

- **MANUAL**: Apply takes the panel's per-band `Command`s and mutates `seeds` on the main thread (write symbol → index via glyph lookup; move head), then re-renders via `setTapeViewport`. No worker.
- **Step / Run**: `seeds` → wasm `Seed[]` (`cells` dense from min to max key, `origin = min key`, `head`) in `start`. Empty seed → `{ cells: [], head: 0 }`.
- **During a run**: tapes render from worker snapshots; `seeds` untouched.
- **HALTED / Take Control**: last snapshots copied back into `seeds` (index arrays → sparse map, dropping blanks), so the next Step / Run starts from what the user sees and Apply edits it.
- **Copy / Paste**: the existing `tapeSnapshot.ts` format (`symbols` + `position`) — copy serialises `seeds` as glyph strings; paste maps glyphs → indices via the current alphabets, unknown glyph → the existing categorised parse error.
- **Tape block Load / Save**: two `IconButton`s in a new corner-actions slot of `TapesStack` (MANUAL and HALTED only, and only with a built program). Load: file input `accept=".pmt,.tmt"` → bytes → worker `decodeTapeBlock` → `seeds` replaced from the returned `Seed[]` (rendered immediately) with a log line naming the file and band count; a codec or mapping error is logged verbatim (the toolchains' message names the tape, the glyph and the band — e.g. a block authored for the source program loaded into an assembled TM-1 build fails on its glyphs by design). Save: `seeds` → `TapeBlockTapeInput[]` with each band's `glyphs` → worker `encodeTapeBlock` → download `<title>.<pmt|tmt>`; the round trip through the CLI's `tape-block show` is the acceptance check.
- **Rebuild**: keep `seeds` when band count and each band's glyph list are unchanged; otherwise reset to blank with a log line (prevents an out-of-alphabet index that `session()` would throw on). A kind switch that changes TM-1 glyph labelling therefore resets seeds — logged.
- **Rendering**: `toolchainHelpers.windowSnapshot(snapshot, VIEWPORT_WIDTH)` → `{ cells: string[] (glyphs), headIndex: MIDDLE, blank: glyphs[0] }` → `TapesStack.setTapeViewport(i, …)`. Band names from `TapeLayout.name` feed the stack's tape labels.

## Engines, examples, persistence, landing

- `ENGINES = ['turing', 'post', 'pm1', 'tm1']`; `ToolchainEngine = 'pm1' | 'tm1'`; `isToolchainEngine(e)`; `TOOLCHAIN_ARCH`; `langFor`. `App.svelte` mounts `ToolchainView` for toolchain engines, keyed by engine as today; header tabs "PM-1", "TM-1"; sr-only `h1` per engine. `routing.ts` unchanged (reads `ENGINES`). Landing's `readEngineFromLandingQuery` keeps falling back to `turing` for the two new ids this round.
- `Example` gains `kind?: BufferKind` (default `source`) and `seeds?: ExampleSeed[]`, `ExampleSeed = { cells: string[], head?: number, origin?: number }` in glyphs. Programs live as real files under `src/lib/toolchain/examples/` (`?raw`), so the toolchains' formatter and linter can run over them. Initial set — PM-1: the unary sum (`std::goToEnd` / `std::goToBegin`, ported from the toolchains' golden `sum.pmc`), a short program with no stdlib calls, and one `.pma` (the sum's disassembly, so the two kinds show the same machine); TM-1: binary increment, two-tape copy, unary power of two (from the toolchains' goldens / `docs/examples/pow2`), and one `.tma` (the increment's disassembly). Each with a one-line description; lesson notes wait for the landing round. Every bundled example must Build cleanly and `check` clean at the pinned tag — a vitest asserts it.
- Persistence: existing `machines-demo:<engine>:{code,example,snippets}` work as-is; new keys `seeds` (glyph form, `ExampleSeed[]`) and `kind`, written on change, read on mount; snippet records gain `kind?` and `seeds?`. Boot: `initialBoot` unchanged for code; kind and seeds follow the same tier (example / snippet / localStorage / first example).
- Settings: none new. `maxSteps`, `workerTimeoutMs`, `logRenderCap` apply as described.
- Landing: untouched. Showcase recording for toolchain engines needs the wasm in the Vite plugin under Node — its own round.

## Docs

- `CLAUDE.md`: file tree additions; a "Toolchain engines" section (differences from the JS engines in a few lines; the fetch script; `MTC_WASM_DIR`; the pin file; the kind switch; the two tabs); dependency note for the bundle pin.
- `docs/execution-model.md`: a new section "Toolchain engines" carrying the mode → pump mapping table above and the `T-…` scenario IDs the suites cite.
- `README.md`: the two new engines, the four languages, and that the deploy pins a toolchains bundle version. Forge-agnostic wording (no issue numbers, no provider URLs).
- Code comments cite `docs/wasm.md (…)` of the toolchains and `docs/execution-model.md (toolchain engines)` — never spec sections.

## Testing

**Node, real module.** Vitest suites init the vendored glue from bytes the way the toolchains' smoke script does (`init({ module_or_path: bytes })`), so `toolchainHelpers` is tested against real programs: glyph↔index round trips (`T-seed-roundtrip`), `SeedTape` ↔ wasm `Seed` (`T-seed-dense`, empty band), snapshot windowing + head delta (`T-window-center`, `T-delta-clamp`), `lineMap` construction and inverse on mapped lines for user and std, both kinds (`T-linemap-inverse`, `T-linemap-std`, `T-linemap-asm`), stdlib export index: definition search and completion list cover every exported name in both stdlibs, with detail lines (`T-stddef-all`, `T-stdcomp-all`), pump-loop event handling for `budgetSpent` / `paused{breakpoint}` (no retire) / `paused{manual}` / `finished{halted}` / `finished{trapped step-limit}` (`T-pump-*`), debug-off ignoring `brk` (`T-pump-brk-debug-off`), a breakpoint on a std line pausing with `file: 'std'` (`T-pump-std-bp`), disassembly of a source build re-building as assembly to identical `bytes()` (`T-asm-roundtrip`), tape block encode → decode → `seedsFromTapeBlock` round trip and the named mismatch error (`T-tapeblock-*`). Every bundled example builds and checks clean (`T-examples-clean`). A `FakeToolchainWorker` covers the runner: watchdog per segment, suspend on `paused`, `lastProgress` across terminate, panic → terminate + respawn on next request (`T-runner-*`).

**Component, happy-dom.** Tokenizer goldens over the bundled examples for all four modes (`T-lang-*`). Lint source with a stubbed `check`: position mapping, severity, fix action applies edits (`T-lint-*`). `std::` completion activates only after `std::`, filters by prefix, applies the name (`T-stdcomp-*`). Gutter: toggle, refused unmappable line, cleared-on-rebuild drop, per-file keying (`T-bp-*`). Ip decoration set / clear, tab-follow (`T-ip-*`). `FileTabs`: switch, kind switch with / without a build, read-only stdlib instance (`T-tabs-*`). `Toolbar`: Format button presence / callback, file menu (`C-toolbar-format`, `C-toolbar-file`). `TapesStack` corner actions slot (`C-stack-actions`).

**E2E, Playwright** (`e2e/toolchain-pm1.spec.ts`, `e2e/toolchain-tm1.spec.ts`; `E-tc-*`): boot to the first example; a deliberate syntax error → gutter marker + counter pill, Build fails with the error logged; fix → Build ok; Step advances the belt and highlights the ip line; gutter click sets a breakpoint, Run with pause pauses there with the line highlighted; a step into `std::goToEnd` switches to the stdlib tab with the line highlighted; Continue to halt; Format changes the buffer and lights the stale-build dot; kind switch disassembles the build and the assembly builds and runs to the same final tape; a seed edited on the panel survives reload; tape block Save then Load restores the seed. `e2e/no-wasm-on-js-pages.spec.ts`: `/turing` and `/post` make no request for a `.wasm` asset (protects the payload claim).

**Fetch script** (`scripts/fetch-toolchains-wasm.test.mjs`, node): fixture tarball served from a temp HTTP server — good hashes pass, a corrupted file fails naming it, a verified cache is a no-op with no network call, `MTC_WASM_DIR` copies and warns.

## Follow-ups (not this round)

- Listing / disassembly pane in the hidden graph slot; click-to-breakpoint on listing rows.
- Landing showcases for PM-1 / TM-1 (wasm in the Vite snippet plugin under Node).
- Re-pin to the toolchains' final 0.5.0 when cut.
- Shared runner base if a third runner appears.
- `#135` (Take Control from RUNNING_AUTO) on the JS pages — unrelated, unchanged.

## Out of scope

Project manifests and user libraries; composition of several assembly units; `--nostdlib`; `maxTacts`; landing page changes; completion or hover for user-defined names and keywords (the language-server surface); any change to `MachineView.svelte` or the JS engines' worker protocol.

## Open questions

- Confirm on the VPS that nginx's `mime.types` maps `.wasm` and that the CSP passes wasm compilation (expected yes on both; fix in `mellonis/vps` if not).
- `SLICE_BUDGET` calibration — measured in the plan, not guessed here.
- Whether `readEngineFromLandingQuery` should accept `pm1` / `tm1` before the landing round (currently: no; falls back to `turing`).
