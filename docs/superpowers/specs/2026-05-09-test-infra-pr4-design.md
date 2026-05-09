# Test infrastructure — PR4 (Toolbar component tests) — design

Tracks: [#47](https://github.com/mellonis/machines-demo/issues/47) (test infrastructure). PR4 of an expected 5-PR series. Builds on PR1 (#55), PR2 (#56), PR3 (#57).

## Problem

PR1–PR3 covered `machineRunner` and `workerHelpers` — the worker-protocol and pure-helper layers. The component layer is still untested. Issue #47 scope item 4 specifies `Toolbar` component tests via `@testing-library/svelte` covering three behaviors: `runLabel` derivation, button-disabled flag reflection, and the debug-checkbox wiring. None of those are exercised today; a Toolbar regression (e.g., a wrong `executionMode` branch in `runLabel`, a button forgetting its disabled binding) would ship through `svelte-check` and `eslint` without complaint.

PR4 adds Toolbar component tests at the issue's literal scope. Popovers (examples menu, save dialog, snippets dropdown), keyboard shortcuts, and snippet-related callbacks are deferred — they introduce `document`-listener teardown semantics that are more naturally covered by Playwright in PR5. MachineView is also out of scope for this PR.

## Decisions

- **Scope: Toolbar core only.** No popovers, no save dialog, no snippets dropdown. The disabled-flag *derivation* (`stepDisabled`/`runDisabled` from `(mode, halted, workerLive, pendingOp, withPause, intervalIsValid)`) lives in `MachineView.svelte`, not Toolbar; from Toolbar's perspective those are pass-through props. Tests assert that Toolbar correctly *reflects* each prop on the right DOM element, which is what the issue's bullet means in the post-PR1 architecture.
- **DOM library: happy-dom.** Lighter and faster than jsdom, well-supported by `@testing-library/svelte`. If we hit an obscure DOM-API gap we can swap to jsdom later — both expose the same Testing Library surface.
- **Vitest config: per-file pragma, not `projects`.** A single `// @vitest-environment happy-dom` comment at the top of `Toolbar.test.ts` keeps DOM scoped to component tests without restructuring the config. Vitest 4 deprecated `environmentMatchGlobs` in favor of `projects`; we'll move to `projects` only when there are enough component tests to justify the structure (YAGNI for one file).
- **`@testing-library/jest-dom` matchers via `setupFiles`.** Adds `toBeDisabled()`, `toBeChecked()`, `toBeInTheDocument()`, etc. — meaningfully clearer than raw DOM-property assertions. Wired through a one-line `vitest.setup.ts` referenced from `vitest.config.ts`.
- **No `@testing-library/user-event`.** Plain `fireEvent.click` covers the click → callback assertions; user-event matters more for keyboard-driven flows (popovers, shortcuts) which are out of scope.
- **Bindable props (`withPause`, `debugMode`, `intervalText`) are NOT tested for binding propagation.** Trusting Svelte's `bind:` plumbing is appropriate — testing it would test the framework, not our code. Tests assert the rendered `checked` / `value` reflect the prop in both directions of the input space; outbound propagation is implied by the binding itself.
- **`defaultProps()` helper at top of test file.** Toolbar has 18 props; spreading `{ ...defaultProps(), executionMode: 'RUNNING_PAUSED_AT_BREAK' }` per test keeps each test focused on its variable while making the full input shape obvious in one place.
- **Scenario IDs: `C-toolbar-<facet>` prefix** (Component-Toolbar). New prefix registered in `docs/execution-model.md` §14 grammar. Existing `R-` (runner / worker / helper internals) and `S-` (UI scenarios from the spec) prefixes are unchanged.
- **Coverage scoping unchanged for PR4.** `vitest.config.ts` keeps `coverage.include: ['src/lib/**/*.ts']`. Including `.svelte` files in v8 coverage requires Svelte source-mapping configuration that's worth its own decision and out of scope here. Test count is the deliverable.

## File map

| File | Change |
|---|---|
| `package.json` | **Modify** — add `@testing-library/svelte`, `@testing-library/jest-dom`, `happy-dom` to `devDependencies`. |
| `vitest.config.ts` | **Modify** — add `setupFiles: ['./vitest.setup.ts']` (one-line addition; environment stays `'node'` as the default). |
| `vitest.setup.ts` | **Create** — single line: `import '@testing-library/jest-dom/vitest';`. |
| `src/components/Toolbar.test.ts` | **Create** — 16 tests in 5 describe blocks, ~250 lines including `defaultProps()` helper. |
| `docs/execution-model.md` | **Modify** — extend §14 grammar's `<topic>` row to register `C-toolbar-<facet>` and any future `C-<component>-<facet>` prefixes. |
| `CLAUDE.md` | **Modify** — list `Toolbar.test.ts` in the components tree; mention `happy-dom` pragma in the testing conventions. |
| `README.md` | **Modify** — same drift-prevention as CLAUDE.md (component tree + test note). |

No production-side changes to `Toolbar.svelte`.

## Test layout

Single file `src/components/Toolbar.test.ts` with the per-file environment pragma and `defaultProps()` helper at the top:

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import Toolbar from './Toolbar.svelte';
import type { Example } from '../lib/defaultCode';
import type { Snippets } from '../lib/persist';

function defaultProps() {
  return {
    executionMode: 'DEMO' as const,
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
  describe('runLabel', () => { /* 4 tests */ });
  describe('disabled', () => { /* 4 tests */ });
  describe('visibility', () => { /* 4 tests */ });
  describe('interval', () => { /* 1 test */ });
  describe('callbacks', () => { /* 3 tests */ });
});
```

## `describe('runLabel')` — 4 tests

Covers the `runLabel` and Step-vs-Pause derivations. Representative subset of `executionMode` values, not all 7 — the derivations split on a single mode each.

1. **`C-toolbar-run-label-default`** — `executionMode='DEMO'`. Run button text is `'Run'`.
2. **`C-toolbar-run-label-paused`** — `executionMode='RUNNING_PAUSED_AT_BREAK'`. Run button text is `'Continue'`.
3. **`C-toolbar-step-label-default`** — `executionMode='DEMO'`. Step button text is `'Step'`.
4. **`C-toolbar-step-label-running-auto`** — `executionMode='RUNNING_AUTO'`. Step button text is `'Pause'` (paused-auto-step toggle).

Query pattern: `screen.getByRole('button', { name: /run|continue/i })` for Run; `getByRole('button', { name: /step|pause/i })` for Step. (Or by data attribute / text — the spec author can pick the cleanest accessible-name selector.)

## `describe('disabled')` — 3 tests

Covers prop reflection on `disabled` attributes.

1. **`C-toolbar-disabled-build`** — `loadDisabled={true}`. Build button has `disabled` attribute. Inverse case (`false` → not disabled) covered implicitly by the other tests using default `false`.
2. **`C-toolbar-disabled-step`** — `stepDisabled={true}`. Step button has `disabled` attribute.
3. **`C-toolbar-disabled-run-cascade`** — `runDisabled={true}` with `executionMode='DEMO'` (config row visible). Asserts Run button, with-pause checkbox, and debug checkbox are all disabled — they share the `runDisabled` prop. Single test with three assertions.

## `describe('visibility')` — 4 tests

Covers `configVisible` and `stopVisible` derivations.

1. **`C-toolbar-config-visible-demo`** — `executionMode='DEMO'`. with-pause checkbox, debug checkbox are present in the DOM.
2. **`C-toolbar-config-hidden-running-auto`** — `executionMode='RUNNING_AUTO'`. with-pause and debug checkboxes are absent. (Mid-run; config is meaningless.)
3. **`C-toolbar-stop-visible-running-step`** — `executionMode='RUNNING_STEP'`. Stop button is present.
4. **`C-toolbar-stop-hidden-halted`** — `executionMode='HALTED'`. Stop button is absent.

The `RUNNING_CONTINUOUS` (also hides config) and `RUNNING_PAUSED_AT_BREAK` (Stop visible) modes are covered by the other groups' coverage of the same `executionMode` values; no extra visibility-only tests needed.

## `describe('interval')` — 1 test

1. **`C-toolbar-interval-invalid`** — `executionMode='DEMO'`, `withPause={true}`, `intervalIsValid={false}`. Interval input has `class="invalid"` (or `.classList.contains('invalid')`).

## `describe('callbacks')` — 3 tests

One test per non-disabled action button click; verifies the right `on*` callback is invoked exactly once with no arguments.

1. **`C-toolbar-callback-build`** — `executionMode='DEMO'`. Click Build → `onBuild` called once.
2. **`C-toolbar-callback-step`** — `executionMode='DEMO'`. Click Step → `onStep` called once.
3. **`C-toolbar-callback-run-stop`** — Two-phase test. First phase: `executionMode='DEMO'`, click Run → `onRun` called once. Second phase: re-render with `executionMode='RUNNING_STEP'`, click Stop → `onStop` called once. Combined to keep the test count tight while exercising both run-channel callbacks.

## §14 grammar update (`docs/execution-model.md`)

Existing §14 row (after PR3):

> `machineRunner.test.ts`: `protocol`, `timer`, `pending`, `error`. `workerHelpers.test.ts`: `movement-code`, `commands`, `snapshot`, `phase-guard`, `step-arm`.

Updated row (after PR4):

> `machineRunner.test.ts`: `protocol`, `timer`, `pending`, `error`. `workerHelpers.test.ts`: `movement-code`, `commands`, `snapshot`, `phase-guard`, `step-arm`. `Toolbar.test.ts` (and other component tests): `C-<component>-<facet>` — e.g., `C-toolbar-run-label`, `C-toolbar-disabled`.

The grammar's prefix table also gains a `C-` row alongside `R-` (runner / worker / helper internals) and `S-` (UI scenarios from the spec).

## `vitest.config.ts` change

```diff
 export default defineConfig({
   test: {
     environment: 'node',
     globals: false,
     include: ['src/**/*.test.ts'],
+    setupFiles: ['./vitest.setup.ts'],
     coverage: {
       provider: 'v8',
       include: ['src/lib/**/*.ts'],
       exclude: ['src/lib/**/*.test.ts', 'src/lib/testUtils.ts'],
     },
   },
 });
```

`environment` stays `'node'`; happy-dom is opt-in per file via the pragma.

## `vitest.setup.ts` (new file, 1 line)

```ts
import '@testing-library/jest-dom/vitest';
```

The `/vitest` subpath registers matchers via Vitest's `expect.extend` automatically. Setup files run in every environment, but the matchers themselves only have observable effects in DOM environments (their checks operate on DOM nodes).

## `package.json` change

Add to `devDependencies`:

```jsonc
{
  "devDependencies": {
    // ...existing...
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/svelte": "^5.2.0",
    "happy-dom": "^15.11.0"
  }
}
```

Versions: `@testing-library/svelte` 5.x is the Svelte-5-compatible major; `@testing-library/jest-dom` 6.x is the current major; `happy-dom` 15.x is the current major. Pin to caret-minor as the rest of the project does.

## Self-review

After writing tests:

1. **Each PR4 `it()` name matches the `\bC-toolbar-[a-z-]+: <text>` pattern.** All 16 PR4 tests are `C-toolbar-`-prefixed.
   - Total `it()` count across all test files after PR4: 9 (PR1) + 16 (PR2) + 16 (PR3) + 16 (PR4) = 57.
   - `grep -oE '\bC-toolbar-[a-z-]+' src/components/Toolbar.test.ts | sort -u | wc -l` should return 16.
2. **No production code changed.** `git diff master..HEAD --stat src/components/Toolbar.svelte src/lib/` should show 0 changes (Toolbar.svelte and src/lib/ files untouched).
3. **All tests pass.** `npm test` exits 0; total test count = 57.
4. **`npm run check` passes.** Svelte 5 component imports type-check.
5. **`npm run lint` passes.** No new ESLint errors.
6. **Setup file works.** A test that uses a jest-dom matcher (e.g., `toBeDisabled()`) passes — confirms `setupFiles` wiring.

Fix any issues inline before declaring done.

## Out of scope

- **Examples menu, Save popover, Snippets dropdown** — popover state machines with `document` listeners; covered by PR5 Playwright (or a future component PR if needed).
- **Keyboard shortcuts (⌘S, ⌘⇧S)** — coupled to the save popover.
- **Snippet-related callbacks** (`onSaveSnippet`, `onSaveChanges`, `onLoadSnippet`, `onDeleteSnippet`, `onRenameSnippet`, `onPickExample`) — only fired from popovers.
- **MachineView component** — orchestrator with heavy `MachineRunner` / `localStorage` / `history` dependencies; the disabled-flag derivations it owns are testable as the props feeding into Toolbar (covered indirectly here) or extractable to a pure helper module in a future PR.
- **Other components** (TapesStack, Tape, ControlPanel, Editor, Log, IconButton).
- **Coverage of `.svelte` files** — requires Svelte source-mapping config for v8; separate decision.
- **Playwright E2E** — PR5.
