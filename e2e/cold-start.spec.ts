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
    const cells = await page.getByTestId('tape').first().getByTestId('tape-cell').allInnerTexts();
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
    // Wait for the paused log entry to flush before snapshotting the baseline.
    // executionMode flips synchronously (Continue button becomes visible
    // immediately) but `log.report` is buffered behind LogStore's 16ms timer;
    // without this wait, pausedBefore can race-snapshot 0 instead of 1.
    await expect(
      page.getByTestId('log-line').filter({ hasText: /^paused at/ }),
    ).toBeVisible();

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

  test('E-cold-start-pause-during-auto: Step in RUNNING_AUTO synthesizes a paused with the live state name', async ({ page }) => {
    // Default interval (1s) gives a wide throttle window between iters so the
    // synthetic Pause click can land mid-throttle reliably.
    await page.getByRole('checkbox', { name: /^with pause$/i }).check();
    await page.getByRole('button', { name: /^run$/i }).click();

    // RUNNING_AUTO is logged at run-start; first iter logs via onIter.
    await expect(
      page.getByTestId('log-line').filter({ hasText: /^running, auto-stepping/ }),
    ).toBeVisible({ timeout: 2_000 });
    await expect(
      page.getByTestId('log-line').filter({ hasText: /^step 1:/ }),
    ).toBeVisible({ timeout: 3_000 });

    // Step doubles as Pause in RUNNING_AUTO — sends a `pause` request; the
    // worker cancels the throttle and dispatches a synthetic `paused` from
    // inside the next onStep. The "after applying command" phrasing falls out
    // of debugBreak={} (the renderer falls back to "after" when neither
    // before/after is set).
    await page.getByRole('button', { name: /^step$/i }).click();

    // The state name must be a non-empty token — proves the fix for
    // `state: '' → m.state.name ?? ''`. State names in the default example
    // are engine-assigned (e.g. "id:N") so accept any non-whitespace run.
    await expect(
      page.getByTestId('log-line').filter({
        hasText: /^paused at state \S+ after applying command for symbols:/,
      }),
    ).toBeVisible({ timeout: 3_000 });

    // RUNNING_PAUSED chrome: Run flips to Continue, Stop stays visible.
    await expect(page.getByRole('button', { name: /^continue$/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /^stop$/i })).toBeVisible();
  });

  test('E-paused-toggle-withpause-then-continue: toggling with-pause on between pause and Continue enters auto mode', async ({ page }) => {
    // Cold-start Step + debug = reach RUNNING_PAUSED via the engine's armed
    // .after on iter 1 (same as E-cold-start-step-debug-on).
    await page.getByRole('checkbox', { name: /^debug$/i }).check();
    await page.getByRole('button', { name: /^step$/i }).click();
    await expect(page.getByRole('button', { name: /^continue$/i })).toBeVisible();

    // While paused, configVisible is true → with-pause + interval are
    // editable. Flip with-pause on, set a fast interval so the halt arrives
    // within the test budget.
    const withPause = page.getByRole('checkbox', { name: /^with pause$/i });
    await expect(withPause).toBeVisible();
    await withPause.check();
    await page.getByPlaceholder('1s').fill('100ms');

    // Continue must carry the new withPause/intervalMs to the worker (spec §3:
    // withPause is read at click time, not run-start) — the resume worker
    // request must include intervalMs. Protocol-level passthrough is asserted
    // by R-resume-intervalms-on; this test just verifies the end-to-end wiring
    // doesn't leave the user stuck in PAUSED.
    await page.getByRole('button', { name: /^continue$/i }).click();

    // Run-label flips synchronously with the mode change in doRun, so the
    // disappearance of the "Continue" button is a deterministic signal that
    // we exited RUNNING_PAUSED (mode-flip race isn't an issue because doRun
    // sets executionMode before the worker round-trip).
    await expect(page.getByRole('button', { name: /^continue$/i })).not.toBeVisible();
    await expect(page.getByRole('button', { name: /^run$/i })).toBeVisible();

    // At 100ms intervals the default example halts within a few hundred ms.
    await expect(
      page.getByTestId('log-line').filter({ hasText: /halted after \d+ step\(s\)/ }),
    ).toBeVisible({ timeout: 5_000 });

    // HALTED restores configVisible — with-pause checkbox is back.
    await expect(withPause).toBeVisible();
  });

  test('E-stop-while-paused: Stop while paused halts; Run/Step stay enabled', async ({ page }) => {
    await page.getByRole('checkbox', { name: /^debug$/i }).check();
    await page.getByRole('button', { name: /^step$/i }).click();
    await expect(page.getByRole('button', { name: /^continue$/i })).toBeVisible();

    // Stop returns the machine to MANUAL with workerLive=true: Run/Step stay
    // clickable so the user can keep poking the same machine state.
    await expect(page.getByRole('button', { name: /^stop$/i })).toBeVisible();
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
