import { test, expect } from '@playwright/test';

test.describe('aborted outcome', () => {
  test('E-abort-turing-run: abort-validate logs the abort ending, backtrace, and abort log kind', async ({ page }) => {
    await page.goto('/turing?example=abort-validate');
    await expect(page.getByTestId('tapes-stack')).toBeVisible();

    await page.getByRole('button', { name: /^run$/i }).click();

    // The terminal line names the abort-triggering state and carries the
    // distinct 'abort' kind (drives the crimson dashed stripe + status tint).
    const abortLine = page
      .getByTestId('log-line')
      .filter({ hasText: /aborted at 'scanBits' after \d+ step\(s\)/ });
    await expect(abortLine).toBeVisible({ timeout: 10_000 });
    await expect(abortLine).toHaveAttribute('data-kind', 'abort');

    // Backtrace: the pending continuation ('accept') the aborted call would
    // have returned to.
    const backtraceLine = page
      .getByTestId('log-line')
      .filter({ hasText: /↳ accept/ });
    await expect(backtraceLine).toBeVisible();
    await expect(backtraceLine).toHaveAttribute('data-kind', 'abort');

    // No classical-halt line for this run.
    await expect(
      page.getByTestId('log-line').filter({ hasText: /halted after \d+ step\(s\)/ }),
    ).not.toBeVisible();
  });

  test('E-abort-terminal-highlight: after the aborted run the graph highlights the abort sentinel node', async ({ page }) => {
    await page.goto('/turing?example=abort-validate');
    await expect(page.getByTestId('tapes-stack')).toBeVisible();

    // The abort node renders with the engine's role class (classDef is
    // stripped; the `class s1 abortSentinel` directive survives) — its
    // presence proves the v7.1 emit made it through the demo pipeline.
    const abortNode = page.locator('g.node.abortSentinel');
    await expect(abortNode).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: /^run$/i }).click();
    await expect(
      page.getByTestId('log-line').filter({ hasText: /aborted at/ }),
    ).toBeVisible({ timeout: 10_000 });

    // Terminal abort highlight: strong TO on the abort node. This asserts
    // the whole id chain — worker finalStateId → deriveGraphHighlight's
    // toId -1 → visuals mermaidIdFor(-1) = 's1' → nodeCache keyed via
    // parseMermaidId.
    await expect(abortNode).toHaveClass(/mg-highlight-to/, { timeout: 5_000 });
    await expect(abortNode).toHaveClass(/mg-highlight-strong/);
  });

  test('E-abort-post-run: abort-guard (post) logs the abort ending with the instruction-level location', async ({ page }) => {
    await page.goto('/post?example=abort-guard');
    await expect(page.getByTestId('tapes-stack')).toBeVisible();

    await page.getByRole('button', { name: /^run$/i }).click();

    // Post names are instruction-derived (subroutine-scoped path for the
    // abort instruction inside 'expectMark').
    const abortLine = page
      .getByTestId('log-line')
      .filter({ hasText: /aborted at '[^']+' after \d+ step\(s\)/ });
    await expect(abortLine).toBeVisible({ timeout: 10_000 });
    await expect(abortLine).toHaveAttribute('data-kind', 'abort');

    // Post backtrace: the abort site's instruction-level arrival path.
    await expect(
      page.getByTestId('log-line').filter({ hasText: /↳ .*expectMark/ }),
    ).toBeVisible();
  });

  test('E-halt-highlight-plumbing: paused run highlights the current state node under the v7.1 id scheme', async ({ page }) => {
    // Regression net for the mermaid id migration (uN user states): a
    // before-side step pause must light the paused state's node. Uses the
    // default example (no abort involved) so a plumbing break isn't masked
    // by abort-specific paths.
    await page.goto('/turing');
    await expect(page.getByTestId('tapes-stack')).toBeVisible();

    await page.getByRole('button', { name: /^step$/i }).click();
    await expect(
      page.getByTestId('log-line').filter({ hasText: /^paused at/ }),
    ).toBeVisible({ timeout: 10_000 });

    // Some node carries the strong highlight — nodeCache resolved the
    // engine id through the new uN DOM ids. Generous timeout: the mermaid
    // + ELK lazy-load can ride inside this wait on cold CI runners.
    await expect(page.locator('g.node.mg-highlight-strong').first()).toBeVisible({ timeout: 15_000 });
  });
});
