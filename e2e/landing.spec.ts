import { test, expect } from '@playwright/test';

test.describe('landing', () => {
  test('renders snippet panels on /', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Turing & Post machines/ })).toBeVisible();
    // Four curated showcase examples per engine (simple / moderate / composed /
    // abort); default = turing.
    await expect(page.locator('.snippet-panel')).toHaveCount(4);
  });

  test('engine switch updates URL and panels', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Post snippets/ }).click();
    await expect(page).toHaveURL(/\?engine=post/);
    await expect(page.locator('.snippet-panel')).toHaveCount(4);
  });

  test('deep link to editor opens the example', async ({ page }) => {
    await page.goto('/');
    // Use the first panel's deep-link explicitly — there are now 4 per engine.
    const link = page.getByRole('link', { name: /Open in editor/ }).first();
    await link.click();
    // MachineView mounts at /turing; Phase 2's boot-priority handler consumes
    // the ?example=<id> param then strips it via history.replaceState (matches
    // the existing ?snippet=<id> lifecycle), so the URL settles back to /turing.
    await expect(page).toHaveURL('/turing');
    await expect(page.locator('[data-testid="tape-cell"]').first()).toBeVisible();
  });

  test('header tab navigates from landing', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Turing', exact: true }).click();
    await expect(page).toHaveURL('/turing');
  });

  test('scroll triggers playback', async ({ page }) => {
    await page.goto('/');
    const panel = page.locator('.snippet-panel').first();
    await panel.scrollIntoViewIfNeeded();
    // After intervalMs * frames + epsilon, the panel reaches done state
    await expect(panel.getByRole('button', { name: /Replay/ })).toBeVisible({ timeout: 10_000 });
  });
});
