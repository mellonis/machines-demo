# Test infrastructure PR4 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `Toolbar.svelte` component tests via `@testing-library/svelte` covering `runLabel`, `disabled`-prop reflection, `configVisible`/`stopVisible`, `intervalIsValid` styling, and click→callback wiring. PR4 of [#47](https://github.com/mellonis/machines-demo/issues/47).

**Architecture:** A single new test file `src/components/Toolbar.test.ts` opts into `happy-dom` via the `// @vitest-environment happy-dom` pragma. `@testing-library/jest-dom` matchers are wired through a one-line `vitest.setup.ts`. Tests are characterization-style: production code already exists, so each test should PASS on first run; a failing test indicates either a wrong assertion or a regression. No production-side changes to `Toolbar.svelte`.

**Tech Stack:** Vitest 4.x, `@testing-library/svelte` 5.x (Svelte-5 compatible), `@testing-library/jest-dom` 6.x, `happy-dom` 15.x.

**Spec:** `docs/superpowers/specs/2026-05-09-test-infra-pr4-design.md`

**Branch:** `feature/test-infra-pr4-47` (already created at master HEAD; the spec doc commit is the first commit on the branch).

---

## File map

| File | Change |
|---|---|
| `package.json` | **Modify** — add `@testing-library/svelte`, `@testing-library/jest-dom`, `happy-dom` to `devDependencies`. |
| `vitest.setup.ts` | **Create** — single import line for jest-dom matchers. |
| `vitest.config.ts` | **Modify** — add `setupFiles: ['./vitest.setup.ts']`. |
| `src/components/Toolbar.test.ts` | **Create** — 15 tests in 5 `describe` blocks. |
| `docs/execution-model.md` | **Modify** — §14 grammar gains a `C-<component>-<facet>` row and the `Toolbar.test.ts` topic listing. |
| `CLAUDE.md` | **Modify** — list `Toolbar.test.ts` in the components tree; mention happy-dom pragma. |
| `README.md` | **Modify** — same drift-prevention sync. |

---

## Verification model

After each test task: `npm run check && npm run lint && npm test` — all exit 0; test count grows by the number added. T6 final pass adds `npm run build`. Final test count after PR4 is **56** (9 PR1 + 16 PR2 + 16 PR3 helpers + 15 PR4).

> **Note on PR4 test count:** the spec's earlier draft mentioned 16 tests; the final cut dropped one redundancy (`disabled` collapsed from 4 to 3 tests, since `disabled-run` was subsumed by `disabled-run-cascade`). Final PR4 count is **15** tests across 5 describe blocks: `runLabel` (4), `disabled` (3), `visibility` (4), `interval` (1), `callbacks` (3).

---

## Task 1: Add dev dependencies, setup file, and config wiring

**Files:**
- Modify: `package.json` — add 3 devDeps
- Create: `vitest.setup.ts`
- Modify: `vitest.config.ts` — add `setupFiles`

- [ ] **Step 1: Add the three devDependencies**

Edit `package.json`. Inside the `devDependencies` object, add (alphabetically among the other `@`-scoped entries):

```jsonc
"@testing-library/jest-dom": "^6.6.0",
"@testing-library/svelte": "^5.2.0",
```

And in the unscoped section (alphabetically, between `eslint-plugin-svelte` and `svelte`):

```jsonc
"happy-dom": "^15.11.0",
```

- [ ] **Step 2: Install**

Run: `npm install`
Expected: completes without errors; `package-lock.json` updates with the three new entries and their transitive deps.

- [ ] **Step 3: Create `vitest.setup.ts`**

Create `vitest.setup.ts` at the repo root (sibling of `vitest.config.ts`) with this exact one-line content:

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 4: Wire setup into `vitest.config.ts`**

Edit `vitest.config.ts`. Change:

```ts
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/**/*.test.ts', 'src/lib/testUtils.ts'],
    },
  },
});
```

to:

```ts
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/lib/**/*.ts'],
      exclude: ['src/lib/**/*.test.ts', 'src/lib/testUtils.ts'],
    },
  },
});
```

- [ ] **Step 5: Verify nothing breaks**

Run: `npm run check && npm run lint && npm test`
Expected: all three exit 0; test count is **41** (unchanged from PR3 — no new tests yet, and the setup file should not cause any environment-related failures in the existing node-environment tests).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.ts vitest.setup.ts
git commit -m "test: wire happy-dom + jest-dom for component tests (PR4 of #47)"
```

---

## Task 2: Test scaffold + `describe('runLabel')` (4 tests)

**Files:**
- Create: `src/components/Toolbar.test.ts`

- [ ] **Step 1: Create the test file scaffold + runLabel block**

Create `src/components/Toolbar.test.ts` with this exact content:

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Toolbar from './Toolbar.svelte';
import type { Example } from '../lib/defaultCode';
import type { Snippets } from '../lib/persist';

type Mode =
  | 'DEMO' | 'MANUAL'
  | 'RUNNING_STEP' | 'RUNNING_AUTO' | 'RUNNING_CONTINUOUS'
  | 'RUNNING_PAUSED_AT_BREAK'
  | 'HALTED';

function defaultProps() {
  return {
    executionMode: 'DEMO' as Mode,
    loadDisabled: false,
    stepDisabled: false,
    runDisabled: false,
    intervalIsValid: true,
    examples: [] as readonly Example[],
    selectedExampleId: '',
    withPause: false,
    debugMode: false,
    intervalText: '1s',
    snippets: {} as Snippets,
    loadedSnippetId: null,
    dirty: false,
    onBuild: vi.fn(),
    onStep: vi.fn(),
    onRun: vi.fn(),
    onStop: vi.fn(),
    onPickExample: vi.fn(),
    onSaveSnippet: vi.fn(),
    onSaveChanges: vi.fn(),
    onLoadSnippet: vi.fn(),
    onDeleteSnippet: vi.fn(),
    onRenameSnippet: vi.fn(),
  };
}

describe('Toolbar', () => {
  describe('runLabel', () => {
    it('C-toolbar-run-label-default: shows "Run" outside paused', () => {
      render(Toolbar, { props: { ...defaultProps(), executionMode: 'DEMO' } });
      expect(screen.getByRole('button', { name: /^run$/i })).toBeInTheDocument();
    });

    it('C-toolbar-run-label-paused: shows "Continue" in RUNNING_PAUSED_AT_BREAK', () => {
      render(Toolbar, { props: { ...defaultProps(), executionMode: 'RUNNING_PAUSED_AT_BREAK' } });
      expect(screen.getByRole('button', { name: /^continue$/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^run$/i })).not.toBeInTheDocument();
    });

    it('C-toolbar-step-label-default: shows "Step" outside running-auto', () => {
      render(Toolbar, { props: { ...defaultProps(), executionMode: 'DEMO' } });
      expect(screen.getByRole('button', { name: /^step$/i })).toBeInTheDocument();
    });

    it('C-toolbar-step-label-running-auto: shows "Pause" in RUNNING_AUTO', () => {
      render(Toolbar, { props: { ...defaultProps(), executionMode: 'RUNNING_AUTO' } });
      expect(screen.getByRole('button', { name: /^pause$/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^step$/i })).not.toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run the new tests**

Run: `npm test`
Expected: all 4 new tests pass; total test count is now **45**. If the runLabel-paused test fails because both "Run" and "Continue" buttons are matched, switch to using a more specific accessible-name regex (the production code only renders one or the other based on `runLabel`, so this should not happen).

- [ ] **Step 3: Verify check + lint**

Run: `npm run check && npm run lint`
Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/Toolbar.test.ts
git commit -m "test: Toolbar runLabel + step-vs-pause derivation (PR4 of #47)"
```

---

## Task 3: `describe('disabled')` (3 tests)

**Files:**
- Modify: `src/components/Toolbar.test.ts`

- [ ] **Step 1: Append the disabled block**

In `src/components/Toolbar.test.ts`, add a new `describe` block as a sibling of `describe('runLabel')` (still inside the outer `describe('Toolbar')`), before the closing `});`:

```ts
  describe('disabled', () => {
    it('C-toolbar-disabled-build: loadDisabled disables Build button', () => {
      render(Toolbar, { props: { ...defaultProps(), loadDisabled: true } });
      expect(screen.getByRole('button', { name: /^build$/i })).toBeDisabled();
    });

    it('C-toolbar-disabled-step: stepDisabled disables Step button', () => {
      render(Toolbar, { props: { ...defaultProps(), stepDisabled: true } });
      expect(screen.getByRole('button', { name: /^step$/i })).toBeDisabled();
    });

    it('C-toolbar-disabled-run-cascade: runDisabled disables Run + with-pause + debug', () => {
      render(Toolbar, { props: { ...defaultProps(), executionMode: 'DEMO', runDisabled: true } });
      expect(screen.getByRole('button', { name: /^run$/i })).toBeDisabled();
      expect(screen.getByRole('checkbox', { name: /with pause/i })).toBeDisabled();
      expect(screen.getByRole('checkbox', { name: /^debug$/i })).toBeDisabled();
    });
  });
```

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: 3 new tests pass; total is **48**.

- [ ] **Step 3: Verify check + lint**

Run: `npm run check && npm run lint`
Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/Toolbar.test.ts
git commit -m "test: Toolbar disabled-prop reflection (PR4 of #47)"
```

---

## Task 4: `describe('visibility')` (4 tests)

**Files:**
- Modify: `src/components/Toolbar.test.ts`

- [ ] **Step 1: Append the visibility block**

In `src/components/Toolbar.test.ts`, append after `describe('disabled')`:

```ts
  describe('visibility', () => {
    it('C-toolbar-config-visible-demo: with-pause + debug checkboxes render in DEMO', () => {
      render(Toolbar, { props: { ...defaultProps(), executionMode: 'DEMO' } });
      expect(screen.getByRole('checkbox', { name: /with pause/i })).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: /^debug$/i })).toBeInTheDocument();
    });

    it('C-toolbar-config-hidden-running-auto: config row absent in RUNNING_AUTO', () => {
      render(Toolbar, { props: { ...defaultProps(), executionMode: 'RUNNING_AUTO' } });
      expect(screen.queryByRole('checkbox', { name: /with pause/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('checkbox', { name: /^debug$/i })).not.toBeInTheDocument();
    });

    it('C-toolbar-stop-visible-running-step: Stop button renders in RUNNING_STEP', () => {
      render(Toolbar, { props: { ...defaultProps(), executionMode: 'RUNNING_STEP' } });
      expect(screen.getByRole('button', { name: /^stop$/i })).toBeInTheDocument();
    });

    it('C-toolbar-stop-hidden-halted: Stop button absent in HALTED', () => {
      render(Toolbar, { props: { ...defaultProps(), executionMode: 'HALTED' } });
      expect(screen.queryByRole('button', { name: /^stop$/i })).not.toBeInTheDocument();
    });
  });
```

- [ ] **Step 2: Run tests**

Run: `npm test`
Expected: 4 new tests pass; total is **52**.

- [ ] **Step 3: Verify check + lint**

Run: `npm run check && npm run lint`
Expected: both exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/components/Toolbar.test.ts
git commit -m "test: Toolbar configVisible / stopVisible derivations (PR4 of #47)"
```

---

## Task 5: `describe('interval')` + `describe('callbacks')` (1 + 3 = 4 tests)

**Files:**
- Modify: `src/components/Toolbar.test.ts`

- [ ] **Step 1: Add `fireEvent` to the imports**

At the top of `src/components/Toolbar.test.ts`, change:

```ts
import { render, screen } from '@testing-library/svelte';
```

to:

```ts
import { render, screen, fireEvent } from '@testing-library/svelte';
```

- [ ] **Step 2: Append both describe blocks**

In `src/components/Toolbar.test.ts`, append after `describe('visibility')`:

```ts
  describe('interval', () => {
    it('C-toolbar-interval-invalid: intervalIsValid=false marks input .invalid', () => {
      render(Toolbar, {
        props: {
          ...defaultProps(),
          executionMode: 'DEMO',
          withPause: true,
          intervalIsValid: false,
        },
      });
      const input = screen.getByPlaceholderText('1s');
      expect(input.classList.contains('invalid')).toBe(true);
    });
  });

  describe('callbacks', () => {
    it('C-toolbar-callback-build: clicking Build invokes onBuild', async () => {
      const props = defaultProps();
      render(Toolbar, { props });
      await fireEvent.click(screen.getByRole('button', { name: /^build$/i }));
      expect(props.onBuild).toHaveBeenCalledTimes(1);
    });

    it('C-toolbar-callback-step: clicking Step invokes onStep', async () => {
      const props = defaultProps();
      render(Toolbar, { props });
      await fireEvent.click(screen.getByRole('button', { name: /^step$/i }));
      expect(props.onStep).toHaveBeenCalledTimes(1);
    });

    it('C-toolbar-callback-run-stop: Run invokes onRun; Stop (in RUNNING_STEP) invokes onStop', async () => {
      const propsA = defaultProps();
      const { unmount } = render(Toolbar, { props: propsA });
      await fireEvent.click(screen.getByRole('button', { name: /^run$/i }));
      expect(propsA.onRun).toHaveBeenCalledTimes(1);
      unmount();

      const propsB = { ...defaultProps(), executionMode: 'RUNNING_STEP' as Mode };
      render(Toolbar, { props: propsB });
      await fireEvent.click(screen.getByRole('button', { name: /^stop$/i }));
      expect(propsB.onStop).toHaveBeenCalledTimes(1);
    });
  });
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: 4 new tests pass; total is **56**.

- [ ] **Step 4: Verify check + lint**

Run: `npm run check && npm run lint`
Expected: both exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/components/Toolbar.test.ts
git commit -m "test: Toolbar interval styling + click→callback wiring (PR4 of #47)"
```

---

## Task 6: Sync docs (`docs/execution-model.md`, `CLAUDE.md`, `README.md`) + final verification

**Files:**
- Modify: `docs/execution-model.md` — §14 grammar
- Modify: `CLAUDE.md` — components tree + testing-conventions note
- Modify: `README.md` — components tree

- [ ] **Step 1: Update §14 grammar in `docs/execution-model.md`**

Locate the `<topic>` row in the §14 grammar table. After PR3 it reads (approximately):

> `machineRunner.test.ts`: `protocol`, `timer`, `pending`, `error`. `workerHelpers.test.ts`: `movement-code`, `commands`, `snapshot`, `phase-guard`, `step-arm`.

Replace it with:

> `machineRunner.test.ts`: `protocol`, `timer`, `pending`, `error`. `workerHelpers.test.ts`: `movement-code`, `commands`, `snapshot`, `phase-guard`, `step-arm`. Component tests use the `C-<component>-<facet>` form — e.g., `Toolbar.test.ts`: `run-label`, `disabled`, `visibility`, `interval`, `callbacks`.

If §14 also includes a separate prefix table (e.g., `R-` / `S-` rows), add a third row:

> `C-` — component-facet test (Toolbar, future MachineView, etc.)

- [ ] **Step 2: Update `CLAUDE.md`**

In the Architecture tree under `components/`, add the test file alongside `Toolbar.svelte`:

```
│   ├── Toolbar.svelte       Build/Step/Run/Stop + with-pause + examples menu
│   ├── Toolbar.test.ts      Vitest suite for Toolbar — runLabel / disabled / visibility / interval / callbacks
```

In the testing conventions / commands section (where `npm test` is documented), add:

> Component tests opt into `happy-dom` via the `// @vitest-environment happy-dom` pragma at the top of the file. `vitest.setup.ts` registers `@testing-library/jest-dom` matchers (`toBeDisabled`, `toBeInTheDocument`, etc.) for every test environment.

- [ ] **Step 3: Update `README.md`**

Same tree addition as CLAUDE.md (line under `Toolbar.svelte`):

```
│   ├── Toolbar.svelte             Build/Step/Run/Stop + with-pause + examples menu
│   ├── Toolbar.test.ts            Vitest suite for Toolbar — 5 topic groups
```

(README's tree uses slightly wider indentation than CLAUDE.md — match the surrounding style.)

- [ ] **Step 4: Final verification**

Run: `npm run check && npm run lint && npm test && npm run build`
Expected: all four exit 0; test count = **56**; build emits to `dist/`.

- [ ] **Step 5: Verify scenario IDs**

Run: `grep -oE '\bC-toolbar-[a-z-]+' src/components/Toolbar.test.ts | sort -u | wc -l`
Expected: `15` (each unique `C-toolbar-<facet>` ID appears once).

Run: `grep -oE '\bR-[a-z-]+' src/lib/machineRunner.test.ts src/lib/workerHelpers.test.ts | sort -u | wc -l`
Expected: `41` (PR1 9 + PR2 16 + PR3 16 = 41 unique R-IDs across the two existing test files; PR4 must not have introduced or removed any).

- [ ] **Step 6: Verify no production-side changes**

Run: `git diff master..HEAD --stat src/components/Toolbar.svelte src/lib/`
Expected: empty output (no production source files modified).

- [ ] **Step 7: Commit docs**

```bash
git add docs/execution-model.md CLAUDE.md README.md
git commit -m "docs: register C-component test prefix and Toolbar.test.ts (PR4 of #47)"
```

---

## Self-review (after T6)

1. **Each PR4 `it()` name matches `\bC-toolbar-[a-z-]+: <text>`.** All 15 PR4 tests are `C-toolbar-`-prefixed.
2. **No production code changed.** `git diff master..HEAD --stat src/components/Toolbar.svelte src/lib/` is empty.
3. **All tests pass.** `npm test` exits 0; total = 56.
4. **`npm run check` passes.** Svelte 5 component imports type-check cleanly.
5. **Setup file works.** Tests use `toBeDisabled()` / `toBeInTheDocument()` — passing tests confirm `setupFiles` wiring.
6. **`vitest.config.ts` change is minimal.** Only `setupFiles` line added; `environment` stays `'node'` (component tests opt in via per-file pragma).

Fix any issues inline before declaring done.
