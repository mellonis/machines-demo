# Diagnostic Counters (#106) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show three small pill counters in the editor corner (`[E n] [W n] [I n]`) aggregating diagnostics across all lint sources (argCount + crossRef + unbound + syntaxLinter). Pills hide when their count is 0. Read-only in this PR — clicking does nothing (the future jump-to-next behavior is parked).

**Architecture:** A Svelte-runes class `DiagnosticsCounter` owns three `$state` counts (errors, warnings, info — info folds in `info` + `hint` severities). A small CodeMirror `ViewPlugin` calls `counter.update(view.state)` on every transaction; `forEachDiagnostic(state, fn)` walks the current diagnostics and tallies. A `<DiagnosticsCounter>` Svelte component reads the counts reactively and renders the pills. `Editor.svelte` instantiates the counter, passes the plugin to extensions, and overlays the component at the editor's **bottom-right corner** (avoids conflict with the top-right reset-code IconButton; line-number gutter on the left rules out top-left). CSS tokens `--diag-error` / `--diag-warning` / `--diag-info` defined in `app.css` so themes can override per palette.

**Tech Stack:** CodeMirror 6 (`@codemirror/lint`'s `forEachDiagnostic` + `setDiagnostics` for tests, `@codemirror/view`'s `ViewPlugin`), Svelte 5 runes (`$state` in a `.svelte.ts` class), Vitest with `happy-dom` env for the class test (Svelte runtime needs DOM globals).

**Scope decisions (locked):**

- **3 pills** (E / W / I). `info` + `hint` severities fold into the `I` pill since the demo's linters don't emit `hint` and probably never will.
- **Pills hide when count is 0** per the issue. The container is always rendered (so the layout reserve doesn't jump) but each pill has `display: none` when its count is 0.
- **Bottom-right overlay** per the conflict analysis: top-right is the reset-code IconButton; top-left collides with CodeMirror's line-number gutter. Bottom-right is free and visible.
- **No click behavior** in this PR. The future jump-to-next-of-severity is the parked Phase-2 idea from the issue.
- **Counter is per-editor-instance.** Created in `Editor.svelte`, lifetime = component lifetime. Engine swaps remount the editor (existing `{#key engine}` pattern at the App level), so the counter resets cleanly.
- **No E2E test in this PR.** The issue mentions one as a possibility; unit-testing the counter class is enough to lock the counting logic. Manual smoke covers the wire-up.

---

## Pre-execution step

Post a one-paragraph comment on [#106](https://github.com/mellonis/machines-demo/issues/106) confirming Phase 1 (read-only counters) is starting on `feat/106-diagnostic-counters`. Click-to-jump is explicitly out of scope.

---

## File Structure

**New files:**
- `src/lib/diagnosticsCounter.svelte.ts` — `class DiagnosticsCounter` (with `$state` counts + `update(state)` method) + `function diagnosticsCounterPlugin(counter): Extension` (ViewPlugin wrapper).
- `src/lib/diagnosticsCounter.test.ts` — class unit tests (happy-dom env).
- `src/components/DiagnosticsCounter.svelte` — pills UI.

**Modified files:**
- `src/app.css` — add `--diag-error` / `--diag-warning` / `--diag-info` tokens for both `:root` (dark default) and `:root[data-theme='light']` overrides.
- `src/components/Editor.svelte` — instantiate counter, add plugin to extensions, render `<DiagnosticsCounter />` overlay.
- `CLAUDE.md` (machines-demo) — extend the `lib/` tree + the Editor section prose.

---

### Task 1: `DiagnosticsCounter` class + unit tests

**Files:**
- Create: `src/lib/diagnosticsCounter.svelte.ts`
- Create: `src/lib/diagnosticsCounter.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/lib/diagnosticsCounter.test.ts`:

```ts
// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import { setDiagnostics, lintGutter, type Diagnostic } from '@codemirror/lint';
import { DiagnosticsCounter } from './diagnosticsCounter.svelte.ts';

function stateWith(diagnostics: Diagnostic[]): EditorState {
  // lintGutter() installs the diagnostic StateField that setDiagnostics writes into.
  // Without it, the effect is dispatched but no field is listening.
  const initial = EditorState.create({ doc: 'a'.repeat(20), extensions: [lintGutter()] });
  const tr = initial.update({ effects: setDiagnostics(initial, diagnostics) });
  return tr.state;
}

function diag(severity: Diagnostic['severity'], from = 0, to = 1, message = 'x'): Diagnostic {
  return { from, to, severity, message };
}

describe('DiagnosticsCounter', () => {
  it('S-diag-empty-state', () => {
    const c = new DiagnosticsCounter();
    expect(c.errors).toBe(0);
    expect(c.warnings).toBe(0);
    expect(c.info).toBe(0);
  });

  it('S-diag-count-errors-only', () => {
    const c = new DiagnosticsCounter();
    c.update(stateWith([diag('error'), diag('error', 1, 2), diag('error', 2, 3)]));
    expect(c.errors).toBe(3);
    expect(c.warnings).toBe(0);
    expect(c.info).toBe(0);
  });

  it('S-diag-count-mixed', () => {
    const c = new DiagnosticsCounter();
    c.update(stateWith([
      diag('error'),
      diag('warning', 1, 2),
      diag('warning', 2, 3),
      diag('info', 3, 4),
    ]));
    expect(c.errors).toBe(1);
    expect(c.warnings).toBe(2);
    expect(c.info).toBe(1);
  });

  it('S-diag-folds-hint-into-info', () => {
    const c = new DiagnosticsCounter();
    c.update(stateWith([diag('info'), diag('hint', 1, 2)]));
    expect(c.info).toBe(2);
    expect(c.errors).toBe(0);
    expect(c.warnings).toBe(0);
  });

  it('S-diag-update-replaces-previous', () => {
    const c = new DiagnosticsCounter();
    c.update(stateWith([diag('error'), diag('error', 1, 2)]));
    expect(c.errors).toBe(2);
    c.update(stateWith([diag('warning')]));
    expect(c.errors).toBe(0);
    expect(c.warnings).toBe(1);
  });
});
```

- [ ] **Step 2: Run — fails**

Run: `npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo exec -- vitest run src/lib/diagnosticsCounter.test.ts`
Expected: FAIL with `Cannot find module './diagnosticsCounter.svelte.ts'`.

- [ ] **Step 3: Implement the class**

Create `src/lib/diagnosticsCounter.svelte.ts`:

```ts
import { forEachDiagnostic } from '@codemirror/lint';
import type { EditorState } from '@codemirror/state';

/**
 * Aggregates current lint diagnostics by severity. The three `$state` fields
 * are written by `update(state)` (called from `diagnosticsCounterPlugin`) and
 * read reactively by `<DiagnosticsCounter>`.
 *
 * Info-tier severities (`info` + `hint`) are folded into a single `info`
 * count — the demo's linters don't emit `hint` today and unlikely to.
 */
export class DiagnosticsCounter {
  errors = $state(0);
  warnings = $state(0);
  info = $state(0);

  update(state: EditorState): void {
    let errors = 0;
    let warnings = 0;
    let info = 0;
    forEachDiagnostic(state, (d) => {
      if (d.severity === 'error') errors += 1;
      else if (d.severity === 'warning') warnings += 1;
      else info += 1; // info or hint
    });
    this.errors = errors;
    this.warnings = warnings;
    this.info = info;
  }
}
```

- [ ] **Step 4: Tests pass**

Run: `npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo exec -- vitest run src/lib/diagnosticsCounter.test.ts`
Expected: 5 specs pass.

Also run check + lint:
```
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run check
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run lint
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add src/lib/diagnosticsCounter.svelte.ts src/lib/diagnosticsCounter.test.ts
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "feat(lib): DiagnosticsCounter class with severity tallies

Svelte 5 runes class with three \$state counts (errors / warnings /
info; info folds in info + hint). update(state) walks diagnostics via
forEachDiagnostic and writes the totals.

Refs #106."
```

Stage only those two files. No attribution footer.

---

### Task 2: `diagnosticsCounterPlugin` ViewPlugin

The plugin lives in the same file as the class — same module's surface area, no need to split.

**Files:**
- Modify: `src/lib/diagnosticsCounter.svelte.ts`

(No new test here. The ViewPlugin's only job is forwarding transactions to `counter.update`; testing that requires a mounted EditorView and exercises CodeMirror's plumbing, not our logic. Task 1's class tests cover the counting; manual smoke covers the wire-up.)

- [ ] **Step 1: Add the plugin factory**

Append to `src/lib/diagnosticsCounter.svelte.ts`:

```ts
import { ViewPlugin, type ViewUpdate } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

/**
 * Wires a DiagnosticsCounter to the editor view — recomputes counts on
 * every transaction. Diagnostic updates from `linter()` extensions go
 * through transactions, so this catches every lint-state change.
 */
export function diagnosticsCounterPlugin(counter: DiagnosticsCounter): Extension {
  return ViewPlugin.define((view) => {
    counter.update(view.state);
    return {
      update(update: ViewUpdate) {
        counter.update(update.state);
      },
    };
  });
}
```

(Note: `ViewPlugin.define`'s callback receives `view: EditorView`. We do an initial `update` so the counter reflects state at mount — `linter()` may have already produced diagnostics by then for the initial doc.)

- [ ] **Step 2: Verify**

```
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run check
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run lint
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add src/lib/diagnosticsCounter.svelte.ts
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "feat(lib): diagnosticsCounterPlugin ViewPlugin

Calls counter.update(view.state) on mount and on every ViewUpdate.
Lint extensions dispatch their diagnostics via transactions, so the
plugin's update fires whenever counts could change.

Refs #106."
```

Stage only that file. No attribution footer.

---

### Task 3: CSS tokens

**Files:**
- Modify: `src/app.css`

- [ ] **Step 1: Read existing palette token locations**

Find the `:root` block + the `:root[data-theme='light']` override block in `src/app.css`. The existing pattern looks like `--graph-highlight: …;` etc. — pick a place near other diagnostic-adjacent or near the editor section's tokens.

- [ ] **Step 2: Add the three tokens to dark default (`:root`)**

```css
/* Diagnostic counter pills (#106). Defaults tuned for dark; the
   :root[data-theme='light'] block below overrides. */
--diag-error: #f87171;     /* tailwind red-400 — readable on dark surface */
--diag-warning: #fbbf24;   /* tailwind amber-400 */
--diag-info: #60a5fa;      /* tailwind blue-400 */
```

- [ ] **Step 3: Add the light overrides (`:root[data-theme='light']`)**

```css
--diag-error: #dc2626;     /* tailwind red-600 — readable on light surface */
--diag-warning: #d97706;   /* tailwind amber-600 */
--diag-info: #2563eb;      /* tailwind blue-600 */
```

- [ ] **Step 4: Verify svelte-check still passes**

```
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run check
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add src/app.css
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "feat(app.css): diagnostic-severity palette tokens

Three new tokens for the upcoming DiagnosticsCounter pills:
--diag-error / --diag-warning / --diag-info. Light/dark variants.

Refs #106."
```

Stage only that file. No attribution footer.

---

### Task 4: `<DiagnosticsCounter>` Svelte component

**Files:**
- Create: `src/components/DiagnosticsCounter.svelte`

- [ ] **Step 1: Write the component**

Create `src/components/DiagnosticsCounter.svelte`:

```svelte
<script lang="ts">
  import type { DiagnosticsCounter } from '../lib/diagnosticsCounter.svelte.ts';

  type Props = { counter: DiagnosticsCounter };
  const { counter }: Props = $props();
</script>

<div class="diag-counter" aria-live="polite" aria-label="Diagnostic counts">
  {#if counter.errors > 0}
    <span class="pill pill-error" title="{counter.errors} error{counter.errors === 1 ? '' : 's'}">
      <span class="pill-label">E</span>
      <span class="pill-count">{counter.errors}</span>
    </span>
  {/if}
  {#if counter.warnings > 0}
    <span class="pill pill-warning" title="{counter.warnings} warning{counter.warnings === 1 ? '' : 's'}">
      <span class="pill-label">W</span>
      <span class="pill-count">{counter.warnings}</span>
    </span>
  {/if}
  {#if counter.info > 0}
    <span class="pill pill-info" title="{counter.info} info">
      <span class="pill-label">I</span>
      <span class="pill-count">{counter.info}</span>
    </span>
  {/if}
</div>

<style>
  .diag-counter {
    position: absolute;
    bottom: 6px;
    right: 6px;
    display: flex;
    gap: 4px;
    z-index: 5;
    pointer-events: none; /* read-only in Phase 1 — don't intercept editor clicks */
  }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 1px 6px;
    font-family: var(--mono, ui-monospace, 'SF Mono', Consolas, monospace);
    font-size: 11px;
    line-height: 1.4;
    color: var(--bg);
    background: var(--fg);
    border-radius: 10px;
  }

  .pill-error { background: var(--diag-error); }
  .pill-warning { background: var(--diag-warning); }
  .pill-info { background: var(--diag-info); }

  .pill-label {
    font-weight: 700;
  }

  .pill-count {
    font-variant-numeric: tabular-nums;
  }
</style>
```

(Note: `pointer-events: none` makes the overlay click-through so the editor under it still works. Once we add click-to-jump in a future PR, we'll switch to `pointer-events: auto` on the pills selectively.)

- [ ] **Step 2: Verify**

```
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run check
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run lint
```
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add src/components/DiagnosticsCounter.svelte
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "feat(components): DiagnosticsCounter pills

Three-pill overlay (E / W / I), each hidden when its count is 0.
Absolute-positioned bottom-right, click-through (pointer-events: none)
in Phase 1. aria-live=polite so screen readers announce count changes.
Color tokens consumed from app.css.

Refs #106."
```

Stage only that file. No attribution footer.

---

### Task 5: Wire into `Editor.svelte`

**Files:**
- Modify: `src/components/Editor.svelte`

- [ ] **Step 1: Add the imports**

In the `<script>` block, alongside the existing lint imports, add:

```ts
import { DiagnosticsCounter, diagnosticsCounterPlugin } from '../lib/diagnosticsCounter.svelte.ts';
import DiagnosticsCounterComponent from './DiagnosticsCounter.svelte';
```

(The `Component` suffix on the import disambiguates from the class. If you'd rather use a different alias like `DiagCounterUI` for clarity, that's fine — pick one and stick with it.)

- [ ] **Step 2: Instantiate the counter and add the plugin**

In the script body, before the `extensions` `$derived.by`:

```ts
const counter = new DiagnosticsCounter();
```

In the `$derived.by` body, append `diagnosticsCounterPlugin(counter)` to the `base` array:

```ts
const extensions = $derived.by(() => {
  const env: Env = { engine, schema: getSchema(engine) };
  const base = [
    ...completionExtensions(engine),
    syntaxLinter,
    argCountLinter(env),
    crossRefLinter(env),
    unboundLinter(env),
    diagnosticsCounterPlugin(counter),
  ];
  return theme.resolved === 'dark' ? [oneDark, ...base] : base;
});
```

- [ ] **Step 3: Render the component**

In the template, inside the `.editor` div, add the `<DiagnosticsCounterComponent>`:

```svelte
<div class="editor">
  {#if resetVisible}
    <IconButton icon="resetCode" title={resetTitle} onClick={onReset} />
  {/if}
  <CodeMirror
    bind:value={code}
    {lang}
    {extensions}
  />
  <DiagnosticsCounterComponent {counter} />
</div>
```

(Place AFTER `<CodeMirror>` so the absolute-positioned overlay sits on top of the editor content. The `.editor` div already has `position: relative`.)

- [ ] **Step 4: Verify**

```
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run check
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo run lint
npm --prefix /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo exec -- vitest run
```
Expected: check + lint clean. Vitest suite still green (the new tests from Task 1 add 5 specs in `src/lib/`).

- [ ] **Step 5: Commit**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add src/components/Editor.svelte
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "feat(editor): wire DiagnosticsCounter overlay

Per-Editor counter + ViewPlugin + bottom-right pill overlay. Counts
update on every transaction; pills hide when their count is 0.

Refs #106."
```

Stage only that file. No attribution footer.

---

### Task 6: Manual smoke + docs + PR

**Manual smoke checklist:**

Open `/post` and paste a fixture that triggers each lint source:

```js
const { PostMachine, mark, stop } = imports;
const m = new PostMachine({
  10: mark(),        // arg-count error
  20: call('typo'),  // unbound error (call not destructured), then if call IS destructured the cross-ref error fires
  30: mark(1, 2),    // arg-count warning
  40: stop,
}, { blankSymbol: ' ', markSymbol: '*' });
```

Confirm:
- Bottom-right shows pills, something like `E 2 W 1` (or whatever the actual count is — the exact total depends on which errors fire).
- Removing all lint sources (`mark(20)`, `call('typo')` → remove or add to destructure, etc.) clears the pills (none rendered).
- An empty editor (just `// hi`) shows nothing.
- Pills hide individually — adding only an arg-count warning shows just `W n`.
- Light/dark theme toggle changes the pill colors per the new tokens.
- Pills don't intercept clicks — clicking through them lands the cursor in the editor as expected (pointer-events: none).

If anything misbehaves, gather a specific repro and recommit a fix + regression test.

- [ ] **Step 1: Update CLAUDE.md tree**

In the `lib/` subsection (around the `theme.svelte.ts` / `logStore.svelte.ts` lines), add:

```
    ├── diagnosticsCounter.svelte.ts  class DiagnosticsCounter (Svelte 5 runes — $state counts for errors / warnings / info) + diagnosticsCounterPlugin(counter) ViewPlugin that recomputes via forEachDiagnostic on every transaction. info severity folds in info + hint.
    ├── diagnosticsCounter.test.ts    Vitest specs (happy-dom env) — empty / errors-only / mixed / hint-folded / replace-on-update (cites S-diag-...)
```

In the `components/` subsection, add:

```
│   ├── DiagnosticsCounter.svelte  three-pill overlay (#106) — E / W / I pills, each hidden when count is 0; bottom-right absolute-positioned, click-through (pointer-events: none) in Phase 1. Colors from --diag-error / --diag-warning / --diag-info palette tokens.
```

In the Editor section prose, append:

> Plus a bottom-right `<DiagnosticsCounter>` overlay (#106) — three pills (E / W / I) showing aggregate counts across all lint sources, computed by a `DiagnosticsCounter` class (Svelte 5 runes) updated by a `diagnosticsCounterPlugin` ViewPlugin on every transaction. Pills hide individually when their count is 0. Read-only in Phase 1; click-to-jump is parked for a follow-up.

- [ ] **Step 2: Commit docs + plan**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo add CLAUDE.md docs/superpowers/plans/2026-06-15-106-diagnostic-counters.md
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo commit -m "docs: add DiagnosticsCounter to CLAUDE.md + check in plan

Counter class + plugin + component documented next to the other lib
files and editor overlay descriptions. Plan committed alongside per the
workspace convention for docs/superpowers/plans/."
```

- [ ] **Step 3: Rebase on master**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo fetch origin master
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo log HEAD..origin/master --oneline
```

If master moved, rebase: `git -C ... rebase origin/master`. If the branch was already pushed, force-push with lease.

- [ ] **Step 4: Open the PR (only with explicit user approval)**

```bash
git -C /Users/mellonis/Developer/mellonis-workspace/machines/machines-demo push -u origin feat/106-diagnostic-counters
gh pr create --repo mellonis/machines-demo --head feat/106-diagnostic-counters --base master --title "feat(editor): diagnostic counter pills (#106 Phase 1)" --body "$(cat <<'EOF'
## Summary
- New `src/lib/diagnosticsCounter.svelte.ts` — \`class DiagnosticsCounter\` (Svelte 5 runes, three \`$state\` counts: errors / warnings / info) and \`diagnosticsCounterPlugin(counter)\` (CodeMirror ViewPlugin that calls \`counter.update(view.state)\` on every transaction; \`forEachDiagnostic\` walks the current diagnostics and tallies).
- New \`src/components/DiagnosticsCounter.svelte\` — three-pill overlay (E / W / I), each pill hidden when its count is 0. Bottom-right absolute-positioned inside \`.editor\`. Click-through (\`pointer-events: none\`) in Phase 1.
- New palette tokens in \`src/app.css\`: \`--diag-error\` / \`--diag-warning\` / \`--diag-info\` with light/dark variants.
- \`info\` + \`hint\` severities fold into the single \`I\` pill (no current lint source emits \`hint\`; future-proofs without adding a 4th pill).

## Out of scope (parked per the issue)
- Click-to-jump behavior (Phase 2 — would also need to flip pointer-events back on).
- E2E test (covered by Task 1 unit specs + manual smoke).
- Quick-fix actions on click (belongs with the unbound-identifier quick-fix originally parked from #103).

## Test plan
- [x] 5 new specs in \`src/lib/diagnosticsCounter.test.ts\` (happy-dom env) covering empty / errors-only / mixed / hint-folds-to-info / update-replaces.
- [x] \`npm run check\` clean.
- [x] \`npm run lint\` clean.
- [x] \`npm test\` — full suite green.
- [x] Manual smoke on /post + /turing: pills appear correctly when each lint source fires (arg-count missing → E; arg-count extras → W; unbound → E; cross-ref unknown → E; empty subroutine → E); pills hide individually when their count is 0; theme toggle reflects token swap.

Closes #106 (Phase 1).
EOF
)"
```

Do not push or open the PR without explicit user approval.

---

## Self-review checklist

**Spec coverage** (from #106):
- 3 pills E/W/I — Task 4.
- Pills hide when 0 — Task 4 (`{#if counter.errors > 0}`).
- Bottom-right overlay — Task 4 CSS.
- Read from `forEachDiagnostic` — Task 1 class.
- `diagnosticsCounter.svelte.ts` module — Task 1.
- `DiagnosticsCounter.svelte` component — Task 4.
- Editor wire-up — Task 5.
- Per-severity CSS tokens — Task 3.
- Unit test feeding synthetic states — Task 1 with `setDiagnostics` + `forEachDiagnostic`.
- E2E smoke — covered manually by Task 6.

**Placeholder scan:** every step has the actual code, the exact command, the expected output. No TBDs.

**Type consistency:**
- `DiagnosticsCounter` — class, declared in Task 1, consumed in Tasks 2, 4, 5.
- `diagnosticsCounterPlugin(counter): Extension` — Task 2 declared, Task 5 consumed.
- `counter.errors` / `counter.warnings` / `counter.info` — Task 1 declared as `$state`, Task 4 read reactively, Task 1 specs assert.
- `update(state: EditorState): void` — Task 1 signature, Task 2 caller.

**Risk callouts:**
- The class test relies on `@vitest-environment happy-dom`. If happy-dom isn't installed as a dev dep, the pragma triggers a Vitest error. Pre-existing logStore tests use the same pattern though — happy-dom is installed (per CLAUDE.md's mention of `vitest.setup.ts`). Should work.
- `setDiagnostics(state, diagnostics)` writes into a StateField installed by `lintGutter()` (or `linter()` — same field). My test fixture uses `lintGutter()` because it's lighter than `linter()`. If `forEachDiagnostic` returns nothing in the test (Vitest output: count stays 0), it means the field isn't installed — switch to `linter(() => [])` instead.
- Bottom-right overlay can theoretically collide with CodeMirror's scrollbar or fold-indicator. In practice with the demo's small editor footprint, the bottom-right corner is clear. If a smoke test shows overlap, we can shift to `bottom: 8px; right: 8px` or larger; for now matching IconButton's 6px is consistent.
- ViewPlugin's `update(viewUpdate)` fires for EVERY transaction including pure-effect-only ones. Recomputing on every transaction is cheap (linear in #diagnostics, typically <20), but if profiling ever shows it as a hotspot we can guard on `update.transactions.some(tr => /* lint state effect */)`. Not in scope.
