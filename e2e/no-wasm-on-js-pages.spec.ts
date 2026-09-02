import { test, expect } from '@playwright/test';

for (const path of ['/turing', '/post']) {
  test(`E-tc-no-wasm-${path.slice(1)}: the JS engine page never requests the wasm bundle`, async ({ page }) => {
    const wasmRequests: string[] = [];
    page.on('request', (r) => { if (/\.wasm(\?|$)/.test(r.url())) wasmRequests.push(r.url()); });
    await page.goto(path);
    await expect(page.getByTestId('tapes-stack')).toBeVisible();
    await page.getByRole('button', { name: /^run$/i }).click();
    await expect(page.getByTestId('log-line').filter({ hasText: /halted after \d+ step\(s\)/ })).toBeVisible({ timeout: 10_000 });
    expect(wasmRequests).toEqual([]);
  });
}
