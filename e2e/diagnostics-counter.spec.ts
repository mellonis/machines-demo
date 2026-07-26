import { test, expect, type Page } from '@playwright/test';

/**
 * Smoke coverage for the editor's diagnostics counter pills. The unit suite
 * (`src/lib/diagnosticsCounter.test.ts`) covers the tally logic against a
 * synthetic EditorState; these tests cover the wiring the unit specs cannot
 * reach — that a real lint source's diagnostics reach the pills through the
 * ViewPlugin, and that the counts fall back to zero when the code is fixed.
 */

/** One unclosed brace: exactly one Lezer error node, and nothing that the
 *  arg-count / cross-ref / unbound sources would flag (`a` is bound, and
 *  there are no call sites or bare identifier uses). */
const ONE_SYNTAX_ERROR = 'const a = 1;\n{\n';

/** Same code, brace closed — every lint source clean. */
const NO_ERRORS = 'const a = 1;\n';

function pill(page: Page, severity: 'error' | 'warning' | 'info') {
  return page.locator(`[data-testid="diag-pill"][data-severity="${severity}"]`);
}

/**
 * Replace the whole editor buffer. `insertText` is deliberate: `keyboard.type`
 * would run the input through CodeMirror's keymap, and the close-brackets
 * extension auto-inserts the matching `}` — which would repair the very syntax
 * error the test depends on.
 */
async function setEditorText(page: Page, text: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(text);
}

test.describe('diagnostics counter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/turing');
    // Wait for the app to mount and the editor to be interactive.
    await expect(page.getByTestId('tapes-stack')).toBeVisible();
    await expect(page.locator('.cm-content')).toBeVisible();
  });

  test('E-diag-error-pill-counts-syntax-error: unclosed brace surfaces E 1', async ({ page }) => {
    await setEditorText(page, ONE_SYNTAX_ERROR);

    // `linter()` debounces before it dispatches diagnostics, so the pill
    // appears a beat after the edit — Playwright's auto-retry covers the delay.
    await expect(pill(page, 'error')).toBeVisible({ timeout: 5_000 });
    await expect(pill(page, 'error')).toHaveAttribute('data-count', '1');
    await expect(pill(page, 'error')).toContainText('E');

    // The other two severities have no source emitting them here, and each pill
    // is hidden at count 0 — so their absence is the assertion.
    await expect(pill(page, 'warning')).toHaveCount(0);
    await expect(pill(page, 'info')).toHaveCount(0);
  });

  test('E-diag-pill-clears-when-fixed: closing the brace drops the pill', async ({ page }) => {
    // Round-trip. Asserting the pill appears proves the plugin runs; asserting
    // it goes away proves it recomputes on later transactions rather than
    // latching the first non-zero tally.
    await setEditorText(page, ONE_SYNTAX_ERROR);
    await expect(pill(page, 'error')).toBeVisible({ timeout: 5_000 });

    await setEditorText(page, NO_ERRORS);
    await expect(pill(page, 'error')).toHaveCount(0, { timeout: 5_000 });
    // The container stays mounted (it holds the flex row); only the pills go.
    await expect(page.getByTestId('diag-counter')).toBeAttached();
  });

  test('E-diag-unbound-error-counted: a non-syntax lint source also feeds the pills', async ({ page }) => {
    // The counter aggregates every installed source via forEachDiagnostic, not
    // just syntaxLinter. `movements` is syntactically fine but never destructured
    // from `imports`, so unboundLinter is the only source emitting here.
    await setEditorText(page, 'const x = movements.left;\n');

    await expect(pill(page, 'error')).toBeVisible({ timeout: 5_000 });
    await expect(pill(page, 'error')).toHaveAttribute('data-count', '1');
  });
});
