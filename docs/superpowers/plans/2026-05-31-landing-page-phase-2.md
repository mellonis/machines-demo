# Landing page Phase 2 — DEMO retirement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the random-command DEMO loop entirely. Engine pages (`/turing`, `/post`) become single-purpose authoring views booted to a static loaded program (`?example=<id>` > `?snippet=<id>` > localStorage > first bundled example). The landing page (`/`) is the answer to "where did the demo animation go."

**Architecture:** Two-step refactor. First add the 4-tier `?example=<id>` boot priority alongside existing DEMO behavior (additive, no breakage). Then strip DEMO entirely — change `executionMode` initial to `'MANUAL'`, delete the demo `$effect`, simplify `userTookControl ? 'MANUAL' : 'DEMO'` ternaries, delete `demoLoop.ts`, `'DEMO'` from `ExecutionMode` union (types + Toolbar mirror), `ControlPanel.reflect()` + `flashApply()` exports.

**Tech Stack:** Vite + Svelte 5 (runes) + TypeScript. No new dependencies. Tests: Vitest (jsdom + node) + Playwright (E2E).

**Spec source:** [`docs/superpowers/specs/2026-05-27-landing-page-design.md`](../specs/2026-05-27-landing-page-design.md) — read the "DEMO removal cascade (Phase 2)" + "Engine page boot priority" sections in particular.

---

## Risk audit (read before starting)

- **`MachineView.svelte` is 1360 LOC** and the DEMO ternaries are scattered (~10 distinct call sites). Subagents should re-grep on every dispatch — line numbers have shifted since the spec was written (2026-05-27).
- **`userTookControl` flag** — spec says "may itself become unnecessary, decide during implementation." Once `executionMode` initial is `'MANUAL'` and there's no DEMO state to escape from, every `executionMode = userTookControl ? 'MANUAL' : 'DEMO'` simplifies to `executionMode = 'MANUAL'`, making `userTookControl` write-only. Verify by removing reads after the simplification and check svelte-check + tests.
- **`reflectToActivePanel` / `reflectNeutral`** — these helpers exist mostly for DEMO loop coordination. After DEMO is gone, audit whether non-DEMO callers (Apply, Step transitions) still need them. If only neutral resets remain, the helper may collapse to inline code.
- **Engine page tests today assume DEMO is the initial state.** Several `MachineView.test.ts` scenarios drive worker through DEMO → MANUAL transitions. These need rewriting around MANUAL-only paths. Some may simply delete (DEMO-specific scenarios have no MANUAL equivalent).
- **E2E `cold-start.spec.ts` has 4 scenarios** (per CLAUDE.md) that may assert tape animation on initial load. Rewrite to a static-load shape: load → expect cells visible → expect no animation/step events.

---

## File map

### Source files

| File | Change | Roughly |
|---|---|---|
| `src/components/MachineView.svelte` | **Modify** — Task 1 adds `?example=` to the initial-state computation; Task 2 changes `executionMode` initial to `'MANUAL'`, deletes the demo loop `$effect`, deletes `demoEnabled` `$state`, simplifies all `userTookControl ? 'MANUAL' : 'DEMO'` ternaries; deletes `startDemoLoop` import + `reflectToActivePanel` if write-only after the rip; deletes DEMO auto-take-control branch around line ~886. | ~120 lines touched, ~50 lines deleted |
| `src/components/ControlPanel.svelte` | **Modify** — delete exported `reflect(commands)` and `flashApply()` methods; delete `FLASH_DURATION_MS` if no other consumer; delete the per-tape `reflectedCommands` `$state` if it served only the demo loop. | ~25 lines deleted |
| `src/components/Toolbar.svelte` | **Modify** — remove `'DEMO'` from the locally-mirrored `ExecutionMode` type alias; update mode-label comments (the existing CLAUDE.md mentions `Toolbar.svelte:237, 240` — re-grep at implementation time). | ~10 lines touched |
| `src/lib/types.ts` | **Modify** — remove `'DEMO'` from `ExecutionMode` union (re-grep to confirm it's defined here vs MachineView-local). | ~3 lines touched |
| `src/lib/demoLoop.ts` | **Delete** — entire file. | -50 lines |

### Test files

| File | Change | Roughly |
|---|---|---|
| `src/components/MachineView.test.ts` (or scenario tests) | **Modify** — delete DEMO-mode scenarios; add the 7 `M-boot-*` tests (see Test plan below). | ~80 lines touched |
| `src/lib/machineRunner.test.ts` / `scenarioRunner.test.ts` | **Modify** — any test driving worker through DEMO transitions is replaced with MANUAL equivalents. Some scenarios may simply delete. | ~30 lines touched |
| `e2e/cold-start.spec.ts` | **Modify or rewrite** — current 4 scenarios likely assert tape animation on initial load; replace with static-load assertions. | ~50 lines touched |

---

## Task ordering rationale

Two phases of work:
- **Phase A (additive)** — implement the new `?example=<id>` URL handling alongside existing DEMO behavior so the demo keeps running. Boot priority tests land here. Low risk; can ship independently if needed.
- **Phase B (subtractive)** — rip out DEMO. Type union + `demoLoop.ts` removal happen last so intermediate states stay compilable.

Tasks 1-2 are Phase A. Tasks 3-6 are Phase B.

---

### Task 1: Engine-page boot priority — implement `?example=<id>` handling

**Goal:** Add `?example=<id>` as the highest-priority initial-state source, ahead of `?snippet=` and localStorage. Existing DEMO behavior continues to run (Task 2 removes it).

**Files:**
- Modify: `src/components/MachineView.svelte`
- Modify: `src/components/MachineView.test.ts` (or create — confirm at implementation time)

- [ ] **Step 1: Read the current boot logic**

`MachineView.svelte` lines ~163-188 own the initial-state computation. Key points:
- `engineExamples = examples(engine)` — all bundled examples for this engine.
- `initialExample` = `findExample(engine, loadExampleId(engine))` || `defaultExample(engine)`.
- `initial.{loadedSnippetId, code, badUrlId}` derived from `?snippet=` query param, with fallback to `loadCode(engine) ?? initialExample.code`.

- [ ] **Step 2: Extend `initial` to handle `?example=<id>`**

Add a parallel branch: `?example=<id>` wins over `?snippet=<id>` (which wins over localStorage which wins over the first bundled example). Unknown `?example=` should log an error via `log.report('example not found: ${id}', 'error')` and fall through to the `?snippet=` branch.

Sketch (adapt to the actual current shape — re-read first):

```ts
const initial = untrack(() => {
  const url = new URL(window.location.href);
  const exampleId = url.searchParams.get('example');
  const snippetId = url.searchParams.get('snippet');

  // Highest priority: ?example=<id>
  if (exampleId !== null && exampleId !== '') {
    const ex = findExample(engine, exampleId);
    if (ex !== undefined) {
      return {
        loadedSnippetId: null as string | null,
        code: ex.code,
        selectedExampleId: ex.id,
        badUrlId: null as string | null,
        badExampleId: null as string | null,
      };
    }
    // Unknown example id — fall through, but flag for log on mount.
    return fallbackToSnippetOrLocal({ badExampleId: exampleId });
  }

  // Second: ?snippet=<id> (existing behavior)
  return fallbackToSnippetOrLocal({ badExampleId: null });

  function fallbackToSnippetOrLocal(extra: { badExampleId: string | null }) {
    if (snippetId !== null && snippetId !== '' && snippetId in initialSnippets) {
      return {
        loadedSnippetId: snippetId,
        code: initialSnippets[snippetId].code,
        selectedExampleId: initialExample.id,
        badUrlId: null as string | null,
        ...extra,
      };
    }
    return {
      loadedSnippetId: null as string | null,
      code: loadCode(engine) ?? initialExample.code,
      selectedExampleId: initialExample.id,
      badUrlId: snippetId !== null && snippetId !== '' ? snippetId : null,
      ...extra,
    };
  }
});
```

- [ ] **Step 3: Emit `log.report` for unknown example ids on mount**

The existing flow logs `snippet not found: <uuid>` once for `badUrlId`. Add the analogous `example not found: <id>` for `badExampleId`. Re-grep for the existing pattern and mirror it.

- [ ] **Step 4: Strip `?example=` from URL on first state change**

Existing `?snippet=` lifecycle strips the param when the user changes loaded content (matches MachineView.svelte ~line 980-985). Extend the same `$effect` (or add a sibling) to strip `?example=` too.

- [ ] **Step 5: Add boot-priority tests**

In `MachineView.test.ts` (re-confirm filename), add the 7 `M-boot-*` tests from the spec:

- `M-boot-example-query` — Mount with `?example=<id>` loads that example; `executionMode` is whatever it currently is (Task 1 doesn't change initial to MANUAL — that's Task 2).
- `M-boot-example-unknown` — Mount with `?example=does-not-exist` logs an error and falls through to localStorage / default.
- `M-boot-priority-example-over-snippet` — Mount with both `?example=a` and `?snippet=b`; example wins.
- `M-boot-priority-snippet-over-localstorage` — Mount with `?snippet=a` and localStorage set; URL snippet wins.
- `M-boot-priority-localstorage-over-default` — Mount with localStorage set, no URL params; localStorage wins.
- (Defer `M-boot-no-demo` and `M-execution-mode-union` to Task 5 — those assert DEMO is gone.)

- [ ] **Step 6: Run `npm run check` + `npm test`**

Expected: all existing tests still pass (DEMO still runs); 5 new boot-priority tests pass.

- [ ] **Step 7: Commit**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add src/components/MachineView.svelte src/components/MachineView.test.ts
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "feat(machine-view): boot priority — ?example=<id> > ?snippet=<id> > localStorage > default"
```

---

### Task 2: Strip DEMO from MachineView

**Goal:** Change `executionMode` initial to `'MANUAL'`. Delete the demo loop `$effect`, `demoEnabled` `$state`, the DEMO auto-take-control branch, and the `startDemoLoop` import. Simplify `userTookControl ? 'MANUAL' : 'DEMO'` ternaries to `'MANUAL'`.

**Files:**
- Modify: `src/components/MachineView.svelte`

- [ ] **Step 1: Audit current DEMO references**

```bash
grep -n "DEMO\|demoLoop\|demoEnabled\|startDemoLoop\|userTookControl" /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo/src/components/MachineView.svelte
```

Expected (line numbers may have shifted since spec):
- Initial: `executionMode = $state<ExecutionMode>('DEMO')` (line ~71)
- `demoEnabled = $state(true)` (line ~73)
- Conditionals: `executionMode === 'DEMO' || executionMode === 'MANUAL'` (~lines 252, 260)
- `if (userInitiated) demoEnabled = false` (~line 540)
- Ternaries: `executionMode = userTookControl ? 'MANUAL' : 'DEMO'` (~lines 551, 592, 758)
- `if (executionMode === 'DEMO') { demoEnabled = false; userTookControl = true; }` (~line 886, the "DEMO auto-take-control")
- `$effect` for `startDemoLoop` (~lines 992-1003)
- `import { startDemoLoop }` (~line 17)

Build a list of edits before making any.

- [ ] **Step 2: Change initial executionMode**

```ts
let executionMode = $state<ExecutionMode>('MANUAL');
```

- [ ] **Step 3: Delete `demoEnabled` `$state` and all readers/writers**

Search for `demoEnabled` — should drop to zero occurrences after this step.

- [ ] **Step 4: Delete the demo loop `$effect`**

The block around line ~992-1003 (`$effect(() => { if (executionMode !== 'DEMO' || !demoEnabled) return; return startDemoLoop({ ... }); })`) gets removed entirely.

- [ ] **Step 5: Simplify ternaries**

Replace every `userTookControl ? 'MANUAL' : 'DEMO'` with `'MANUAL'`. Then check whether `userTookControl` has any remaining readers; if not, delete the `$state` and its writers.

- [ ] **Step 6: Delete the DEMO auto-take-control branch**

The `if (executionMode === 'DEMO') { demoEnabled = false; userTookControl = true; }` block (~line 886) loses its predicate — if `userTookControl` is gone, the whole branch is dead; if it survives, simplify to `userTookControl = true;`.

- [ ] **Step 7: Simplify conditionals that included `'DEMO'`**

`executionMode === 'DEMO' || executionMode === 'MANUAL'` becomes `executionMode === 'MANUAL'`. Re-grep all callsites to be sure.

- [ ] **Step 8: Delete the `startDemoLoop` import**

Once the `$effect` is gone, the import is unused; svelte-check will flag.

- [ ] **Step 9: Audit `reflectToActivePanel` and `reflectNeutral`**

These helpers may have been DEMO-loop-coordinators. Re-grep callers after the loop is gone; if they're only called from neutral-reset paths, inline / simplify.

- [ ] **Step 10: Run `npm run check` + `npm test` + `npm run build`**

Expected: check clean. Some existing DEMO tests will fail — Task 5 rewrites them. For now, mark the failing DEMO-mode tests with `.skip` if needed to keep the test runner green while Task 5 lands. Or, if the failures are minimal, let them fail and note in the commit message.

- [ ] **Step 11: Commit**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add src/components/MachineView.svelte
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "refactor(machine-view): rip DEMO mode — engine pages boot to MANUAL"
```

---

### Task 3: Delete `ControlPanel.reflect()` + `flashApply()` exports

**Files:**
- Modify: `src/components/ControlPanel.svelte`

- [ ] **Step 1: Find the exports**

Search for `export function reflect`, `export function flashApply`, `FLASH_DURATION_MS`, and any `reflectedCommands` `$state` in `ControlPanel.svelte`.

- [ ] **Step 2: Delete the exports**

After Task 2 removed the callers in MachineView, these exports are dead. Delete:
- `reflect(commands)` function + its export
- `flashApply()` function + its export
- `FLASH_DURATION_MS` constant if no other consumer references it
- `reflectedCommands` `$state` if it served only `reflect`/`flashApply`

- [ ] **Step 3: Run `npm run check` + `npm test`**

Expected: clean. If anything else (Toolbar? Tape?) imported `FLASH_DURATION_MS`, decide whether to keep it or move it.

- [ ] **Step 4: Commit**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add src/components/ControlPanel.svelte
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "refactor(control-panel): delete reflect/flashApply exports (DEMO-only callers gone)"
```

---

### Task 4: Type union cleanup + `demoLoop.ts` deletion

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/components/Toolbar.svelte`
- Delete: `src/lib/demoLoop.ts`

- [ ] **Step 1: Locate `ExecutionMode` definitions**

```bash
grep -rn "ExecutionMode" /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo/src/
```

Expected: one canonical definition in `MachineView.svelte` or `types.ts`, plus a mirror in `Toolbar.svelte`. The spec mentions `Toolbar.svelte:9` mirrors the type — verify at implementation time.

- [ ] **Step 2: Remove `'DEMO'` from the union(s)**

Where `'DEMO'` appears in the `ExecutionMode` string-literal union, delete the entry. Use TypeScript to find the canonical home (svelte-check will flag mismatches).

- [ ] **Step 3: Update Toolbar comments**

Spec mentions `Toolbar.svelte:237, 240` had comments referencing DEMO mode behavior. Update or delete those comments to reflect MANUAL-only behavior.

- [ ] **Step 4: Delete `src/lib/demoLoop.ts`**

```bash
rm /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo/src/lib/demoLoop.ts
```

- [ ] **Step 5: Run `npm run check` + `npm test`**

Expected: clean. svelte-check would have already flagged any remaining `'DEMO'` references (TS narrowing fails at every callsite).

- [ ] **Step 6: Commit**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add src/lib/types.ts src/components/Toolbar.svelte
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo rm src/lib/demoLoop.ts
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "refactor(types): drop 'DEMO' from ExecutionMode + delete demoLoop.ts"
```

---

### Task 5: Test rewrites — `M-boot-*` series

**Files:**
- Modify: `src/components/MachineView.test.ts` (or scenario tests — re-confirm)
- Modify: `src/lib/machineRunner.test.ts` / `scenarioRunner.test.ts` (any DEMO-driver tests)

- [ ] **Step 1: Audit existing tests**

```bash
grep -rn "DEMO\|demoEnabled\|demoLoop" /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo/src/ /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo/tests/ 2>/dev/null
```

After Task 4 should return zero src/ hits. Any test hits are tests asserting on DEMO state — these get rewritten or deleted.

- [ ] **Step 2: Delete DEMO-driver scenarios**

Tests that drive the worker through DEMO transitions (random commands, demoEnabled flips) have no MANUAL equivalent — delete them.

- [ ] **Step 3: Add the remaining `M-boot-*` tests**

These weren't in Task 1 because they assert DEMO is gone. Add now:

- `M-boot-no-demo` — After mount with no URL params and empty localStorage: `executionMode === 'MANUAL'`, program is the first bundled example, paused at iter 0, no tape animation fires.
- `M-execution-mode-union` — TypeScript: `ExecutionMode` no longer accepts `'DEMO'`. Use `// @ts-expect-error` on an attempted `'DEMO'` assignment.

```ts
it('M-boot-no-demo', async () => {
  // mount with empty URL + empty localStorage
  // assert: executionMode === 'MANUAL', editor code === defaultExample(engine).code
});

it('M-execution-mode-union', () => {
  // @ts-expect-error — DEMO no longer in the union
  const _bad: ExecutionMode = 'DEMO';
  expect(true).toBe(true);
});
```

- [ ] **Step 4: Run `npm test`**

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add src/
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "test: rewrite DEMO scenarios as MANUAL-only + add M-boot-no-demo / M-execution-mode-union"
```

---

### Task 6: E2E — rewrite `cold-start.spec.ts` for static boot

**Files:**
- Modify: `e2e/cold-start.spec.ts`

- [ ] **Step 1: Read current E2E**

```bash
cat /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo/e2e/cold-start.spec.ts
```

Four scenarios per CLAUDE.md. Identify those that assert initial-load tape animation.

- [ ] **Step 2: Rewrite or delete animation-asserting scenarios**

Replace `expect tape cell at position N changes within 2s of load` style assertions with `expect cells visible immediately + no change after 2s`. Pure-static boot: load the page, see the first frame, no movement until user clicks Step/Run.

- [ ] **Step 3: Add `?example=<id>` E2E scenario**

```ts
test('E-boot-example-query', async ({ page }) => {
  await page.goto('/turing?example=toggle-bits');
  // wait for MachineView to mount + load the example
  await expect(page.locator('[data-testid="tape-cell"]').first()).toBeVisible();
  // Editor shows the toggle-bits source
  // (use the actual selector convention from cold-start.spec.ts)
});
```

- [ ] **Step 4: Run `npm run test:e2e`**

Expected: all E2E scenarios pass (including the landing-page Phase 1 ones).

- [ ] **Step 5: Commit**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add e2e/cold-start.spec.ts
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "test(e2e): rewrite cold-start for static boot + add ?example= deep-link scenario"
```

---

## Wrap-up

After Task 6:

- [ ] Open PR against master with the full series of Phase-2 commits
- [ ] PR description summarizes the DEMO retirement, the new boot priority, and links to the spec
- [ ] Once merged, queue an alpha bump (1.0.0-alpha.20 → 1.0.0-alpha.21) as a separate chore PR (same shape as alpha.19 / alpha.20)
- [ ] After alpha.21 ships, machines-demo#79 is fully closed

## Out of scope

- Anything in the spec's "Out of scope" section (mobile polish, snippet authoring UI, multi-tape Post snippets, etc.)
- The `?step=K` mid-playback deep-link from snippet panels (spec rejected; revisit if visitor feedback asks)
