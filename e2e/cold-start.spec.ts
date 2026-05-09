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
