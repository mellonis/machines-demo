import { test, expect } from '@playwright/test';

test.describe('smart completions', () => {
  test('E-completions-movements-member', async ({ page }) => {
    await page.goto('/turing');
    const editor = page.locator('.cm-content');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\nmovements.');
    const menu = page.getByRole('listbox');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('option', { name: 'left' })).toBeVisible();
    await expect(menu.getByRole('option', { name: 'right' })).toBeVisible();
    await expect(menu.getByRole('option', { name: 'stay' })).toBeVisible();
  });

  test('E-completions-state-debug-rhs', async ({ page }) => {
    await page.goto('/turing');
    const editor = page.locator('.cm-content');
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\nconst s = new State({});\ns.debug = ');
    await page.keyboard.press('Control+Space');
    const menu = page.getByRole('listbox');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('option', { name: 'true' })).toBeVisible();
    await expect(menu.getByRole('option', { name: 'false' })).toBeVisible();
  });

  test('E-completions-auto-import-roundtrip', async ({ page }) => {
    await page.goto('/turing');
    const editor = page.locator('.cm-content');
    await editor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Delete');
    await page.keyboard.type('const a = new Alpha');
    const menu = page.getByRole('listbox');
    await expect(menu).toBeVisible();
    const option = menu.locator('li[role="option"]').filter({ hasText: /^Alphabet/ }).first();
    await expect(option).toBeVisible();
    await option.click();
    await page.waitForTimeout(150);
    const text = await editor.textContent();
    expect(text).toContain('const { Alphabet } = imports;');
    expect(text).toContain('Alphabet(');
  });
});
