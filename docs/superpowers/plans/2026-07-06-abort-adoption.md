# Abort adoption (v7.1 deps): aborted-outcome rendering + abort examples + completions token model

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt `@turing-machine-js/machine` / `@turing-machine-js/visuals` / `@post-machine-js/machine` v7.1 (abort feature) via npm-linked prerelease builds, rendering the aborted outcome distinctly with bundled abort showcases (issue #122) and moving `stop`/`abort` to value tokens in the completions schema (issue #124), in one PR.

**Architecture:** The worker captures the engine's new `RunResult` from the `'halt'`/`'abort'` DebugSession events (its `start()` still resolves `void`) and from the step-generator's return value, and forwards `outcome` + final-state name + backtrace over the existing `ran`/`stepped` wire messages. The UI keeps the 5-mode `ExecutionMode` — HALTED gains an outcome flavor via a new `'abort'` log kind, an abort-accented status mirror, and a terminal graph highlight on the abort node. The Mermaid id scheme migration (`uN`/`s0`/`s1`/`s0-F`) is folded in because visuals 7.1 keys all `HighlightOps` through the engine's `mermaidIdFor`. Completions retype `stop` to the existing `kind: 'symbol'` (the `ifOtherSymbol` precedent) and add `abort`/`abortState`.

**Tech Stack:** Vite + Svelte 5 (runes) + TS, Vitest, Playwright, CodeMirror 6, Mermaid + ELK.

## Global Constraints

- Deps are **npm-linked prerelease builds** of `turing-machine-js@feat/239-abort-state` and `post-machine-js@feat/112-abort-command` (both report version `7.0.0` until their release PRs bump). **Do not edit or rebuild the two library repos while linked** (one-writer rule).
- `package.json` dep ranges move to `^7.1.0` at the end; the lockfile can only refresh after the libraries publish — **demo CI stays red until then** (post-machine-js#116 precedent). Note this in the PR body.
- No forge issue numbers in source comments or test titles (host-agnostic rule). Plan/PR text may link freely.
- `ExecutionMode` stays the 5-mode union — aborted is an outcome flavor of HALTED, not a sixth mode (per issue #122).
- No demo version bump in this PR (release PRs are separate).
- **No `git commit` without the user's explicit go-ahead** — implement, verify, stop with the tree dirty. Natural commit boundaries are marked per task.

## New upstream API surface (verified against the linked builds)

- Engine: `abortState` (id **−1**; odd negatives = sentinels; halt markers moved to **even** negatives `−2·frameId`), `RunResult = { outcome: 'halted'|'aborted'; state: State; stack: readonly State[]; step: number }`, `DebugSessionEvent` adds `'abort'`; `'halt'`/`'abort'` listeners receive the `RunResult`; `start(): Promise<void>` unchanged. `runStepByStep` generator **returns** the `RunResult`. `GraphNode.isAbort`; `mermaidIdFor(id)`/`parseMermaidId(s)` exported (`uN` user, `s0` halt, `s1` abort, `s0-F` frame halt markers); abort emits `s1(((abort)))` + `classDef abortSentinel` (dashed red).
- visuals: `applyHighlight` calls every `HighlightOps` callback with **mermaid-form string keys** (`u3`, `s0`, `s1`, `w_2`) built via `mermaidIdFor`; `toId: -1` lights `s1` (regression-locked upstream). `bareIdOf` still folds **all** negatives to `0` — demo callers must branch on `-1` **before** folding.
- post: `stop`/`abort` are `unique symbol` tokens (`typeof === 'symbol'`; calling throws native TypeError); `abort` legal in groups; `pm.run()`/`runStepByStep()` return/yield the engine `RunResult`; `PostDebugSession` adds `'abort'` (payload `RunResult`); `abortState`/`haltState`/`RunResult` re-exported from the package root; abort's producer is a NAMED per-instruction state, so `RunResult.state.name` is the instruction path (`'50'`, `'sub::3'`).

---

### Task 1: Wire protocol — terminal outcome across the worker boundary

**Files:**
- Modify: `src/lib/types.ts` (RanResponse ~121-140, SteppedResponse)
- Modify: `src/lib/machineWorker.ts` (SessionLike ~184-192, session wiring ~565-634, `ran` assembly ~719-729, step/build generator handling ~332, ~363)
- Test: `src/lib/machineRunner.test.ts` (protocol-shape group)

**Interfaces (produces):**
- `RanResponse` gains `outcome: 'halted' | 'aborted'`, `finalStateName: string | null`, `backtrace: string[]` (empty for halted; turing = `RunResult.stack` names innermost-first; post = final iter's `arrivalPath` segments).
- `SteppedResponse` gains `outcome: 'halted' | 'aborted' | null` (null while not halted).

**Steps:**
- [ ] Extend the two response types in `types.ts` with the fields above (doc-comment: backtrace source differs per engine).
- [ ] `machineWorker.ts`:
  - `SessionLike.on` event union gains `'abort'`; add an overloaded listener shape `(r: { outcome: 'halted'|'aborted'; state: { name?: string }; stack: readonly { name?: string }[]; step: number }) => void` for `'halt' | 'abort'` (structural, like the rest of `SessionLike`).
  - In `runToEnd`: `let runResult: <that shape> | null = null;` register `ses.on('halt', (r) => { runResult = r; })` and `ses.on('abort', (r) => { runResult = r; })` next to the existing listeners. For post, also track `lastArrivalPath: string[] | null` from each `'iter'` yield's `m.arrivalPath` (post wraps yields; turing yields have no such field — guard with `Array.isArray`).
  - After `await ses.start()`: derive `outcome = runResult?.outcome ?? 'halted'`, `finalStateName = runResult ? resolveDisplayName(runResult.state) : null`, `backtrace` = post ? `lastArrivalPath ?? []` : `runResult.stack.map(resolveDisplayName)`. Thread through `phase` and into the `ran` payload.
  - In `step()`: when `r.done`, `r.value` is the RunResult — store its `outcome` on the phase and emit it on `stepped`.
- [ ] Update `machineRunner.test.ts` protocol-shape fixtures (FakeWorker `ran`/`stepped` payloads) to carry the new fields; add spec `R-run-aborted-passthrough` asserting an `outcome: 'aborted'` `ran` resolves with the fields intact.
- [ ] Run: `npx vitest run src/lib/machineRunner.test.ts` → PASS; `npm run check` → 0 errors.
- [ ] ⏸ commit boundary: `feat(worker): forward terminal RunResult outcome over the wire`

### Task 2: UI — distinct ABORTED presentation

**Files:**
- Modify: `src/lib/log.ts` (LogKind, line 3), `src/components/Log.svelte` (kind stripes ~42-45, ~99-122)
- Modify: `src/components/MachineView.svelte` (run/step completion logging ~639-657, ~812-831; status mirror ~1162-1171)
- Modify: `src/lib/graphHighlightDerivation.ts` (+ its test)
- Modify: `src/app.css` (abort tokens)
- Test: `src/components/Toolbar.test.ts` untouched; new specs in `graphHighlightDerivation` test file and `logStore.test.ts` only if kinds are enumerated there.

**Interfaces (produces):** `LogKind` adds `'abort'`; `deriveGraphHighlight` args gain `terminalOutcome: 'halted' | 'aborted' | null`; MachineView keeps a `terminalOutcome` `$state` set from `ran`/`stepped`.

**Steps:**
- [ ] `log.ts`: `LogKind = 'error' | 'warn' | 'ok' | 'pause' | 'abort'`. `Log.svelte`: `class:abort` stripe + head tint using new tokens (red family, dashed-consistent with the graph's abort sentinel); `MachineView.svelte` status mirror gains `class:abort={latestEntry?.kind === 'abort'}`.
- [ ] `app.css`: add `--log-abort` accent + `--graph-node-abort-stroke` (dark `#f87171` / light `#dc2626` family, dashed border comes from the engine emit shape) alongside the existing halt tokens; status `.status.abort` rule.
- [ ] `MachineView.svelte`: store `terminalOutcome` from the `ran`/`stepped` responses; completion logging becomes outcome-aware:
  - halted (unchanged): `halted after N step(s)` kind `'ok'`.
  - aborted: `aborted at '<finalStateName>' after N step(s)` kind `'abort'`, followed by one log line per backtrace frame (`  ↳ <frame>`), kind `'abort'`.
- [ ] `graphHighlightDerivation.ts`: extend the exported args with `terminalOutcome`; when mode is HALTED and outcome is `'aborted'`, return a highlight with `toId: -1`, `strong: 'to'` (raw — visuals maps −1 → `s1`). Add specs `G-derive-aborted-terminal` / `G-derive-halted-unchanged` in its test file.
- [ ] Run: `npx vitest run src/lib/graphHighlightDerivation.test.ts src/lib/logStore.test.ts` → PASS; `npm run check`.
- [ ] ⏸ commit boundary: `feat(ui): abort log kind, status accent, terminal abort highlight`

### Task 3: Mermaid id-scheme migration (deps-bump fallout)

**Files:**
- Modify: `src/components/MachineGraph.svelte` (nodeCache regex :730 + key derivation :733-737, ops adapter key handling, `stripEngineStyling`, abort node CSS)
- Modify: `src/lib/imminentHalt.ts` (+ test)
- Modify: `src/lib/breakpointCoordination.ts` :112 (+ test)
- Modify: `src/components/MachineView.svelte` :527 (negative-id folding), worker `toggleBreakpoint` handling for id −1
- Modify: `src/components/ExecutionTraceTable.svelte` :26/:33 (+ test)

**Steps:**
- [ ] `MachineGraph.svelte`: nodeCache regex → `/-flowchart-(u\d+|s\d+|s0-\d+|idle)-/`; key derivation via `parseMermaidId` (import from `@turing-machine-js/machine`), gated by the regex; keep `w_N` → clusterCache-by-label path. Reconcile the `HighlightOps` adapter with visuals 7.1 mermaid-form keys (nodeCache may key directly on the mermaid token string — pick whichever removes translation layers). Verify edge selectors `[data-id="L_${from}_${to}_${ix}"]` against the real 7.1 emit in the dev server (keys are now `u1`/`s0`/`s1`).
- [ ] `stripEngineStyling`: also strip the engine's `classDef abortSentinel` / `class … abortSentinel` line only if the demo takes palette ownership — otherwise keep the engine class and theme it via CSS variables (`g.node.abortSentinel`, dashed red stroke from `--graph-node-abort-stroke`). Prefer keeping the engine class + demo CSS (matches the tag_ handling pattern).
- [ ] `imminentHalt.ts`: frame halt markers are now `−2·frameId` (update `haltMarkerId`); `nextRefId === -1` → imminent-abort treated as `{ kind: 'real' }` terminal (no marker). Update its test fixtures.
- [ ] Negative-id folding sweep — `-1` is abort, **even** negatives are halt markers: `breakpointCoordination.ts:112` → `id === -1 ? -1 : id < 0 ? 0 : bareIdOf(id, graph)`; same branch at `MachineView.svelte:527`; worker `toggleBreakpoint`/`scanCanonicalBreakpoints` mirror the existing haltState boolean-BP special case for `abortState` (stateId −1 → `abortState.debug` boolean).
- [ ] `ExecutionTraceTable.svelte`: `if (id === null || id === 0) return 'halt'; if (id === -1) return 'abort';` + test fixture with an abort-terminal transition (`T-trace-abort-goto`).
- [ ] Run: `npm test` → all pass; then `npm run dev` and manually verify on `/turing` with `callable-subtree`: Build → graph renders, breakpoint dots toggle, Run-with-pause highlights nodes/edges (this exercises the new id plumbing end-to-end — unit tests mock mermaid).
- [ ] ⏸ commit boundary: `fix(graph): migrate to the v7.1 mermaid id scheme (uN/s0/s1/s0-F)`

### Task 4: Snippet pipeline forward-compat

**Files:**
- Modify: `src/vite-plugins/snippets.ts` :118-128

**Steps:**
- [ ] Rewrite the `runStepByStep` wrapper to forward the generator's return value: `const result = yield* originalRunStepByStep(args); return result;` (keeps `rawStateIds` capture per-yield). Map `m.nextState` → id: keep `haltSentinel → 0`; abort needs no special case (`abortState.id === -1` flows through) — assert that in `snippets.test.ts` once the abort showcases exist (Task 5).
- [ ] Run: `npm run build` → snippet plugin records all showcases without error.

### Task 5: Bundled abort examples (showcased) + lessonNotes

**Files:**
- Modify: `src/lib/defaultCode.ts`
- Test: `src/lib/snippets.test.ts` (structural), `src/components/ExecutionTraceTable.test.ts` (Task 3), Playwright smoke optional

**Turing example `abort-validate`** (showcase, after `callable-subtree`):

```js
// Task: validate that the tape holds only bits (0/1), scanning from inside
// a called subroutine; ABORT the whole run on the first unexpected symbol.
// Contrast with 'callable-subtree': a halt INSIDE the call returns to the
// caller's continuation, but abort punches straight through every pending
// call frame and terminates the run — the continuation is never reached.

const {
  Alphabet, State, Tape, TapeBlock, TuringMachine,
  haltState, abortState, ifOtherSymbol, movements,
} = imports;

const alphabet = new Alphabet([' ', '0', '1', 'x']);
const tape = new Tape({ alphabet, symbols: ['1', '0', 'x', '1'] });
const tapeBlock = TapeBlock.fromTapes([tape]);
const machine = new TuringMachine({ tapeBlock });
const { symbol } = tapeBlock;

// Subroutine: walk right over bits; RETURN (in-call halt) at the first
// blank; ABORT on anything else.
const scanBits = new State({
  [symbol(['0'])]: { command: [{ movement: movements.right }] },
  [symbol(['1'])]: { command: [{ movement: movements.right }] },
  [symbol([alphabet.blankSymbol])]: {
    command: [{ movement: movements.stay }],
    nextState: haltState,
  },
  [ifOtherSymbol]: {
    command: [{ movement: movements.stay }],
    nextState: abortState,
  },
}, 'scanBits');

// Continuation: only reached when the scan returns cleanly — with this
// tape (it contains an 'x') it never runs.
const accept = new State({
  [ifOtherSymbol]: {
    command: [{ movement: movements.stay }],
    nextState: haltState,
  },
}, 'accept');

const initialState = scanBits.withOverriddenHaltState(accept);

return { machine, initialState };
```

**Post example `abort-guard`** (showcase, after `call-subroutine`):

```js
// Task: expect a mark under the head, three times, stepping right between
// checks. The guard subroutine RETURNS ('stop') on a mark and ABORTS the
// entire run ('abort') on a blank. The third check lands on a blank.
// 'stop' inside a subroutine means return-to-caller (classical halt);
// 'abort' has no continuation — it terminates the run from any depth.

const { PostMachine, Tape, abort, call, right, check, stop } = imports;

const machine = new PostMachine({
  expectMark: {
    1: check(2, 3),  // marked? return; blank? abort the whole run
    2: stop,         // return to caller's continuation
    3: abort,        // abnormal termination — punches through the call
  },
  10: call('expectMark'),
  20: right,
  30: call('expectMark'),
  40: right,
  50: call('expectMark'),
  60: stop,          // never reached with this tape
}, { blankSymbol: '␣', markSymbol: '•' });

machine.replaceTapeWith(new Tape({
  alphabet: machine.tape.alphabet,
  symbols: ['•', '•', '␣'],
}));

return { machine };
```

**Steps:**
- [ ] Validate both drafts run and abort against the linked builds with a scratch node script (`node --input-type=module` importing the linked packages, eval the example body with `imports` bound, run to completion, assert `outcome === 'aborted'`). Fix drafts as needed.
- [ ] Add both `Example` entries with `showcase: true`, terse `description` (Turing: `Validate bits from a subroutine; abort punches through the call on 'x'.` / Post: `Guard subroutine: stop = return, abort = kill the whole run.`), and `lessonNotes` covering: what the program computes, halt-vs-abort (return-to-caller vs punch-through), why abort is the only out-of-band error channel on a 2-symbol machine (post), and what to look for on the graph (dashed-red `abort` node, the arc into it from inside the cluster, the never-reached continuation).
- [ ] Update the "Available imports" comment blocks in the two new examples to include `abortState` (turing) / `abort` (post).
- [ ] Run: `npm run build` (snippet recorder processes 4+4 showcases); `npm test`; `npm run dev` → landing shows the new panels, playback ends on the abort node highlight; engine pages boot both examples via `?example=abort-validate` / `?example=abort-guard`, Run logs the abort line + backtrace.
- [ ] ⏸ commit boundary: `feat(examples): abort showcases for both engines`

### Task 6: Completions — stop/abort as value tokens (#124)

**Files:**
- Modify: `src/lib/completions/schema/post.ts` :17, `schema/turing.ts` (~:10)
- Modify: `src/lib/completions/lint/argCount.ts` :69-84 (+ test :99-236)
- Modify: `src/lib/completions/schema/engine.test.ts` :49-54, `schema/types.test.ts` :58
- Test: `src/lib/completions/contexts/namespaceIdentifier` specs if they enumerate post entries

**Steps:**
- [ ] Schema: `stop: { kind: 'symbol', detail: 'halt token — end current scope (return inside a subroutine)' }`; add `abort: { kind: 'symbol', detail: 'abort token — terminate the entire run from any depth' }`; add `abortState: { kind: 'singleton', type: { kind: 'class', name: 'State' }, detail: 'global abort singleton' }` to BOTH schemas (post re-exports it; turing exports it natively).
- [ ] `argCount.ts` `bareOnlyDiagnostic`: also fire when `entry.kind === 'symbol'` (message text unchanged: `X has no callable form (use bare \`X\` instead)`). Existing `S-lint-stop-*` specs must stay green; add `S-lint-abort-with-parens`.
- [ ] Drift guard (`engine.test.ts`): keep schema⊆runtime name check; ADD a callable-vs-value assertion per entry — kinds `function`/`class`/`post-instruction` ⇒ `typeof === 'function'`; `symbol` ⇒ `typeof === 'symbol'`; `singleton`/`constants` ⇒ `typeof === 'object'`. Add explicit specs `S-schema-stop-is-symbol` / `S-schema-abort-is-symbol` so the retype is locked. (Reverse runtime⊆schema stays out — the advanced-export surface would need an allowlist; the typeof check closes the actual #124 gap.)
- [ ] `types.test.ts:58` required-name list: add `abort`, `abortState`.
- [ ] Run: `npx vitest run src/lib/completions` → PASS (incl. previously-false-clean drift guard now genuinely asserting).
- [ ] ⏸ commit boundary: `feat(completions): stop/abort value tokens, abortState, typeof drift guard`

### Task 7: Gates, deps bump, PR

**Steps:**
- [ ] Full gates against the linked builds: `npm run check` && `npm run lint` && `npm test` && `npm run build` && `npm run test:e2e`.
- [ ] Docs sweep: `CLAUDE.md` (worker contract table: `ran`/`stepped` new fields; log kinds; examples list) + `docs/execution-model.md` (HALTED outcome flavor) + `README.md` component notes if they enumerate examples.
- [ ] Bump `package.json` ranges to `^7.1.0` ×3. Do NOT touch the lockfile yet — CI red until the libraries publish; after publish, `npm install` in this branch refreshes the lockfile and CI greens (note in PR body).
- [ ] PR: `feat: adopt v7.1 abort — distinct aborted outcome, abort showcases, stop/abort value tokens`; body cites #122/#124, the two upstream PRs, and the CI-red-until-publish note. No Claude attribution.

## Self-review notes

- Issue #122 scope 1 (status mirror, log + backtrace, graph terminal highlight on `s1`) → Tasks 1-3. Scope 2 (examples + lessonNotes) → Task 5. Deps/id-scheme prerequisite → Task 3/4. Issue #124 → Task 6.
- Abort breakpoints (context-menu on `s1`) are handled minimally in Task 3 by mirroring the haltState boolean special case — not in #122's scope but required so the new node doesn't wire wrongly.
- Types used across tasks: `outcome`/`finalStateName`/`backtrace` (Task 1) consumed by Task 2; `terminalOutcome` arg (Task 2) internal to MachineView + derivation; `-1` sentinel convention shared by Tasks 2/3/4/5.
