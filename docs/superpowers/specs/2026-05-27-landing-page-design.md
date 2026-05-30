# Landing page + DEMO-mode retirement — design

Tracks: [#79](https://github.com/mellonis/machines-demo/issues/79).
Consumes: [turing-machine-js#204](https://github.com/mellonis/turing-machine-js/issues/204) (`@turing-machine-js/visuals`).
Sequencing dependency: `@turing-machine-js/visuals` extracted on the `v7` branch and published lockstep with the next engine v7 alpha → this spec executable. Both engine v7 alpha (already at `7.0.0-alpha.6`, feature-complete) and the visuals alpha are sufficient; this work does NOT wait for engine v7 stable. machines-demo consumes the visuals package from npm `next`.

## Problem

Today `/` 301-normalises to `/turing` (`App.svelte:42-44`). First-time visitors land on the Turing engine page in DEMO mode (`MachineView.svelte:70` `executionMode = 'DEMO'`), where `demoLoop.ts` ticks every 1600 ms with a random per-tape `{movement, symbol}` pair (`startDemoLoop` in `src/lib/demoLoop.ts`). The loop animates the tape but communicates nothing about what these machines compute — symbols change, the head wiggles, no state graph activity, no halt, no story. The Post page mirrors the same shape.

That has two costs:

1. **Visitor learns nothing on arrival.** Random L/R/S commands are tape-cell shuffling, not a program. Anyone arriving via a link or search result sees motion that doesn't match the engine's actual semantics, and the engine-page chrome (editor + log + control panel) is intimidating to drop into cold.
2. **MachineView carries dual responsibility.** `MachineView.svelte` is 1359 LOC and serves *both* showcase (DEMO) and authoring (MANUAL / RUNNING_* / PAUSED / HALTED). DEMO touches `ExecutionMode` union, `demoEnabled` state, a 12-line `$effect` (`MachineView.svelte:991-1003`), `panelRef?.reflect/flashApply` (`ControlPanel.svelte:47-65`), and several `executionMode === 'DEMO' ? ... : ...` branches scattered through Step / Apply / take-control transitions. The state machine is significantly simpler with DEMO removed.

The fix is to split the two concerns: a dedicated landing page at `/` does the showcase job with prerecorded snippets (real programs, halt visible, story per snippet); `/turing` and `/post` shed DEMO entirely and become single-purpose authoring pages booted to a static loaded program.

## Decisions

### Phase the work into two PRs (+ a content sub-PR)

The issue describes one outcome but conflates infra, refactor, and content. Splitting reduces diff blast radius:

- **Phase 1 — Landing route + SnippetPanel + recordSnippet pipeline.** Adds `/` as a first-class route, a `Landing.svelte` view, a `SnippetPanel.svelte` playback component, and a Vite plugin that runs `@turing-machine-js/visuals`'s `recordSnippet` over showcase-flagged examples to emit `virtual:snippets`. `/turing` and `/post` are untouched; DEMO continues to run. Ships with **one placeholder showcase example per engine** (just enough to prove the pipeline end-to-end and exercise both Turing and Post code paths).
- **Phase 2 — Retire DEMO mode.** Removes the `'DEMO'` `ExecutionMode` variant, `demoEnabled` state, the demo-loop `$effect`, `panelRef.reflect`/`flashApply`, and deletes `src/lib/demoLoop.ts`. Engine-page boot becomes static (see "Engine page boot priority" below). Decoupled from Phase 1 — could ship before or after, but reads cleanly *after* (so the landing page is the answer to "where did the demo animation go").
- **Content sub-PR (follow-up to Phase 1).** Replaces Phase 1's placeholder showcase examples with three properly curated examples per engine (simple / moderate / composed). Pure content authoring — no infra changes. Could land before, after, or in parallel with Phase 2.

Each phase produces working software. Earlier draft had this as three phases with a handwritten-fixtures intermediate; reordering to do #204 first removes the fixture stage and collapses Phase 1 + Phase 3.

### `/` is a first-class route, not a redirect target

`App.svelte`'s current normalisation collapses `/`, `/foo`, and any other unknown path into `/turing`. Phase 1 changes this: `/` is the landing page; unknown paths normalise to `/` (not `/turing`); legacy `?machine=<engine>` rewrites stay (`App.svelte:25-33`) so old bookmarks keep working.

Route state moves from `Engine` to a discriminated union:

```ts
type Route = { kind: 'landing' } | { kind: 'engine'; engine: Engine };
```

`activeEngine` is replaced by `route`. `readRouteFromUrl()` returns `{ kind: 'landing' }` for `/` or empty path, `{ kind: 'engine', engine }` when the first segment is a known engine, and `{ kind: 'landing' }` for anything else (with a `history.replaceState` to canonicalise the URL to `/`). `selectRoute(route)` becomes the navigation helper.

Rejected alternative: keep `Engine` and treat `'landing'` as a fourth value. That smears the discrimination across a flat union and forces every consumer of `engine` (worker import, MachineView prop, persist keys) to handle a sentinel. The discriminated union localises the landing case to one switch in `App.svelte`.

### Landing has its own inline engine switcher; header tabs always navigate

Two reasonable shapes for the header on `/`:

- Header tabs (Turing | Post) navigate to engine pages; landing has an inline switcher above the three snippet panels for choosing which engine's snippets to show.
- Header tabs *toggle which snippets render on landing* (no navigation), and only navigate when on `/turing`/`/post`.

The first shape wins. Header tabs are the global engine-pages navigation; their behavior must not change based on the current route, or the affordance becomes inconsistent (clicking "Turing" sometimes navigates, sometimes mutates inline state). Landing gets its own switcher, sized and styled differently from the header tabs (large, near the panels, with a "Turing snippets" / "Post snippets" label) so it reads as content, not chrome.

On landing the header tabs render with no active state (neither "Turing" nor "Post" highlighted) and a third visual cue ties them to the engine destinations — clicking either navigates away.

Landing's inline engine choice is reflected in the URL as `?engine=post` (omitted = `turing`) so bookmarks survive. Switching the inline engine `pushState`s the new URL. Reading the URL on mount picks the initial engine. This piggybacks the existing `popstate` listener.

### Deep link uses `?example=<id>`, NOT `?snippet=<id>`

`?snippet=<id>` is taken — it loads a *user-saved* snippet from localStorage (`MachineView.svelte` `initial.snippetId` flow + `loadSnippets`/`saveSnippet`/`renameSnippet` in `persist.ts`). Bundled examples are a different namespace (`defaultCode.ts:189-208` `examples()` + `findExample()`) and must not collide.

The "Open in editor" CTA on each snippet panel deep-links to `/<engine>?example=<id>`. The engine page reads `?example=` on boot, looks the id up via `findExample(engine, id)`, and loads the code. If the id is unknown the page reports a `log.report('example not found: …', 'error')` and falls back to engine-page boot priority (see below) — matching the existing "snippet not found" behavior at `MachineView.svelte` lifecycle's `initial.badUrlId` check.

`?example=` is stripped from the URL once the user takes any action that changes loaded content (matches the existing `?snippet=` lifecycle behavior — `MachineView.svelte:980-985`).

### SnippetPanel is pure-playback, no worker, no eval

`SnippetPanel.svelte` is the per-snippet renderer on `/`. It takes a `Snippet` artifact (the shape defined by `@turing-machine-js/visuals` — see "Snippet source-of-truth" below) and renders, in order:

1. Caption (the snippet's `name` / `description`).
2. State graph — `MachineGraph.svelte` in a read-only mode (no breakpoint clicking, no collapse toggle). The graph data is `snippet.graph` straight from the artifact.
3. Tape(s) — `TapesStack.svelte` in a read-only mode (no caret edit, no copy-paste affordance).
4. "Open in editor" button — `<a href="/<engine>?example=<snippet.id>">`.

Playback iterates `snippet.frames[]` at a per-snippet `intervalMs` (default 800 ms, snippet metadata may override). On each tick: set graph highlight, set tape snapshot. After the last frame: stop. No looping. The panel does NOT instantiate a worker, does NOT call `new Function(...)`, does NOT import the runner. Everything it needs is in the JSON artifact.

The "read-only mode" toggle on `MachineGraph.svelte` and `TapesStack.svelte` is a new `readOnly?: boolean` prop (default `false`). Phase 1 adds the prop and gates the interactive surface (breakpoint click handlers, collapse toggle, caret edit, etc.) on `!readOnly`. This avoids forking the components.

Rejected alternative: a separate `SnippetGraph.svelte` / `SnippetTape.svelte`. Forking guarantees future drift between the showcase and authoring renderers (the visuals package exists precisely to prevent that), and the read-only gating is small. Reuse with a flag.

### Auto-play on scroll-in + `prefers-reduced-motion` opt-out

Auto-play triggers via `IntersectionObserver` with `threshold: 0.5` — once the panel is half-visible, playback starts. Plays once. After the final frame the panel freezes on the halt state. A "Replay" button below the panel resets the playback to frame 0 and plays again.

`prefers-reduced-motion: reduce` users get static rendering: the panel renders the **last frame** of the snippet (halt state — graph shows the halt-target highlight, tape shows the post-program state) with a "Play" button instead of "Replay". Clicking "Play" runs through frames once. Rationale: the halt state is the most informative single frame to show statically — it tells the visitor what the program produced — and motion is opt-in for the user who asked to avoid it.

`window.matchMedia('(prefers-reduced-motion: reduce)')` is read once on `SnippetPanel` mount; no live listener needed (re-mount on tab change is sufficient).

### Snippet source-of-truth: schema lives in `@turing-machine-js/visuals`

[turing-machine-js#204](https://github.com/mellonis/turing-machine-js/issues/204) defines the `Snippet` schema (`version: 1`, `engine`, `graph`, `alphabets`, `tape`, `frames`). This doc consumes it directly — `Snippet`, `Frame`, and friends are imported from `@turing-machine-js/visuals`. No local mirror, no shim. Schema risk is upstream's problem; if the schema evolves past `version: 1`, machines-demo bumps its visuals dep and adapts.

### Snippet artifact pipeline: Vite plugin → virtual module

Snippet artifacts are generated at build time by a Vite plugin that:

1. Reads `src/lib/defaultCode.ts`'s `TURING_EXAMPLES` and `POST_EXAMPLES`.
2. For each example flagged with `showcase: true` (see "Curated examples" below): runs the example's code through a Node-side eval against `@turing-machine-js/machine` (with `@post-machine-js/machine` for the Post engine), uses `@turing-machine-js/visuals`'s `recordSnippet` to capture `frames`, and emits a `Snippet` keyed by `<engine>/<id>`.
3. Exposes the collected artifacts as a virtual module `virtual:snippets` resolving to `{ turing: Snippet[]; post: Snippet[] }`.

The landing page imports `virtual:snippets` and renders the snippets matching the current `?engine=` selection.

Why a Vite plugin and not runtime recording: recording requires the engine to be loaded and run with the user's example code. Running it on the visitor's browser duplicates the engine page's machinery (worker + eval sandbox) just to render a showcase that should be cheap. Build-time recording produces small JSON, no worker, no `new Function`.

Why a virtual module and not `public/snippets/<engine>/<id>.json` files: tighter integration with Vite's HMR (the plugin can invalidate the virtual module when `defaultCode.ts` changes), no extra HTTP requests, single-bundle delivery. JSON is small (< 10 KB per snippet for short programs).

### DEMO removal cascade (Phase 2)

The `'DEMO'` `ExecutionMode` variant touches more than the `$effect`:

- `MachineView.svelte:60-72` — `ExecutionMode` union loses `'DEMO'`; `executionMode` initial value becomes `'MANUAL'`; `demoEnabled` is deleted entirely.
- `MachineView.svelte:251, 259` — conditionals that include `'DEMO'` simplify (e.g., `executionMode === 'DEMO' || executionMode === 'MANUAL'` becomes `executionMode === 'MANUAL'`).
- `MachineView.svelte:540` — `if (userInitiated) demoEnabled = false` deleted.
- `MachineView.svelte:550, 591, 757` — `executionMode = userTookControl ? 'MANUAL' : 'DEMO'` becomes `executionMode = 'MANUAL'`; the `userTookControl` flag may itself become unnecessary, decide during implementation.
- `MachineView.svelte:883-886` — the "DEMO auto-take-control" branch deleted.
- `MachineView.svelte:991-1003` — the `startDemoLoop` `$effect` deleted.
- `MachineView.svelte:15` — `import { startDemoLoop } from '../lib/demoLoop.ts'` deleted.
- `ControlPanel.svelte:47-65` — `flashApply` and `reflect` exported methods deleted; `panelRef.reflect(...)`/`flashApply()` callsites in MachineView already deleted by the loop removal.
- `Toolbar.svelte:9` — `'DEMO'` removed from the `ExecutionMode` type alias mirrored here; comments referencing DEMO (`Toolbar.svelte:237, 240`) updated.
- `src/lib/demoLoop.ts` — deleted.

The DEMO branches must be removed by reasoning case-by-case — most simplify to MANUAL-only paths, but the per-step / Apply transitions deserve a careful read since several thread `userTookControl` through.

### Engine page boot priority

After Phase 2, the engine page no longer auto-runs. Initial loaded content priority on mount:

1. `?example=<id>` — bundled example by id; `findExample(engine, id)`; log error and fall through if unknown.
2. `?snippet=<id>` — user-saved snippet by id (existing flow).
3. localStorage `loadCode(engine)` + `loadExampleId(engine)` — last-edited code + last-loaded example id (existing).
4. `defaultExample(engine)` — the first entry of `examples(engine)`.

`executionMode = 'MANUAL'` at all times until the user clicks Step / Run / Continuous. No DEMO anywhere.

### Curated examples are a content sub-PR; Phase 1 ships placeholders

Three curated examples per engine are required, ordered simple → moderate → composed (last one showcases v7 callable-subtree visualization). Single-tape Post only (gated on [post-machine-js#98](https://github.com/mellonis/post-machine-js/issues/98)).

Selection criteria (codified here, content authored separately):
- **Simple:** ≤ 5 states, one tape, ≤ 30 steps to halt. Reads as one thought.
- **Moderate:** 1–2 states with branching; demonstrates `ifOtherSymbol` (Turing) or `check` (Post).
- **Composed:** Uses `withOverriddenHaltState` to compose a subroutine; renders a callable-subtree subgraph in the v7 mermaid emit. This is the one that justifies the redesign — showing what the engine is *for*.

Each curated example carries a `showcase: true` field in its `Example` declaration (`defaultCode.ts`), an `intervalMs?: number` for playback cadence override, and a `description: string` for the panel caption. The `Example` type gets these three optional fields.

**Phase 1 ships with one placeholder showcase example per engine** — the existing `TURING_REPLACE_B` and the simplest Post example flagged with `showcase: true` + a temporary caption. Just enough to exercise the Vite plugin end-to-end (one Turing, one Post; both code paths covered). Naming the actual three (their state graphs, programs, captions) is content work and lands as a follow-up sub-PR, where the placeholders are replaced and two more added per engine.

## File map

### Phase 1 — Landing route + SnippetPanel + recordSnippet pipeline

| File | Change | Roughly |
|---|---|---|
| `package.json` | **Modify** — add `@turing-machine-js/visuals` dependency (npm `next` tag for the current alpha lockstep). | +1 line |
| `src/lib/types.ts` | **Modify** — add `Route` discriminated union. `Snippet`/`Frame` types come from `@turing-machine-js/visuals` and are re-exported here if convenient (else imported at call sites). | +10 lines |
| `src/App.svelte` | **Modify** — replace `activeEngine: Engine` with `route: Route`; update `readEngineFromUrl` → `readRouteFromUrl` returning the discriminated union; normalise unknown paths to `/` (not `/turing`); update `selectEngine` → `selectRoute`; render `<Landing>` or `<MachineView engine={…}>` based on `route.kind`; header tabs always `pushState('/' + engine)` and render with no active state on landing. Legacy `?machine=` rewrite preserved. | ~60 lines touched |
| `src/components/Landing.svelte` | **Create** — header (title slot, no engine tabs since they live in App's chrome), inline engine switcher reading `?engine=` from URL, snippet panels driven by `virtual:snippets[engine]`. | ~150 lines |
| `src/components/SnippetPanel.svelte` | **Create** — props: `snippet: Snippet`. Renders caption, `<MachineGraph readOnly graph={snippet.graph}>`, `<TapesStack readOnly tapeCount={snippet.tape.tapes.length}>`, "Open in editor" CTA. IntersectionObserver auto-play with `prefers-reduced-motion` opt-out; "Replay" / "Play" button. Frame advancement via `setInterval(snippet.intervalMs ?? 800)`. | ~200 lines |
| `src/components/MachineGraph.svelte` | **Modify** — add `readOnly?: boolean` prop (default `false`); gate breakpoint click handlers and collapse toggle on `!readOnly`. | ~15 lines touched |
| `src/components/TapesStack.svelte` | **Modify** — add `readOnly?: boolean` prop (default `false`); gate caret edit affordance and copy-paste UI on `!readOnly`. | ~15 lines touched |
| `src/lib/defaultCode.ts` | **Modify** — extend `Example` type with `showcase?: boolean`, `intervalMs?: number`, `description?: string`. Flag one Turing and one Post existing example as `showcase: true` (placeholders for the content sub-PR). | ~15 lines touched |
| `src/vite-plugins/snippets.ts` | **Create** — Vite plugin: resolves `virtual:snippets`; on load, iterates `examples(engine).filter(e => e.showcase)` for each engine, evals each example's code in a Node VM with `@turing-machine-js/machine` / `@post-machine-js/machine` in scope, calls `recordSnippet` from `@turing-machine-js/visuals`, returns `{ turing, post }` as a JS module. HMR: invalidate the virtual module on `defaultCode.ts` change. | ~120 lines |
| `vite.config.ts` | **Modify** — register the snippets plugin. | +3 lines |
| `src/components/SnippetPanel.test.ts` | **Create** — see Test plan. | ~100 lines |
| `src/App.routing.test.ts` | **Create** — route-table unit tests (pure functions extracted from App.svelte). | ~80 lines |
| `src/vite-plugins/snippets.test.ts` | **Create** — node-env unit tests for the plugin. | ~80 lines |

### Phase 2 — Retire DEMO

| File | Change | Roughly |
|---|---|---|
| `src/components/MachineView.svelte` | **Modify** — see "DEMO removal cascade" above. Remove `'DEMO'` from `ExecutionMode` union, delete `demoEnabled`, delete the demo `$effect`, delete the `startDemoLoop` import, simplify DEMO-touching branches, change initial `executionMode` to `'MANUAL'`, change boot to priority order `?example > ?snippet > localStorage > first bundled`. | ~80 lines touched, ~30 lines deleted |
| `src/components/ControlPanel.svelte` | **Modify** — delete exported `reflect(commands)` and `flashApply()` methods; delete `FLASH_DURATION_MS` if no other consumer; delete the per-tape `reflectedCommands` `$state` if it served only the demo loop. | ~25 lines deleted |
| `src/components/Toolbar.svelte` | **Modify** — remove `'DEMO'` from the local `ExecutionMode` type alias mirror; update mode-label comments (`Toolbar.svelte:237, 240`). | ~10 lines touched |
| `src/lib/demoLoop.ts` | **Delete** — entire file. | -55 lines |
| `src/lib/types.ts` | **Modify** — remove `'DEMO'` from `ExecutionMode` union if it lives here too. | ~3 lines touched |
| `src/components/MachineView.test.ts` (or scenario tests) | **Modify** — delete any DEMO-mode scenarios; verify boot priority for `?example=` / `?snippet=` / localStorage / default. | ~30 lines touched |

### Content sub-PR — three curated examples per engine

| File | Change | Roughly |
|---|---|---|
| `src/lib/defaultCode.ts` | **Modify** — replace Phase 1's two placeholder showcase examples with three properly curated per engine (simple / moderate / composed). Each gets `description` and (if needed) `intervalMs`. | ~200 lines added (content) |

## Test plan

### Phase 1

**`src/components/SnippetPanel.test.ts`** (component test, jsdom):

| ID | What it verifies |
|---|---|
| `S-snippet-panel-renders-caption` | Snippet's `name` and `description` appear in the rendered output. |
| `S-snippet-panel-static-on-mount` | Before IntersectionObserver fires, panel renders frame 0; nothing animates. |
| `S-snippet-panel-autoplay-on-intersect` | Mock IntersectionObserver entry with `isIntersecting: true` triggers playback; after `frames.length * intervalMs + epsilon`, panel sits on the final frame. |
| `S-snippet-panel-freeze-at-halt` | After playback ends, no further `setInterval` ticks fire (verify via `vi.useFakeTimers()` + advancing 10s with zero new calls to the apply-frame callback). |
| `S-snippet-panel-replay-resets` | Clicking Replay sets the visible frame back to 0 and re-runs playback to the end. |
| `S-snippet-panel-reduced-motion` | With `window.matchMedia('(prefers-reduced-motion: reduce)').matches === true`, panel renders the *last* frame on mount; "Play" button replaces "Replay"; auto-play does NOT fire on intersect. |
| `S-snippet-panel-deep-link` | "Open in editor" link's `href` is `/<snippet.engine>?example=<snippet.id>`. |

**`src/App.routing.test.ts`** (pure function tests, node):

| ID | What it verifies |
|---|---|
| `R-route-landing-from-root` | `readRouteFromUrl('/')` → `{ kind: 'landing' }`. |
| `R-route-landing-from-unknown` | `readRouteFromUrl('/foo')` → `{ kind: 'landing' }`. |
| `R-route-engine-turing` | `readRouteFromUrl('/turing')` → `{ kind: 'engine', engine: 'turing' }`. |
| `R-route-engine-post` | `readRouteFromUrl('/post')` → `{ kind: 'engine', engine: 'post' }`. |
| `R-route-landing-engine-query` | `readEngineFromLandingQuery('?engine=post')` → `'post'`; default `'turing'`. |
| `R-route-legacy-machine-rewrite` | `legacyMachineRewrite('/?machine=post')` → URL with `pathname='/post'` and `?machine` stripped. |

**`src/vite-plugins/snippets.test.ts`** (node):

| ID | What it verifies |
|---|---|
| `V-plugin-emits-virtual-module` | Calling the plugin against an in-test `examples()` shim resolves `virtual:snippets` to `{ turing: Snippet[]; post: Snippet[] }`. |
| `V-plugin-snippet-shape` | Each emitted snippet conforms to `@turing-machine-js/visuals`'s `Snippet` schema. |
| `V-plugin-only-showcase` | Examples without `showcase: true` are NOT included in the emitted output. |
| `V-plugin-error-on-runtime-throw` | An example whose code throws is reported with a clear error pointing to the example's id; build fails. |

**E2E (`e2e/landing.spec.ts`)**:

| Scenario | What it verifies |
|---|---|
| Landing renders | Navigate to `/`, snippet panels present in the DOM (one per engine in Phase 1, three per engine after the content sub-PR), captions visible. |
| Scroll triggers play | Scroll a panel into view, after `intervalMs * frames.length` the panel's graph highlight matches the halt state. |
| Engine switch | Click landing's "Post snippets" → URL becomes `/?engine=post`, Post panels render. |
| Deep link to editor | Click a panel's "Open in editor" → URL becomes `/turing?example=<id>`, MachineView shows the corresponding example loaded. |
| Header tabs navigate | On `/`, click header "Turing" tab → URL becomes `/turing`, MachineView visible. |

### Phase 2

**`src/components/MachineView.test.ts`** modifications:

| ID | What it verifies |
|---|---|
| `M-boot-no-demo` | After mount with no URL params and empty localStorage, `executionMode === 'MANUAL'` and the program is the first bundled example, paused at iter 0; no tape animation. |
| `M-boot-example-query` | Mount with `?example=<id>` loads that example; `executionMode === 'MANUAL'`. |
| `M-boot-example-unknown` | Mount with `?example=does-not-exist` logs an error and falls through to localStorage / default. |
| `M-boot-priority-example-over-snippet` | Mount with both `?example=a` and `?snippet=b`; example wins. |
| `M-boot-priority-snippet-over-localstorage` | Mount with `?snippet=a` and localStorage set; URL snippet wins. |
| `M-boot-priority-localstorage-over-default` | Mount with localStorage set, no URL params; localStorage wins. |
| `M-execution-mode-union` | TypeScript: `ExecutionMode` no longer accepts `'DEMO'` (compile error if test source asserts it). |

Existing DEMO scenarios in `scenarioRunner.test.ts` / `machineRunner.test.ts` deleted; any test that drove the worker through DEMO transitions is replaced by MANUAL equivalents.

**E2E**: existing E2E that asserts initial-load tape animation must be deleted / rewritten — the engine pages no longer animate on load.

### Content sub-PR

No new test scaffolding. The Phase 1 `Landing renders` E2E gets a per-snippet assertion update (three panels per engine, not one). The Vite plugin's `V-plugin-*` tests don't change — they're agnostic to how many examples carry `showcase: true`.

## Out of scope

- **Interactive snippet editing on `/`.** Visitors who want to author click "Open in editor". Inline editing duplicates the engine page's machinery on a page that's meant to be lightweight.
- **Multi-tape Post snippets.** Gated on [post-machine-js#98](https://github.com/mellonis/post-machine-js/issues/98). The content sub-PR's curated Post examples are single-tape; revisit when #98 lands.
- **Article-style longer-form snippets** (`/snippets/<id>` page family). Separate feature; the artifact shape is shared but the page family is its own design.
- **Snippet authoring UI** (recording from inside the demo, downloading the JSON). Recording is build-time only; if a user wants to author a snippet they edit `defaultCode.ts` and let the Vite plugin record it.
- **Snippet versioning beyond `version: 1`.** The upstream schema may evolve; this doc consumes `version: 1` and defers schema-version policy to `@turing-machine-js/visuals`.
- **Pause / scrub / step controls on landing.** Auto-play + Replay only. "Open in editor" gives the full debugger.
- **Mobile layout polish.** Phase 1 should render acceptably on mobile (panels stack, switcher works), but multi-tape Turing snippets on narrow viewports may need a layout pass — tracked as a follow-up if needed.
- **Carrying the snippet's playback position into the editor.** Considered: when the visitor clicks "Open in editor" mid-playback (or after halt), deep-link could include `?step=K` and the engine page would advance to that step on load. Rejected — passive playback isn't the same as authored steps; pre-advancing the program contradicts the "fresh authoring session" expectation of "Open in editor," and the implementation adds a non-trivial load path (fast-forward via `run({maxSteps})` vs replaying K Steps, mirror catch-up, mid-load worker errors). If visitor feedback later asks for visual continuity, a cheaper middle-ground is to carry the clicked-frame index purely as a state-graph highlight on load (no execution advance) — defer until asked.

## Open questions

- **`@turing-machine-js/visuals` package name.** Per #204's open questions, name could be `visuals`, `highlight`, or `graph-visuals`. The file map uses `visuals`; update if upstream picks differently.
- **Default `intervalMs` for snippet playback.** Spec uses `800` ms as the default with per-snippet override. Could feel slow for simple snippets and fast for composed; revisit after curated examples are authored — may move from a global default to a per-engine default or a per-snippet required field.
- **`?engine=` on landing or hash fragment.** Bookmarkability argues for `?engine=`. SEO neutrality argues for hash. The spec picks `?engine=` since the landing has no per-snippet SEO target; reconsider if landing later grows per-snippet routes.
- **Reduced-motion fallback fidelity.** Showing the halt frame is informative for completed runs, but the simplest snippets (a 3-step program) don't gain much insight from the halt frame alone. Consider a "show first → fade → show last" two-frame static composition for very short snippets; defer until visitor feedback warrants it.

## Provenance

Brainstormed 2026-05-27. Drafted 2026-05-30 as a three-phase plan with a handwritten-fixture intermediate. Revised same day to two phases + content sub-PR after deciding to do [turing-machine-js#204](https://github.com/mellonis/turing-machine-js/issues/204) first on the engine's `v7` branch (visuals lockstep-publishes with the next engine v7 alpha; engine v7 alpha.6 is already feature-complete on npm `next`, so this work doesn't wait on engine v7 stable). Reordering removes the fixture intermediate and the local `Snippet`/`Frame` type mirror — Phase 1 consumes the real visuals package directly.
