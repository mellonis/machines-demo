# machines-demo: consume `@turing-machine-js/visuals` — Cleanup Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans or superpowers:subagent-driven-development. Steps use `- [ ]` checkbox syntax.

**Goal:** Drop the local copies of modules that were extracted into `@turing-machine-js/visuals` (extraction via [turing-machine-js#220](https://github.com/mellonis/turing-machine-js/pull/220) shipping `7.0.0-alpha.6`; formatter primitives via [turing-machine-js#221](https://github.com/mellonis/turing-machine-js/pull/221) shipping `7.0.0-alpha.6.1`). Rewire every import site to consume from the published package. Step 2 of [turing-machine-js#204](https://github.com/mellonis/turing-machine-js/issues/204).

**Architecture:** No behavior change. visuals was extracted byte-for-byte and re-tested in its new home; the demo's runtime behavior must remain identical. The only diffs are "where these symbols come from" and "demo's `format.ts` shrinks to LogEntry-assembly-only." Verification is `npm run check && npm test && npm run test:e2e` clean + a manual browser smoke test of graph highlight / breakpoint cues / log step rendering.

**Tech Stack:** Vite + Svelte 5 + TypeScript. Standard repo commands (`npm run dev`, `npm run check`, `npm test`, `npm run lint`, `npm run test:e2e`).

**Branch:** `chore/204-step2-consume-visuals` (off `master`).

**Coverage floor:** Whatever the demo currently hits. Deletions drop the moved `*.test.ts` files from the demo's vitest set; the per-file ratio of remaining demo code should stay at parity or improve. No new tests.

---

## Decisions (locked)

- **Bump visuals dep to `^7.0.0-alpha.6.1`.** Adds the formatter primitives this cleanup needs (`formatStepNotation`, `formatTape`, `tokenizeStep`, `StepCommand`). One-line edit in `package.json` + `npm install` to resync the lockfile.
- **`graphHighlightDerivation.ts` STAYS in machines-demo.** Its `ExecutionMode` union (`'DEMO' | 'MANUAL' | 'RUNNING_AUTO' | …`) mirrors MachineView's state machine — orchestration, not engine semantics. Only its `bareIdOf` import path changes (`./graphUtils` → `@turing-machine-js/visuals`).
- **`graphFixtures.test.ts` + fixture JSONs DELETED.** Engine emit drift detection is now visuals's responsibility (`packages/visuals/src/graphUtils.spec.ts` + `applyHighlight.spec.ts` use the same 4 fixtures against the same engine). Demo's test was a duplicate signal coupled to demo-`examples` + post-machine peer dep; deleting drops the duplicated-fixtures sync burden too.
- **`TuringGraph` local alias DROPPED.** Demo's `src/lib/types.ts` re-exports `Graph as TuringGraph` from the engine. Cleaner to use `Graph` directly at call sites (matches visuals' convention). One-line edit per import site.
- **`GraphHighlight` and `TapeSnapshot` import directly from visuals at every site — NO re-export indirection.** Drop both local type definitions from `types.ts`. Rewrite every import site (~3 for GraphHighlight, ~10 for TapeSnapshot) to import from `@turing-machine-js/visuals`. Earlier draft proposed re-exports via `types.ts` to avoid the churn; user pushed back on cleanliness — direct imports it is.
- **`format.ts` shrinks to LogEntry-assembly-only.** Drop the local `formatStepNotation` internal helper and the exported `formatTape` function — both now live in visuals. `commandsEntry` / `tapesEntry` (LogEntry assemblers) stay in demo and call visuals's primitives via `formatStepNotation(...)` / `formatTape(...)`. `CommandsApplication` type stays in demo. The local `alphabetRest` helper stays (LogEntry-specific).
- **Rules doc `docs/graph-highlight-and-breakpoints.md` DELETED.** Now lives at `@turing-machine-js/visuals/docs/graph-highlight-and-breakpoints.md`. If CLAUDE.md or any other doc cross-links to the local path, redirect to the visuals package's GitHub URL.
- **No version bump in this PR.** Pure refactor, no UX change. If you want a `release: 1.0.0-alpha.19` after merge, that's a separate decision (or fold a bump commit at the end if user requests).

---

## File Structure

```
machines-demo/
├── package.json                    # MODIFY — bump visuals dep ^7.0.0-alpha.6 → ^7.0.0-alpha.6.1
├── package-lock.json               # MODIFY — npm install --package-lock-only resync
├── src/
│   ├── components/
│   │   ├── MachineGraph.svelte     # MODIFY — local-lib imports → @turing-machine-js/visuals
│   │   └── MachineView.svelte      # MODIFY — same
│   └── lib/
│       ├── highlightOps.ts                 # DELETE
│       ├── graphUtils.ts                   # DELETE
│       ├── graphUtils.test.ts              # DELETE
│       ├── graphIndexes.ts                 # DELETE
│       ├── applyHighlight.ts               # DELETE
│       ├── applyHighlight.test.ts          # DELETE
│       ├── graphFixtures.test.ts           # DELETE (engine drift now visuals's responsibility)
│       ├── graphHighlightDerivation.ts     # MODIFY — bareIdOf import + drop TuringGraph alias
│       ├── format.ts                       # MODIFY — drop local formatStepNotation + formatTape;
│       │                                              wire commandsEntry/tapesEntry to visuals
│       ├── types.ts                        # MODIFY — drop TuringGraph alias + local GraphHighlight + local TapeSnapshot
│       └── (other files importing GraphHighlight / TapeSnapshot — rewire imports per Task 6)
├── tests/fixtures/graphs/*.json    # DELETE (consumed only by graphFixtures.test.ts)
├── docs/
│   └── graph-highlight-and-breakpoints.md  # DELETE
└── CLAUDE.md                       # MODIFY — drop deleted-file rows; note highlight surface consumed from visuals
```

Import sites that switch from local to `@turing-machine-js/visuals` (from grep):
- Highlight surface (`highlightOps`/`graphUtils`/`graphIndexes`/`applyHighlight` → visuals): `src/components/MachineGraph.svelte`, `src/components/MachineView.svelte`, `src/lib/graphHighlightDerivation.ts`
- `GraphHighlight` from `./types`: `src/components/MachineGraph.svelte`, `src/components/MachineView.svelte`, `src/lib/graphHighlightDerivation.ts`, `src/lib/applyHighlight.ts` (deleted), `src/lib/graphHighlightDerivation.ts`
- `TapeSnapshot` from `./types`: `src/lib/format.ts`, `src/lib/imminentHalt.ts`, `src/lib/scenarioRunner.ts`, `src/lib/tapeSnapshot.ts`, `src/lib/tapeSnapshot.test.ts`, `src/lib/workerHelpers.ts`, `src/components/MachineGraph.svelte`, `src/components/MachineView.svelte`, plus any deletion targets
- `formatStepNotation` / `formatTape` (was demo-local, now visuals): only consumers were `commandsEntry`/`tapesEntry` in `src/lib/format.ts` (formatStepNotation was internal, formatTape was used by `tapesEntry` AND possibly other sites — grep before editing)

---

## Task 1: Bump visuals dep to `^7.0.0-alpha.6.1`

**Files:** `package.json`, `package-lock.json`

- [ ] **Step 1: Edit `package.json`**

Change the `@turing-machine-js/visuals` dep from `^7.0.0-alpha.6` to `^7.0.0-alpha.6.1`.

- [ ] **Step 2: Resync lockfile**

```sh
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo install
```

(Plain `npm install` — not `--package-lock-only` — so the actual visuals tarball downloads into `node_modules`. Required for the subsequent tasks' typecheck to resolve `formatStepNotation` etc.)

- [ ] **Step 3: Verify**

```sh
ls node_modules/@turing-machine-js/visuals/dist/format.d.ts
grep -E "formatStepNotation|tokenizeStep|formatTape|StepCommand" node_modules/@turing-machine-js/visuals/dist/index.d.ts
```

Expected: all symbols visible.

- [ ] **Step 4: Commit**

```sh
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add package.json package-lock.json
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "chore(demo): bump @turing-machine-js/visuals dep to ^7.0.0-alpha.6.1"
```

---

## Task 2: Rewire `MachineGraph.svelte` imports

**Files:** `src/components/MachineGraph.svelte`

- [ ] **Step 1: Read the file**

Find every import from `'../lib/highlightOps'`, `'../lib/graphUtils'`, `'../lib/graphIndexes'`, `'../lib/applyHighlight'`. Also note imports of `GraphHighlight` / `TapeSnapshot` / `TuringGraph` from `'../lib/types'`.

- [ ] **Step 2: Replace imports**

- Local-lib imports (highlight surface) → consolidated into one `import { … } from '@turing-machine-js/visuals'` line.
- `GraphHighlight` from `'../lib/types'` → from `'@turing-machine-js/visuals'`.
- `TapeSnapshot` from `'../lib/types'` (if present) → from `'@turing-machine-js/visuals'`.
- `TuringGraph` use-sites → rename to `Graph`; add `import type { Graph } from '@turing-machine-js/machine'` if not already present.

- [ ] **Step 3: Verify**

```sh
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run check
```

Errors about modules not-yet-deleted (other Task targets) are OK; flag them but don't fix here.

- [ ] **Step 4: Commit**

```sh
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add src/components/MachineGraph.svelte
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "refactor(demo): MachineGraph imports highlight surface + GraphHighlight from @turing-machine-js/visuals"
```

---

## Task 3: Rewire `MachineView.svelte` imports

**Files:** `src/components/MachineView.svelte`

Same shape as Task 2 — local-lib highlight imports → visuals; `GraphHighlight`/`TapeSnapshot`/`TuringGraph` references treated identically.

- [ ] Steps 1-3 mirror Task 2.
- [ ] **Step 4: Commit**

```sh
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add src/components/MachineView.svelte
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "refactor(demo): MachineView imports highlight surface + GraphHighlight from @turing-machine-js/visuals"
```

---

## Task 4: Rewire `graphHighlightDerivation.ts`

**Files:** `src/lib/graphHighlightDerivation.ts`

- [ ] **Step 1: Replace imports**

Current:
```ts
import { bareIdOf } from './graphUtils.ts';
import type { GraphHighlight, TuringGraph } from './types.ts';
```

Replace with:
```ts
import { bareIdOf, type GraphHighlight } from '@turing-machine-js/visuals';
import type { Graph } from '@turing-machine-js/machine';
```

Rename every `TuringGraph` use-site → `Graph` (function signatures + the `function fromCanon` overloads).

- [ ] **Step 2: Verify + commit**

```sh
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run check
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add src/lib/graphHighlightDerivation.ts
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "refactor(demo): graphHighlightDerivation imports bareIdOf + GraphHighlight from @turing-machine-js/visuals"
```

---

## Task 5: Migrate `format.ts` to visuals primitives

**Files:** `src/lib/format.ts`

- [ ] **Step 1: Read the current file end-to-end**

Map every internal usage of `formatStepNotation(...)` (the private helper called by `commandsEntry` and the multi-tape branch) and every external import of `formatTape`. Also note `TapeSnapshot` import.

- [ ] **Step 2: Edit `format.ts`**

- DELETE the local `function formatStepNotation(...) { ... }` definition (~40 lines).
- DELETE the local `export function formatTape(tape) { ... }` definition.
- ADD imports from visuals:
  ```ts
  import {
    formatStepNotation,
    formatTape,
    type StepCommand,
  } from '@turing-machine-js/visuals';
  ```
- Replace internal `formatStepNotation(...)` callsites in `commandsEntry` with `formatStepNotation(...)` from visuals — signature is identical (`reads, commands, blanks, matchKinds`), so no callsite changes needed.
- The `Command` type from `'./types'` (demo's plain `{ movement: 'L'|'R'|'S'; symbol: string | null }`) is structurally compatible with visuals's `StepCommand`. If TypeScript complains about variance/widening at the call boundary, either:
  - Cast at the call site: `formatStepNotation(reads, commands as readonly StepCommand[], blanks, matchKinds)`, OR
  - Type the local `Command` as `import type { StepCommand as Command } from '@turing-machine-js/visuals'` re-export inside `types.ts` (cleaner — drop the local Command definition).
- The `TapeSnapshot` import switches to visuals: `import type { TapeSnapshot } from '@turing-machine-js/visuals'`.
- `alphabetRest`, `tapesEntry`, `commandsEntry`, `CommandsApplication` — STAY as-is. Only the formatting primitives migrate.

After this task, `format.ts` should be roughly half its current size — only LogEntry assembly + `alphabetRest` helper.

- [ ] **Step 3: Verify**

```sh
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run check
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo test
```

`format.ts` had no spec file in the demo (per the lib directory listing); no test count change expected from this task alone.

- [ ] **Step 4: Commit**

```sh
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add src/lib/format.ts
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "refactor(demo): format.ts uses visuals' formatStepNotation + formatTape; LogEntry assembly stays local"
```

---

## Task 6: Drop local type defs + rewire every `GraphHighlight` / `TapeSnapshot` import site

**Files:** `src/lib/types.ts` + every site listed above

- [ ] **Step 1: Edit `types.ts`**

- DELETE the `import type { Graph as TuringGraph } from '@turing-machine-js/machine'` line.
- DELETE the `export type { TuringGraph }` line.
- DELETE the local `export type GraphHighlight = { ... }` block (with JSDoc).
- DELETE the local `export type TapeSnapshot = { ... }` block.

Other types (`Engine`, `Movement`, `Command`, `Alphabets`, `WorkerRequest`, `BreakpointKind`, *Response unions) stay.

- [ ] **Step 2: Rewire every importing site**

Run the grep:
```sh
grep -rn "import .*{.*\(GraphHighlight\|TapeSnapshot\|TuringGraph\).*}.*from .*['\"]\./types['\"]\|import .*{.*\(GraphHighlight\|TapeSnapshot\|TuringGraph\).*}.*from .*['\"]\.\./lib/types['\"]\|import .*{.*\(GraphHighlight\|TapeSnapshot\|TuringGraph\).*}.*from .*['\"]\.\./types['\"]" /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo/src 2>/dev/null
```

For every match, rewrite the import:
- `GraphHighlight` → import from `@turing-machine-js/visuals`
- `TapeSnapshot` → import from `@turing-machine-js/visuals`
- `TuringGraph` → import `Graph` from `@turing-machine-js/machine` and rename use-sites

A site may have a mixed import (e.g., `import type { Command, TapeSnapshot } from './types'`); split into two import lines — one staying for `Command`, one new for visuals.

Files likely affected (verify with grep):
- `src/lib/format.ts` — already touched in Task 5, but the `TapeSnapshot` import there should now point at visuals.
- `src/lib/imminentHalt.ts`
- `src/lib/scenarioRunner.ts`
- `src/lib/tapeSnapshot.ts`
- `src/lib/tapeSnapshot.test.ts`
- `src/lib/workerHelpers.ts`
- `src/components/MachineGraph.svelte` (already touched in Task 2 — verify the import is right)
- `src/components/MachineView.svelte` (already touched in Task 3 — verify the import is right)

- [ ] **Step 3: Verify**

```sh
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run check
```

Any remaining `Cannot find name 'TuringGraph'` is a leftover from Tasks 2-5; fix the site directly (rename to `Graph`), NOT by reintroducing the alias.

- [ ] **Step 4: Commit**

```sh
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add -A
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "refactor(demo): import GraphHighlight + TapeSnapshot directly from @turing-machine-js/visuals; drop TuringGraph alias"
```

(`git add -A` because this task touches many files; if there's anything unexpected in `git status` flag it.)

---

## Task 7: Delete the moved files + graphFixtures + its fixtures

**Files:**
- DELETE: `src/lib/highlightOps.ts`
- DELETE: `src/lib/graphUtils.ts`
- DELETE: `src/lib/graphUtils.test.ts`
- DELETE: `src/lib/graphIndexes.ts`
- DELETE: `src/lib/applyHighlight.ts`
- DELETE: `src/lib/applyHighlight.test.ts`
- DELETE: `src/lib/graphFixtures.test.ts`
- DELETE: `tests/fixtures/graphs/*.json` (all 4)

- [ ] **Step 1: Confirm no remaining import sites**

```sh
grep -rn "from '\./highlightOps\|from '\.\./lib/highlightOps\|from '\./graphUtils\|from '\.\./lib/graphUtils\|from '\./graphIndexes\|from '\.\./lib/graphIndexes\|from '\./applyHighlight\|from '\.\./lib/applyHighlight\|from '\.\./../tests/fixtures" /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo/src 2>/dev/null
```

Expected: zero matches (except inside files about to be deleted, if cross-importing). Any other site → STOP and fix the leftover.

- [ ] **Step 2: Delete**

```sh
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo rm \
  src/lib/highlightOps.ts \
  src/lib/graphUtils.ts \
  src/lib/graphUtils.test.ts \
  src/lib/graphIndexes.ts \
  src/lib/applyHighlight.ts \
  src/lib/applyHighlight.test.ts \
  src/lib/graphFixtures.test.ts \
  tests/fixtures/graphs/turing-callable-subtree.json \
  tests/fixtures/graphs/turing-replace-b.json \
  tests/fixtures/graphs/turing-copy-two-tapes.json \
  tests/fixtures/graphs/post-walk-mark.json
```

If `tests/fixtures/graphs/` becomes empty, also `rmdir` it (and the parent `tests/fixtures/` and possibly `tests/` if empty — only if nothing else lives there).

- [ ] **Step 3: Verify**

```sh
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run check
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run lint
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo test
```

All three green. Vitest count drops by the moved + deleted test files' case counts.

- [ ] **Step 4: Commit**

```sh
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "refactor(demo): delete local copies of highlight surface + graphFixtures (now in @turing-machine-js/visuals)"
```

---

## Task 8: Delete the rules doc

**Files:** `docs/graph-highlight-and-breakpoints.md`

- [ ] **Step 1: Cross-reference check**

```sh
grep -rn "graph-highlight-and-breakpoints" /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo --exclude-dir=node_modules --exclude-dir=dist
```

If any other file references the local path, redirect to the GitHub URL: `https://github.com/mellonis/turing-machine-js/blob/v7/packages/visuals/docs/graph-highlight-and-breakpoints.md`. Include those edits in the same commit below.

- [ ] **Step 2: Delete + commit**

```sh
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo rm docs/graph-highlight-and-breakpoints.md
# If Step 1 found cross-refs that need updating, git add the updated files here.
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "docs(demo): drop local rules doc — now lives in @turing-machine-js/visuals"
```

---

## Task 9: Update `CLAUDE.md`

**Files:** `CLAUDE.md`

- [ ] **Step 1: Find affected rows**

```sh
grep -nE "highlightOps|graphUtils|graphIndexes|applyHighlight|graphFixtures|graph-highlight-and-breakpoints" /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo/CLAUDE.md
```

- [ ] **Step 2: Edit**

- Remove rows for deleted files: `applyHighlight.ts`, `applyHighlight.test.ts`, `graphIndexes.ts`, `graphUtils.ts`, `graphUtils.test.ts`, `highlightOps.ts`, `graphFixtures.test.ts`.
- Note: the highlight surface is consumed from `@turing-machine-js/visuals` (peer-dep-on-engine, lockstep with alpha.6+).
- Note: `format.ts` now only assembles LogEntry; per-step string formatting comes from visuals's `formatStepNotation` + `formatTape`.
- Redirect the rules-doc reference to the visuals package's GitHub URL (per Task 8).
- Remove any references to local `tests/fixtures/graphs/` (deleted in Task 7).

- [ ] **Step 3: Commit**

```sh
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add CLAUDE.md
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "docs(demo): note highlight + formatter surface now consumed from @turing-machine-js/visuals"
```

---

## Task 10: Smoke-test in browser

**Files:** none (manual verification).

- [ ] **Step 1: Boot dev server**

```sh
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run dev
```

- [ ] **Step 2: Exercise the affected paths**

In a browser at http://localhost:5173:
- Switch Turing ↔ Post tabs — graph renders cleanly on each Build.
- Step a few iters on a multi-tape example — `mg-highlight-from`/`mg-highlight-to`/`mg-highlight-strong` classes appear on the right nodes, edges light up, log line shows `[reads] → [writes]/[moves]` notation with wildcard `*='X'` markers where `ifOtherSymbol` fires.
- Set a breakpoint via graph click — indicator dot appears; Run until pause.
- Trigger a wrapper-pause (the Composed bundled example with `withOverriddenHaltState`) — wrapper canonicalization + frame-active highlight visible.
- Run continuous to halt — `mg-highlight-strong` lands on halt node; log shows final step in `K='X'` / `E` / `B` shortcuts where applicable.

The visual + log behavior MUST match pre-refactor exactly. If anything's off — a missing log entry, wrong highlight, broken animation — the extraction or the rewiring drifted.

- [ ] **Step 3: Stop dev server.**

---

## Task 11: Open PR

- [ ] **Step 1: Push**

```sh
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo push -u origin chore/204-step2-consume-visuals
```

- [ ] **Step 2: Open the PR**

```sh
gh pr create --repo mellonis/machines-demo --base master --head chore/204-step2-consume-visuals \
  --title "refactor: consume highlight + formatter surface from @turing-machine-js/visuals (#204 step 2)" \
  --body "$(cat <<'EOF'
## Summary

Step 2 of [turing-machine-js#204](https://github.com/mellonis/turing-machine-js/issues/204). Drops the local copies of the highlight/graph-indexing modules + formatter primitives that were extracted into \`@turing-machine-js/visuals\` ([PR #220](https://github.com/mellonis/turing-machine-js/pull/220) shipping alpha.6, [PR #221](https://github.com/mellonis/turing-machine-js/pull/221) shipping alpha.6.1) and rewires every import site to consume them from the published package.

Pure refactor: zero behavior change. The package was extracted byte-for-byte and re-tested in its new home; the demo's runtime should be visually identical.

## Changes

- **Bumped \`@turing-machine-js/visuals\` dep** \`^7.0.0-alpha.6\` → \`^7.0.0-alpha.6.1\` (formatter primitives).
- **Deleted local copies** — \`highlightOps.ts\`, \`graphUtils.ts\` + spec, \`graphIndexes.ts\`, \`applyHighlight.ts\` + spec, \`graphFixtures.test.ts\` (engine-emit drift detection now lives in visuals's specs).
- **Deleted \`tests/fixtures/graphs/*.json\`** — consumed only by \`graphFixtures.test.ts\`.
- **Rewired highlight imports** — \`MachineGraph.svelte\`, \`MachineView.svelte\`, \`graphHighlightDerivation.ts\` now import from \`@turing-machine-js/visuals\`.
- **\`format.ts\` migrated to visuals primitives** — dropped local \`formatStepNotation\` (was internal) and \`formatTape\` (was exported). \`commandsEntry\` / \`tapesEntry\` (LogEntry assembly) stay local and call \`visuals.formatStepNotation\` / \`visuals.formatTape\` instead.
- **Dropped \`TuringGraph\` alias** in \`types.ts\` — call sites use \`Graph\` from \`@turing-machine-js/machine\` directly.
- **Dropped local \`GraphHighlight\` + \`TapeSnapshot\` definitions** in \`types.ts\`. Every import site rewritten to import from \`@turing-machine-js/visuals\` directly (no re-export indirection).
- **Deleted rules doc** — \`docs/graph-highlight-and-breakpoints.md\` now lives in visuals.
- **\`CLAUDE.md\`** updated to reflect the new layout.

## Stays in machines-demo

- \`graphHighlightDerivation.ts\` — demo-coupled \`ExecutionMode\` union.
- \`format.ts\` LogEntry assembly (\`commandsEntry\`, \`tapesEntry\`, \`CommandsApplication\`, \`alphabetRest\`) — demo-specific.
- All other demo-specific lib + components.

## Test plan

- [x] \`npm run check\` — clean.
- [x] \`npm run lint\` — clean.
- [x] \`npm test\` — passes (test count drops by the moved + deleted \`*.test.ts\` files; remaining specs unchanged).
- [x] \`npm run test:e2e\` — clean.
- [x] Manual browser smoke (Task 10): graph highlight, breakpoint indicator, wrapper-pause canonicalization, frame-active, halt-strong, log step rendering with \`*='X'\` / \`K='X'\` / \`B\` / \`E\` shortcuts all visible and identical to pre-refactor behavior.
EOF
)"
```

- [ ] **Step 3: Capture PR URL + report.**

---

## Self-review checklist

- [ ] visuals dep at `^7.0.0-alpha.6.1` in `package.json`; `package-lock.json` resynced.
- [ ] Zero `grep` hits for `./highlightOps`, `./graphUtils`, `./graphIndexes`, `./applyHighlight` imports anywhere in `src/`.
- [ ] Zero `grep` hits for `TuringGraph` anywhere.
- [ ] Zero references to local `GraphHighlight` / `TapeSnapshot` definitions — every consumer imports from `@turing-machine-js/visuals`.
- [ ] `format.ts` has no local `formatStepNotation` and no local `formatTape` — both come from visuals. `tapesEntry` / `commandsEntry` / `CommandsApplication` / `alphabetRest` still local.
- [ ] All 8 deletion targets gone (`git ls-files` confirms).
- [ ] `CLAUDE.md` reflects new layout.
- [ ] All CI checks pass (`check`, `lint`, `vitest`, `playwright`).
- [ ] Browser smoke test confirms behavior parity.
- [ ] No Claude attribution footers in commits.
- [ ] No version bump (per Decisions — separate concern if user wants alpha.19 after).

---

## After this lands

1. **Optional release bump** — `release: 1.0.0-alpha.19` PR if you want a fresh tag for the cleanup. Per `feedback_machines_demo_gh_releases` memory: create a GH pre-release after merge.
2. **Landing page work unblocked** — [machines-demo#79](https://github.com/mellonis/machines-demo/issues/79) Phase 1 can begin. The visuals package's `recordSnippet` is what the Vite plugin in that work will call.
3. **DEMO retirement** — Phase 2 of the landing-page spec. Independent of step 1; can interleave.

---

## Out of scope

- **Migration of demo's `commandsEntry` / `tapesEntry`** to a visuals-side helper. LogEntry is demo's UI concern; visuals correctly stays renderer-agnostic. Future article-embed work might want a similar assembler in visuals, but design that against a concrete second consumer.
- **Adoption of visuals's `tokenizeStep`** for richer log rendering (e.g., per-cell HTML spans). Opportunistic — landing page snippet panels might use it; demo's plain-string log is fine as-is.
- **Default DOM applier** sub-export from visuals. No second consumer yet; YAGNI.
- **Engine v7 → master integration PR.** Separate step in turing-machine-js, unrelated to this cleanup.
