import { test, expect } from '@playwright/test';

test.describe('landing', () => {
  test('renders snippet panels on /', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Turing & Post machines/ })).toBeVisible();
    await expect(page.locator('.snippet-panel')).toHaveCount(1); // one placeholder per engine; phase-1 default = turing
  });

  test('engine switch updates URL and panels', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Post snippets/ }).click();
    await expect(page).toHaveURL(/\?engine=post/);
    await expect(page.locator('.snippet-panel')).toHaveCount(1);
  });

  test('deep link to editor opens the example', async ({ page }) => {
    await page.goto('/');
    const link = page.getByRole('link', { name: /Open in editor/ });
    await link.click();
    await expect(page).toHaveURL(/\/turing\?example=/);
    // MachineView visible
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
