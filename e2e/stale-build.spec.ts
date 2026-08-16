import { test, expect } from '@playwright/test';

// Stale-build notice: the Build button carries an accent
// dot (class `stale`) whenever the editor text differs from the source of
// the last successful Build — edits, snippet/example loads — and clears on
// the next successful Build. A failed Build keeps the dot: the last built
// machine is still the one behind the graph/tape view.
test.describe('stale-build notice', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/turing');
    // Wait for the initial auto-build to land: default Turing example puts
    // 'a' on the tape.
    await expect(
      page.getByTestId('tape').first().getByTestId('tape-cell').filter({ hasText: 'a' }).first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  test('E-stale-build-edit-shows-dot: typing after the boot build marks Build stale', async ({ page }) => {
    const build = page.getByRole('button', { name: /^build$/i });
    await expect(build).not.toHaveClass(/stale/);

    await page.locator('.cm-content').click();
    // Platform-safe jump to document end: select-all, collapse to the right.
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type('\n// tweak');

    await expect(build).toHaveClass(/stale/);
  });

  test('E-stale-build-rebuild-clears: a successful Build clears the dot', async ({ page }) => {
    const build = page.getByRole('button', { name: /^build$/i });
    await page.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.type('\n// tweak');
    await expect(build).toHaveClass(/stale/);

    await build.click();
    await expect(
      page.getByTestId('log-line').filter({ hasText: 'loaded — ready' }).last(),
    ).toBeVisible({ timeout: 5_000 });
    await expect(build).not.toHaveClass(/stale/);
  });

  test('E-stale-build-example-load-shows-dot: loading another example marks Build stale', async ({ page }) => {
    const build = page.getByRole('button', { name: /^build$/i });
    await expect(build).not.toHaveClass(/stale/);

    await page.getByRole('button', { name: 'Example code sources' }).click();
    await page.getByRole('menuitem', { name: 'Toggle bits (0 ↔ 1)' }).click();

    await expect(build).toHaveClass(/stale/);
  });

  test('E-stale-build-failed-build-keeps-dot: a failed Build leaves the dot on', async ({ page }) => {
    const build = page.getByRole('button', { name: /^build$/i });
    await page.locator('.cm-content').click();
    // Typing over the select-all replaces the whole document.
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type("throw new Error('boom');");
    await expect(build).toHaveClass(/stale/);

    await build.click();
    await expect(
      page.locator('[data-testid="log-line"][data-kind="error"]').filter({ hasText: 'boom' }).last(),
    ).toBeVisible({ timeout: 5_000 });
    await expect(build).toHaveClass(/stale/);
  });
});
