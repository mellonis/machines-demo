import { test, expect, type Page } from '@playwright/test';

const logLine = (page: Page, re: RegExp) => page.getByTestId('log-line').filter({ hasText: re });
const nonBlank = async (page: Page) =>
  (await page.getByTestId('tape').first().getByTestId('tape-cell').allInnerTexts()).filter((s) => s !== '_' && s.trim() !== '');

test.describe('TM-1 page', () => {
  test.beforeEach(async ({ page }) => {
    // A fresh Playwright browser context already starts with empty
    // localStorage — no explicit clear needed.
    await page.goto('/tm1');
    await expect(page.getByTestId('tapes-stack')).toBeVisible();
    await expect(logLine(page, /^built — 1 band\(s\): num/)).toBeVisible({ timeout: 15_000 });
  });

  test('E-tc-tm-boot-run: binary increment of 011 gives 100', async ({ page }) => {
    expect(await nonBlank(page)).toEqual(['0', '1', '1']);
    await page.getByRole('button', { name: /^run$/i }).click();
    await expect(logLine(page, /^stopped after \d+ step\(s\)/)).toBeVisible({ timeout: 15_000 });
    expect(await nonBlank(page)).toEqual(['1', '0', '0']);
  });

  test('E-tc-tm-multitape: the two-tape example shows two belts and copies src to dst', async ({ page }) => {
    await page.getByRole('button', { name: 'Example code sources' }).click();
    await page.getByRole('menuitem', { name: 'Two-tape copy' }).click();
    await page.getByRole('button', { name: /^build$/i }).click();
    await expect(logLine(page, /^built — 2 band\(s\): src, dst/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('tape')).toHaveCount(2);
    await page.getByRole('button', { name: /^run$/i }).click();
    await expect(logLine(page, /^stopped after \d+ step\(s\)/)).toBeVisible({ timeout: 15_000 });
    const dst = (await page.getByTestId('tape').nth(1).getByTestId('tape-cell').allInnerTexts()).filter((s) => s !== '_' && s.trim() !== '');
    expect(dst).toEqual(['0', '1', '1', '0']);
  });

  test('E-tc-tm-step-limit: a lowered maxSteps truncates the power-of-two run', async ({ page }) => {
    // SETTING_SPECS.maxSteps.min is 100 (lib/settings.ts) — 20 is below the
    // floor and is silently rejected (the field keeps its last valid
    // value), so 100 is the lowest value that actually takes.
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByLabel('Max run steps', { exact: true }).fill('100');
    await page.getByRole('button', { name: 'Close settings' }).click();
    await page.getByRole('button', { name: 'Example code sources' }).click();
    await page.getByRole('menuitem', { name: 'Unary power of two' }).click();
    await page.getByRole('button', { name: /^run$/i }).click();
    await expect(logLine(page, /^truncated at 100 steps \(limit hit\)/)).toBeVisible({ timeout: 15_000 });
  });

  test('E-tc-tm-asm-example: the assembly example builds with image-labelled bands', async ({ page }) => {
    await page.getByRole('button', { name: 'Example code sources' }).click();
    await page.getByRole('menuitem', { name: 'Binary increment (assembly)' }).click();
    await expect(page.getByRole('tab', { name: 'main.tma' })).toBeVisible();
    await page.getByRole('button', { name: /^build$/i }).click();
    await expect(logLine(page, /^built — 1 band\(s\): tape0/)).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /^run$/i }).click();
    await expect(logLine(page, /^stopped after \d+ step\(s\)/)).toBeVisible({ timeout: 15_000 });
  });
});
