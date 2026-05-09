# Test infrastructure PR5 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 4 Playwright E2E tests covering cold-start Run / Step+debug / Continue / Stop-while-paused on the default Turing example. Add a PR-gate CI workflow that runs check + lint + Vitest + Playwright on every pull request. PR5 of [#47](https://github.com/mellonis/machines-demo/issues/47).

**Architecture:** New `e2e/` directory at repo root with one `cold-start.spec.ts` file. `playwright.config.ts` runs Chromium-only against `vite preview`. `data-testid` attributes added to Tape cells, Log lines, and key wrappers (buttons keep accessible names). New `.github/workflows/test.yml` runs four parallel jobs (`check`, `lint`, `vitest`, `playwright`) on `pull_request`.

**Tech Stack:** Playwright 1.50.x (Chromium only), Vite 5 preview server, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-05-09-test-infra-pr5-design.md`

**Branch:** `feature/test-infra-pr5-47` (already created at master HEAD; the spec doc commit is the first commit on the branch).

---

## File map

| File | Change |
|---|---|
| `package.json` | **Modify** — add `@playwright/test` to devDeps; add `test:e2e` and `test:e2e:ui` scripts. |
| `playwright.config.ts` | **Create** — Chromium project, `webServer: npm run preview`, `testDir: './e2e'`. |
| `e2e/cold-start.spec.ts` | **Create** — 4 tests covering the 4 scenarios. |
| `src/components/Tape.svelte` | **Modify** — add `data-testid` attributes. |
| `src/components/Log.svelte` | **Modify** — add `data-testid` attributes. |
| `src/components/TapesStack.svelte` | **Modify** — add `data-testid` to root. |
| `.github/workflows/test.yml` | **Create** — `pull_request` trigger; 4 parallel jobs. |
| `docs/execution-model.md` | **Modify** — §14 grammar gains the `E-` prefix; regex → `[SRCE]`. |
| `CLAUDE.md` | **Modify** — list new scripts, `e2e/` dir, Playwright config; mention testid convention. |
| `README.md` | **Modify** — same drift sync. |
| `.gitignore` | **Modify** — add `playwright-report/`, `test-results/`, `blob-report/`. |

---

## Verification model

After each task: `npm run check && npm run lint && npm test` — all exit 0 with **56 unit tests** unchanged. T3 also runs `npm run test:e2e` with **4 E2E tests passing**. T6 runs the full pipeline (check + lint + test + test:e2e + build) and verifies the CI workflow YAML is valid.

---

## Task 1: Add `data-testid` attributes to production components

**Files:**
- Modify: `src/components/Tape.svelte` (lines 89–106)
- Modify: `src/components/Log.svelte` (lines 21, 30)
- Modify: `src/components/TapesStack.svelte` (line 50)

These are non-functional attribute additions only. No behavior changes.

- [ ] **Step 1: Edit `src/components/Tape.svelte`**

Find this block (around line 89–106):

```svelte
<div
  class="ui-belt"
  class:no-caret={!showCaret}
  style={caretColor ? `--head: ${caretColor};` : undefined}
>
  <div class="viewport">
    <div class="center">
      <div class="strip transitions-on" bind:this={stripEl}>
        {#each viewport as cell}
          <div class="cell" class:blank={cell.blank}>
            <span class="sym">{cell.sym}</span>
          </div>
        {/each}
      </div>
    </div>
    <div class="caret"></div>
  </div>
</div>
```

Replace with:

```svelte
<div
  class="ui-belt"
  class:no-caret={!showCaret}
  style={caretColor ? `--head: ${caretColor};` : undefined}
  data-testid="tape"
>
  <div class="viewport">
    <div class="center">
      <div class="strip transitions-on" bind:this={stripEl}>
        {#each viewport as cell}
          <div class="cell" class:blank={cell.blank} data-testid="tape-cell" data-blank={cell.blank}>
            <span class="sym">{cell.sym}</span>
          </div>
        {/each}
      </div>
    </div>
    <div class="caret"></div>
  </div>
</div>
```

- [ ] **Step 2: Edit `src/components/Log.svelte`**

Find this block (around line 21–46):

```svelte
<div class="log-panel">
  {#if entries.length > 0}
    <IconButton icon="eraser" title="Clear log" onClick={onClear} />
  {/if}
  <div class="content" bind:this={scrollEl}>
    {#each entries as entry, i (i)}
      {#if entry.separator}
        <hr class="sep" />
      {:else}
        <div class="line" class:error={entry.kind === 'error'} class:warn={entry.kind === 'warn'} class:ok={entry.kind === 'ok'}>
```

Replace the opening `<div class="log-panel">` with `<div class="log-panel" data-testid="log">`, and the inner `<div class="line" ...>` with:

```svelte
        <div
          class="line"
          class:error={entry.kind === 'error'}
          class:warn={entry.kind === 'warn'}
          class:ok={entry.kind === 'ok'}
          data-testid="log-line"
          data-kind={entry.kind ?? ''}
        >
```

- [ ] **Step 3: Edit `src/components/TapesStack.svelte`**

Find (around line 50):

```svelte
<div class="tapes-stack">
```

Replace with:

```svelte
<div class="tapes-stack" data-testid="tapes-stack">
```

- [ ] **Step 4: Verify nothing breaks**

Run: `npm run check && npm run lint && npm test && npm run build`
Expected: all four exit 0; **56 unit tests pass** unchanged; build emits to `dist/`.

- [ ] **Step 5: Commit**

```bash
git add src/components/Tape.svelte src/components/Log.svelte src/components/TapesStack.svelte
git commit -m "ui: add data-testid attributes for E2E selectors (PR5 of #47)"
```

---

## Task 2: Install Playwright + scripts + config

**Files:**
- Modify: `package.json` — add devDep + 2 scripts
- Create: `playwright.config.ts`
- Modify: `.gitignore` — add Playwright output dirs

- [ ] **Step 1: Add devDependency to `package.json`**

In `package.json`, inside `devDependencies` (alphabetically between `@sveltejs/vite-plugin-svelte` and `@testing-library/jest-dom`):

```jsonc
"@playwright/test": "^1.50.0",
```

- [ ] **Step 2: Add scripts to `package.json`**

In the `scripts` block, add (after the existing `test:coverage`):

```jsonc
"test:e2e": "playwright test",
"test:e2e:ui": "playwright test --ui"
```

The final scripts block should have these entries (order: dev, build, preview, check, lint, test, test:watch, test:coverage, test:e2e, test:e2e:ui).

- [ ] **Step 3: Install**

Run: `npm install && npx playwright install --with-deps chromium`
Expected: completes without errors; `package-lock.json` updates with `@playwright/test` entry; Chromium browser binary downloaded.

- [ ] **Step 4: Create `playwright.config.ts`**

Create `playwright.config.ts` at the repo root with this exact content:

```ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'npm run preview',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
```

- [ ] **Step 5: Update `.gitignore`**

Append these lines:

```
playwright-report
test-results
blob-report
```

The final file should be:

```
node_modules
dist
coverage
.DS_Store
.vite
*.log
playwright-report
test-results
blob-report
```

- [ ] **Step 6: Verify config loads**

Run: `npx playwright test --list`
Expected: lists 0 tests (no `e2e/*.spec.ts` files exist yet) but does not error on the config itself.

- [ ] **Step 7: Verify nothing else breaks**

Run: `npm run check && npm run lint && npm test`
Expected: all three exit 0; 56 unit tests pass.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json playwright.config.ts .gitignore
git commit -m "test: install Playwright + preview-server config (PR5 of #47)"
```

---

## Task 3: Write the 4 E2E tests

**Files:**
- Create: `e2e/cold-start.spec.ts`

- [ ] **Step 1: Create the directory and file**

Create `e2e/cold-start.spec.ts` with this exact content:

```ts
import { test, expect } from '@playwright/test';

test.describe('cold-start', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/turing');
    // Wait for the app to mount before clicking. DEMO mode auto-runs but
    // doesn't block clicks.
    await expect(page.getByTestId('tapes-stack')).toBeVisible();
  });

  test('E-cold-start-run-debug-off: Run advances tape, halt logged', async ({ page }) => {
    await page.getByRole('button', { name: /^run$/i }).click();
    await expect(
      page.getByTestId('log-line').filter({ hasText: /halted after \d+ step\(s\)/ }),
    ).toBeVisible({ timeout: 10_000 });
    // Default Turing example transforms ['a','b','c','b','a'] → ['a','*','c','*','a'].
    // Tape.svelte renders VIEWPORT_WIDTH=23 cells per tape; the * count among
    // the rendered cells is 2 (both 'b's were replaced).
    const cells = await page.getByTestId('tape-cell').allInnerTexts();
    expect(cells.filter((s) => s === '*').length).toBe(2);
  });

  test('E-cold-start-step-debug-on: Step+debug=on parks at iter-1 with state info', async ({ page }) => {
    await page.getByRole('checkbox', { name: /^debug$/i }).check();
    await page.getByRole('button', { name: /^step$/i }).click();
    // Cold-start Step always uses the run-mode after-trick; with debug=on the
    // user-set breaks would also fire, but the example has none — the
    // after-trick pause is what surfaces.
    await expect(
      page.getByTestId('log-line').filter({
        hasText: /paused at .*state .* after applying command for symbols:/,
      }),
    ).toBeVisible({ timeout: 5_000 });
    // Run button relabels to "Continue" while paused.
    await expect(page.getByRole('button', { name: /^continue$/i })).toBeVisible();
  });

  test('E-continue-from-step: Continue (debug=off) runs to halt without further pauses', async ({ page }) => {
    // Reach the paused state via the same flow as the previous test.
    await page.getByRole('checkbox', { name: /^debug$/i }).check();
    await page.getByRole('button', { name: /^step$/i }).click();
    await expect(page.getByRole('button', { name: /^continue$/i })).toBeVisible();

    // Snapshot the pre-Continue paused-line count.
    const pausedBefore = await page
      .getByTestId('log-line')
      .filter({ hasText: /^paused at/ })
      .count();

    // Toggle debug off, then Continue.
    await page.getByRole('checkbox', { name: /^debug$/i }).uncheck();
    await page.getByRole('button', { name: /^continue$/i }).click();
    await expect(
      page.getByTestId('log-line').filter({ hasText: /halted after \d+ step\(s\)/ }),
    ).toBeVisible({ timeout: 10_000 });

    // No additional "paused" lines added between Continue click and halt.
    const pausedAfter = await page
      .getByTestId('log-line')
      .filter({ hasText: /^paused at/ })
      .count();
    expect(pausedAfter).toBe(pausedBefore);
  });

  test('E-stop-while-paused: Stop while paused halts; Run/Step stay enabled', async ({ page }) => {
    await page.getByRole('checkbox', { name: /^debug$/i }).check();
    await page.getByRole('button', { name: /^step$/i }).click();
    await expect(page.getByRole('button', { name: /^continue$/i })).toBeVisible();

    // Stop returns the machine to MANUAL with workerLive=true: Run/Step stay
    // clickable so the user can keep poking the same machine state.
    await page.getByRole('button', { name: /^stop$/i }).click();
    await expect(
      page.getByTestId('log-line').filter({ hasText: /^stopped/ }),
    ).toBeVisible();

    // After Stop, Run-button reverts to "Run" and is enabled; Step is enabled
    // too. Stop button itself disappears (stopVisible is false in MANUAL).
    await expect(page.getByRole('button', { name: /^run$/i })).toBeEnabled();
    await expect(page.getByRole('button', { name: /^step$/i })).toBeEnabled();
    await expect(page.getByRole('button', { name: /^stop$/i })).not.toBeVisible();
  });
});
```

- [ ] **Step 2: Build the bundle (the `webServer` block needs `dist/`)**

Run: `npm run build`
Expected: emits `dist/`.

- [ ] **Step 3: Run E2E tests**

Run: `npm run test:e2e`
Expected: 4 tests pass; preview server spins up, tests run, server tears down. Reporter prints `4 passed`.

If any test fails, investigate (do NOT modify production code to make tests pass — investigate the discrepancy and report it):
- A common failure is an over-eager `getByRole` that matches multiple buttons. Use the `^...$`-anchored regexes already in the spec.
- If the preview server fails to start, check that `dist/` exists (Step 2).

- [ ] **Step 4: Commit**

```bash
git add e2e/cold-start.spec.ts
git commit -m "test: Playwright E2E for cold-start scenarios (PR5 of #47)"
```

---

## Task 4: Add CI workflow

**Files:**
- Create: `.github/workflows/test.yml`

- [ ] **Step 1: Create the workflow**

Create `.github/workflows/test.yml` with this exact content:

```yaml
name: Test

on:
  pull_request:
    branches: [master]

env:
  NODE_VERSION: 24

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm
      - run: npm ci
      - run: npm run check

  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm
      - run: npm ci
      - run: npm run lint

  vitest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm
      - run: npm ci
      - run: npm test

  playwright:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: npm
      - run: npm ci
      - name: Cache Playwright browsers
        uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: playwright-${{ runner.os }}-${{ hashFiles('package-lock.json') }}
      - name: Install Playwright Chromium
        run: npx playwright install --with-deps chromium
      - run: npm run build
      - run: npm run test:e2e
      - name: Upload test report
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7
```

- [ ] **Step 2: Validate YAML syntax**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/test.yml'))" 2>&1 || echo "OK if no python: skip"`
Expected: no output (valid YAML), or "OK if no python: skip" — either is acceptable. If yaml errors, fix the file.

- [ ] **Step 3: Verify the workflow file is in the right place**

Run: `ls -la .github/workflows/`
Expected: lists both `main.yml` (existing CD workflow) and `test.yml` (new PR-gate workflow).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/test.yml
git commit -m "ci: PR-gate workflow with check / lint / vitest / playwright (PR5 of #47)"
```

---

## Task 5: Update §14 grammar in `docs/execution-model.md`

**Files:**
- Modify: `docs/execution-model.md`

- [ ] **Step 1: Read §14 to confirm structure**

Read `docs/execution-model.md` lines 458–490.

- [ ] **Step 2: Add `E-` row to the prefix table**

After the `C-` row (added in PR4), insert a new row:

```
| `E-` | end-to-end scenarios — full UI flow including worker round-trip. Format `E-<from-state-or-context>-<facet>`, e.g. `E-cold-start-run-debug-off`. Used in `e2e/*.spec.ts`. |
```

- [ ] **Step 3: Update the `<topic>` row to include the e2e file**

Locate the `<topic>` row (PR4 left it as `(R / C)`). Update its slot label from `(R / C)` to `(R / C / E)` and append:

```
 `e2e/cold-start.spec.ts`: `cold-start`, `continue-from-step`, `stop-while-paused`.
```

- [ ] **Step 4: Update the regex line**

Change `\b[SRC]-[a-z-]+` to `\b[SRCE]-[a-z-]+`. Update prose from "All three prefixes" to "All four prefixes".

- [ ] **Step 5: Commit**

```bash
git add docs/execution-model.md
git commit -m "docs: register E- prefix for E2E test scenarios (PR5 of #47)"
```

---

## Task 6: Sync `CLAUDE.md` + `README.md` + final verification

**Files:**
- Modify: `CLAUDE.md`
- Modify: `README.md`

- [ ] **Step 1: Update `CLAUDE.md` Commands section**

Locate the Commands section (around lines 7–17). After the `test:coverage` line, add:

```
- `npm run test:e2e` — Playwright E2E (Chromium; runs `vite preview` automatically)
- `npm run test:e2e:ui` — Playwright interactive mode for local debugging
```

- [ ] **Step 2: Add `e2e/` and `playwright.config.ts` to the CLAUDE.md tree**

In the Architecture tree (around lines 18–53), add after the `└── theme.svelte.ts` line (so outside `src/`):

```
e2e/
├── cold-start.spec.ts          Playwright E2E — 4 scenarios (cites E-cold-start-...)
playwright.config.ts            Chromium project; webServer runs `npm run preview`
.github/workflows/
├── main.yml                    CD: build + rsync to VPS on push to master
└── test.yml                    PR gate: check / lint / vitest / playwright
```

(The `e2e/` and `playwright.config.ts` entries land inside the same `\`\`\`...\`\`\`` code block as the `src/` tree, but at the same indentation as the top-level `src/`.)

- [ ] **Step 3: Add a Conventions note about `data-testid`**

In CLAUDE.md's Conventions section (search for "## Conventions"), add a bullet:

```
- **Selector convention for E2E**: buttons use accessible names (already exposed via text content); non-button DOM (tape cells, log entries, container wrappers) uses `data-testid` attributes. Tape cells additionally carry `data-blank` for the blank-flag distinction.
```

- [ ] **Step 4: Update `README.md` scripts section**

In `README.md`, locate the Scripts block. Add after `npm run test:coverage`:

```sh
npm run test:e2e        # Playwright E2E (Chromium; runs `vite preview` automatically)
npm run test:e2e:ui     # Playwright interactive mode for local debugging
```

- [ ] **Step 5: Add `e2e/` to the README.md Layout tree**

In README.md's Layout section, add after the `theme.svelte.ts` line and before the closing `\`\`\``:

```
e2e/
├── cold-start.spec.ts            # Playwright E2E — 4 cold-start scenarios
playwright.config.ts              # Chromium project; webServer = vite preview
```

- [ ] **Step 6: Final pipeline verification**

Run: `npm run check && npm run lint && npm test && npm run build && npm run test:e2e`
Expected: all five exit 0; 56 unit tests, 4 E2E tests; build emits `dist/`.

- [ ] **Step 7: Verify scenario IDs**

Run: `grep -oE '\bE-[a-z-]+' e2e/cold-start.spec.ts | sort -u | wc -l`
Expected: `4` (each unique `E-<facet>` ID appears once).

- [ ] **Step 8: Verify production-side change scope**

Run: `git diff master..HEAD --stat src/`
Expected: only `src/components/Tape.svelte`, `src/components/Log.svelte`, `src/components/TapesStack.svelte` modified — and the diff is purely attribute additions (no behavior changes). No `src/lib/` files modified.

- [ ] **Step 9: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: register e2e/ + Playwright + test workflow (PR5 of #47)"
```

---

## Self-review (after T6)

1. **All 4 PR5 `test()` names match `\bE-[a-z-]+: <text>`.** All 4 are `E-`-prefixed, unique.
2. **Production diff is attribute-only.** `git diff master..HEAD -- src/components/Tape.svelte src/components/Log.svelte src/components/TapesStack.svelte` shows only `data-testid` / `data-blank` / `data-kind` additions — no logic changes.
3. **Unit-test count unchanged.** `npm test` still reports 56.
4. **E2E test count = 4.** `npm run test:e2e` reports `4 passed`.
5. **Build still passes.** `npm run build` exits 0.
6. **No CD workflow changes.** `.github/workflows/main.yml` untouched. The new `test.yml` is additive.
7. **Workflow file is valid YAML.** Either `python3 -c "import yaml; ..."` succeeds, or `actionlint` (if installed) reports zero errors.

Fix any issues inline before declaring done.
