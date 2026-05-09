# Test infrastructure — PR5 (Playwright E2E + CI gate) — design

Tracks: [#47](https://github.com/mellonis/machines-demo/issues/47) (test infrastructure). PR5 of a 5-PR series. Builds on PR1 (#55), PR2 (#56), PR3 (#57), PR4 (#58).

## Problem

PR1–PR4 covered the runner protocol, worker helpers, and Toolbar component derivations — but only at the unit boundary. The full worker round-trip (postMessage → `new Function()` user code → engine yields → tape commands → main-thread mirror replay → DOM) has no automated coverage. Issue #47 scope item 5 enumerates four flows where the round-trip plus DOM both matter; if any one breaks, the demo silently regresses (passes type-check, lint, all unit tests). The Step-semantics regression that motivated #47 in the first place is the canonical example — Vitest + Toolbar tests would not have caught it.

PR5 adds those four E2E scenarios via Playwright, adds `data-testid` attributes to the few non-button DOM elements the tests query, and introduces the project's first CI test gate (a new `pull_request` workflow that runs check + lint + Vitest + Playwright). The existing CD workflow on master push is unchanged — the PR gate adds a feedback layer in front of it without slowing deploys.

## Decisions

- **Scope: 4 scenarios, default Turing example only.** Issue #47's literal list. No Post-engine duplicates (the worker contract is identical; doubling for redundant signal violates "Keep this minimal — E2E is expensive to maintain"). No smoke test (the 4 scenarios already cover catastrophic failure modes — page mounts, worker spawns, log renders).
- **Browser: Chromium only.** Playwright's default project. The demo has no Safari- or Firefox-specific concerns; multi-browser tripling adds maintenance for no expected signal. Reconsider when a real cross-browser issue surfaces.
- **Server: `vite preview` (built bundle), not `vite dev`.** Tests the artifact users actually load. Matches the production CSP, the hashed asset paths, the worker spawn from the built file. `npm run preview` is the existing script; Playwright's `webServer` config block runs it before the tests.
- **CI: PR-gate workflow** (`.github/workflows/test.yml`, triggered on `pull_request`). Existing CD workflow on `push: master` stays separate. Four jobs: `check`, `lint`, `vitest`, `playwright` — separate jobs so a failure on one diagnoses in parallel rather than blocking the others. The Vitest + Playwright runs are the first automated test gate the project has.
- **Selectors: `data-testid` for non-button DOM** (Tape cells, Log lines, container wrappers). Buttons keep their accessible names — Toolbar already exposes them and Playwright's `getByRole` handles them natively. Test IDs decouple tests from CSS-class refactors; the production noise is small (one attribute per element family) and explicit.
- **Test directory: `e2e/` at repo root.** Separate from Vitest's `src/**/*.test.ts`. Playwright's default convention. `vitest.config.ts`'s `include` already excludes `e2e/`; nothing to configure on the Vitest side.
- **Scenario IDs: `E-<scenario>` prefix.** Registered in `docs/execution-model.md` §14 alongside existing `S-` / `R-` / `C-`. Format `E-<from-state-or-context>-<flag-or-action>`, e.g. `E-cold-start-run-debug-off`. The scenarios already correspond to spec walk-throughs in §10; the `E-` IDs are independent of those `S-` IDs because tests at this layer assert UI-observable outcomes, not state-machine transitions per se.
- **No watch mode for Playwright.** Local-iteration UX is `npx playwright test --ui` (Playwright's interactive mode); a `test:e2e` npm script wraps `playwright test` for one-shot runs. No `test:e2e:watch` script.

## File map

| File | Change |
|---|---|
| `package.json` | **Modify** — add `@playwright/test` to devDeps; add `test:e2e` and `test:e2e:ui` npm scripts. |
| `playwright.config.ts` | **Create** — Chromium project, `webServer` block running `npm run preview`, `testDir: './e2e'`, traces on first retry. |
| `e2e/cold-start.spec.ts` | **Create** — 4 tests covering the issue-#47 scenarios. ~150 lines. |
| `src/components/Tape.svelte` | **Modify** — add `data-testid="tape-cell"` + `data-blank` to each cell; add `data-testid="tape"` to the per-tape wrapper. |
| `src/components/Log.svelte` | **Modify** — add `data-testid="log-line"` + `data-kind` to each line; `data-testid="log"` to the panel. |
| `src/components/TapesStack.svelte` | **Modify** — add `data-testid="tapes-stack"` to the stack container. |
| `.github/workflows/test.yml` | **Create** — `pull_request` trigger; jobs `check`, `lint`, `vitest`, `playwright`. |
| `docs/execution-model.md` | **Modify** — §14 grammar registers `E-` prefix; updates regex to `\b[SRCE]-[a-z-]+`. |
| `CLAUDE.md` | **Modify** — list new scripts, `e2e/` directory, Playwright config; mention `data-testid` selectors as the convention for non-button DOM. |
| `README.md` | **Modify** — same drift sync. |
| `.gitignore` | **Modify** — add `playwright-report/`, `test-results/`, `blob-report/`. |
| `vitest.config.ts` | **No change** — `include: ['src/**/*.test.ts']` already excludes `e2e/`. |

No other production source files modified. The `data-testid` additions are non-functional and don't affect rendering, accessibility, or behavior.

## Test layout

`e2e/cold-start.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

test.describe('cold-start', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/turing');
    // Wait for the page mount to settle (DEMO mode auto-runs but doesn't block clicks).
    await expect(page.getByTestId('tapes-stack')).toBeVisible();
  });

  test('E-cold-start-run-debug-off: Run advances tape, halt logged', async ({ page }) => {
    // ... see scenario-detail section below
  });

  test('E-cold-start-step-debug-on: Step+debug=on parks at iter-1', async ({ page }) => { ... });

  test('E-continue-from-step: Continue (debug=off) runs to halt', async ({ page }) => { ... });

  test('E-stop-while-paused: Stop while paused halts; Run/Step stay enabled', async ({ page }) => { ... });
});
```

## Scenarios — full detail

### `E-cold-start-run-debug-off`

```ts
test('E-cold-start-run-debug-off: Run advances tape, halt logged', async ({ page }) => {
  await page.getByRole('button', { name: /^run$/i }).click();
  await expect(page.getByTestId('log-line').filter({ hasText: /halted after \d+ step\(s\)/ })).toBeVisible({ timeout: 10_000 });
  // Default Turing example transforms ['a','b','c','b','a'] → ['a','*','c','*','a']
  // (head ends on 'a' at position 4 after the trailing-blank → halt transition).
  // Tape.svelte renders VIEWPORT_WIDTH=23 cells per tape; assert the * count among them.
  const cells = await page.getByTestId('tape-cell').allInnerTexts();
  expect(cells.filter((s) => s === '*').length).toBe(2);
});
```

### `E-cold-start-step-debug-on`

```ts
test('E-cold-start-step-debug-on: Step+debug=on parks at iter-1 with state info', async ({ page }) => {
  await page.getByRole('checkbox', { name: /^debug$/i }).check();
  await page.getByRole('button', { name: /^step$/i }).click();
  // Cold-start Step always uses the run-mode `after`-trick; with debug=on the
  // user-set breaks would also fire, but the example has none — the after-trick
  // pause is what surfaces.
  await expect(
    page.getByTestId('log-line').filter({ hasText: /paused at .* state .* after applying command for symbols:/ }),
  ).toBeVisible({ timeout: 5_000 });
  // Run button relabels to "Continue" while paused.
  await expect(page.getByRole('button', { name: /^continue$/i })).toBeVisible();
});
```

### `E-continue-from-step`

```ts
test('E-continue-from-step: Continue (debug=off) runs to halt without further pauses', async ({ page }) => {
  // Reach the paused state via the same flow as #2.
  await page.getByRole('checkbox', { name: /^debug$/i }).check();
  await page.getByRole('button', { name: /^step$/i }).click();
  await expect(page.getByRole('button', { name: /^continue$/i })).toBeVisible();

  // Snapshot pre-Continue paused-line count so we can detect spurious additional pauses later.
  const pausedBefore = await page.getByTestId('log-line').filter({ hasText: /^paused at/ }).count();

  // Toggle debug off, then Continue.
  await page.getByRole('checkbox', { name: /^debug$/i }).uncheck();
  await page.getByRole('button', { name: /^continue$/i }).click();
  await expect(
    page.getByTestId('log-line').filter({ hasText: /halted after \d+ step\(s\)/ }),
  ).toBeVisible({ timeout: 10_000 });

  // No extra "paused" lines added between Continue click and halt.
  const pausedAfter = await page.getByTestId('log-line').filter({ hasText: /^paused at/ }).count();
  expect(pausedAfter).toBe(pausedBefore);
});
```

### `E-stop-while-paused`

```ts
test('E-stop-while-paused: Stop while paused halts; Run/Step stay enabled', async ({ page }) => {
  await page.getByRole('checkbox', { name: /^debug$/i }).check();
  await page.getByRole('button', { name: /^step$/i }).click();
  await expect(page.getByRole('button', { name: /^continue$/i })).toBeVisible();

  // Click Stop. Per execution-model spec: Stop returns to MANUAL with workerLive=true,
  // so Run/Step stay clickable for the user to keep poking the same machine state.
  await page.getByRole('button', { name: /^stop$/i }).click();
  await expect(page.getByTestId('log-line').filter({ hasText: /^stopped/ })).toBeVisible();

  // After Stop, Run-button reverts to "Run" (no longer paused) and is enabled;
  // Step is enabled too. Stop button itself disappears (stopVisible is false in MANUAL).
  await expect(page.getByRole('button', { name: /^run$/i })).toBeEnabled();
  await expect(page.getByRole('button', { name: /^step$/i })).toBeEnabled();
  await expect(page.getByRole('button', { name: /^stop$/i })).not.toBeVisible();
});
```

## `playwright.config.ts`

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

`vite preview` defaults to `127.0.0.1:4173`. `reuseExistingServer` lets local iteration leave the server up across runs.

## `package.json` additions

`devDependencies`: `"@playwright/test": "^1.50.0"`.

`scripts`:
- `"test:e2e": "playwright test"` — one-shot, used in CI.
- `"test:e2e:ui": "playwright test --ui"` — Playwright's interactive mode for local debugging.

## `.github/workflows/test.yml`

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

The Vitest job runs only `npm test` (Vitest); it does not run Playwright. The Playwright job builds first (so `vite preview` has `dist/` to serve) then runs `test:e2e`. On failure, the HTML report is uploaded as an artifact for diagnosis.

## `data-testid` additions — exact placement

**`src/components/Tape.svelte`** (around line 90–106):

- The outer `.ui-belt` wrapper gains `data-testid="tape"`.
- The inner `.cell` gains `data-testid="tape-cell"` + `data-blank={cell.blank}`.

**`src/components/Log.svelte`** (around line 21–55):

- `.log-panel` gains `data-testid="log"`.
- `.line` gains `data-testid="log-line"` + `data-kind={entry.kind ?? ''}`.

**`src/components/TapesStack.svelte`** (root container):

- The stack root gains `data-testid="tapes-stack"`.

These are the only DOM additions. No CSS class changes, no element restructuring, no new wrappers introduced.

## §14 grammar update (`docs/execution-model.md`)

Existing prefix table after PR4:

| `S-` | UI-scenario reference. |
| `R-` | runner / worker / helper internal. |
| `C-` | component-test scenarios. |

After PR5, add:

| `E-` | end-to-end scenarios — full UI flow including worker round-trip. Format `E-<from-state-or-context>-<facet>`, e.g. `E-cold-start-run-debug-off`. Used in `e2e/*.spec.ts`. |

`<topic>` row gains: `e2e/cold-start.spec.ts`: `cold-start`, `continue-from-step`, `stop-while-paused`.

Regex line: change `\b[SRC]-[a-z-]+` to `\b[SRCE]-[a-z-]+`. Prose: change "All three prefixes" to "All four prefixes".

## Self-review

After implementation:

1. **All 4 PR5 `test()` names match `\bE-[a-z-]+: <text>` pattern.** All 4 scenario IDs unique.
2. **No production-side functional changes.** `data-testid` additions are accessibility-neutral and don't affect rendering. `git diff master..HEAD -- src/lib/` empty (only `src/components/Tape.svelte`, `Log.svelte`, `TapesStack.svelte` touched, and only with attribute additions).
3. **All 56 unit tests still pass.** `data-testid` additions don't break `Toolbar.test.ts` (it queries by role, not testid).
4. **`npm run test:e2e` exits 0** locally (with built `dist/`). Test count = 4.
5. **CI workflow runs all four jobs in parallel** on a representative test PR.
6. **`.gitignore` excludes** `playwright-report/`, `test-results/`, `blob-report/`.

## Out of scope

- **Post engine E2E** — worker contract identical to Turing; signal redundancy.
- **Multi-browser matrix** — Chromium only until a real cross-browser issue surfaces.
- **Visual regression** — separate concern; tools like Chromatic / Percy are heavy.
- **Accessibility audits** (axe-core via `@axe-core/playwright`) — worth doing but a separate PR.
- **CD workflow change** — existing `main.yml` stays as-is. Adding test gating to deploys is a follow-up; for now the PR-gate catches issues before merge.
- **Visual coverage of the snippets / examples / save-popover flows** — covered indirectly via Playwright if they break the build, but no targeted scenarios; component-test PR or future E2E batch.
- **Test-result publication / dashboards** — the GitHub-action HTML upload-on-failure is sufficient; no third-party reporter integration.
