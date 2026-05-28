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
        hasText: /paused at .*state .* after applying command/,
      }),
    ).toBeVisible({ timeout: 5_000 });
    // Run button relabels to "Continue" while paused.
    await expect(page.getByRole('button', { name: /^continue$/i })).toBeVisible();
  });

  test('E-cold-start-step-with-pause-on: Step ignores intervalMs (manual action)', async ({ page }) => {
    // With-pause on + a deliberately slow interval (5s). If Step were
    // throttled, the paused log line would not appear for ~5s. The user's
    // intent: clicking Step is manual, the iter applies immediately, the
    // pause materializes right after. The interval matters only in
    // RUNNING_AUTO mode (between consecutive auto iters), not on the
    // Step iter.
    await page.getByRole('checkbox', { name: /^with pause$/i }).check();
    await page.getByPlaceholder('1s').fill('5s');
    const t0 = Date.now();
    await page.getByRole('button', { name: /^step$/i }).click();
    await expect(
      page.getByTestId('log-line').filter({ hasText: /^paused at state / }),
    ).toBeVisible({ timeout: 3_000 });
    const elapsed = Date.now() - t0;
    // Hard ceiling: 2s is generous (worker-roundtrip + render budget). If
    // Step starts throttling, this would be ≥5s and the test fails.
    expect(elapsed).toBeLessThan(2_000);
    await expect(page.getByRole('button', { name: /^continue$/i })).toBeVisible();
  });

  test('E-continue-from-step-with-pause-renders-iters: Continue after cold-start Step (withPause on) animates iters, not just halt', async ({ page }) => {
    // Reach RUNNING_PAUSED via cold-start Step (debug=on uses the engine's
    // armed .after on iter 1). Same flow as E-cold-start-step-debug-on but
    // also turn withPause on so Continue enters the throttled auto loop.
    await page.getByRole('checkbox', { name: /^debug$/i }).check();
    await page.getByRole('checkbox', { name: /^with pause$/i }).check();
    await page.getByPlaceholder('1s').fill('100ms');
    await page.getByRole('button', { name: /^step$/i }).click();
    await expect(page.getByRole('button', { name: /^continue$/i })).toBeVisible();
    await expect(
      page.getByTestId('log-line').filter({ hasText: /^paused at/ }),
    ).toBeVisible();

    // Snapshot log line counts before Continue. The auto-loop emits a
    // per-iter `step N:` line via onIter; the bug we're catching here was
    // those lines being dropped because doStep didn't register onIter on
    // the run Promise that Continue resumes.
    const stepLinesBefore = await page
      .getByTestId('log-line')
      .filter({ hasText: /^step \d+:/ })
      .count();

    await page.getByRole('button', { name: /^continue$/i }).click();
    await expect(
      page.getByTestId('log-line').filter({ hasText: /halted after \d+ step\(s\)/ }),
    ).toBeVisible({ timeout: 10_000 });

    // Per-iter step lines must have grown by ≥2 between resume and halt
    // (the default example takes more than 2 iters past iter 1). If onIter
    // was dropped, this count stays at the cold-start-Step value and the
    // test fails — the UI was getting the halt snap with no animation in
    // between, exactly the user-reported symptom.
    const stepLinesAfter = await page
      .getByTestId('log-line')
      .filter({ hasText: /^step \d+:/ })
      .count();
    expect(stepLinesAfter - stepLinesBefore).toBeGreaterThanOrEqual(2);

    // Final tape still correct (the halt-snap path was unaffected by the
    // bug; assert it for completeness, mirroring E-cold-start-run-debug-off).
    const cells = await page.getByTestId('tape').first().getByTestId('tape-cell').allInnerTexts();
    expect(cells.filter((s) => s === '*').length).toBe(2);
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

    // The run MUST still be in-flight at click time — if the throttle is
    // broken (e.g. engine doesn't await the worker's onIter), the run halts
    // before this click can land and the test below would "succeed" by
    // accidentally exercising the cold-start Step path from HALTED. Assert
    // the absence of the halt log line to fail loudly on that regression.
    await expect(
      page.getByTestId('log-line').filter({ hasText: /halted after/ }),
    ).not.toBeVisible();

    // Step doubles as Pause in RUNNING_AUTO — same button, icon + label
    // flip to a pause glyph and the word "Pause". Target by the rendered
    // label to assert it's actually labelled correctly AND enabled (this
    // button is what the user clicks to pause an auto run). The
    // "after applying command" phrasing falls out of a side-less pause
    // (cause: 'manual'); the renderer falls back to "after" when no side is set.
    await expect(page.getByRole('button', { name: /^pause$/i })).toBeEnabled();
    await page.getByRole('button', { name: /^pause$/i }).click();

    // The state name must be a non-empty token — proves the fix for
    // `state: '' → m.state.name ?? ''`. State names in the default example
    // are engine-assigned (e.g. "id:N") so accept any non-whitespace run.
    await expect(
      page.getByTestId('log-line').filter({
        hasText: /^paused at state \S+ after applying command/,
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
