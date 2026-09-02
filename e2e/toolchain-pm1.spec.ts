import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Replace the main buffer. insertText bypasses the CodeMirror keymap.
 * A read of the bound `code` can lag an edit by a few hundred ms — at
 * least `svelte-codemirror-editor`'s 300ms view→prop debounce
 * (`dist/CodeMirror.svelte`'s `on_change`), and possibly also the 400ms
 * `check()` round-trip the same edit schedules on the toolchain worker's
 * shared "simple" request channel (docs/execution-model.md (toolchain
 * engines); machines-demo#136 review round 1 concern 1). Verified
 * empirically: a plain fixed wait here is necessary but not sufficient
 * everywhere — call sites that read `code` through a *retrying* assertion
 * (e.g. `toHaveAttribute` with a generous timeout) ride out the rest.
 */
async function setEditorText(page: Page, text: string) {
  await page.locator('.cm-content').first().click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(text);
  await page.waitForTimeout(400);
}
const logLine = (page: Page, re: RegExp) => page.getByTestId('log-line').filter({ hasText: re });
const cells = (page: Page) => page.getByTestId('tape').first().getByTestId('tape-cell');
const nonBlank = async (page: Page) => (await cells(page).allInnerTexts()).filter((s) => s.trim() !== '');

/**
 * Click the breakpoint gutter at a source line's y-coordinate. CodeMirror
 * renders a `.cm-gutterElement` only for lines that already carry a marker
 * (a set breakpoint, or an unmappable line's refuse marker) plus one hidden
 * spacer at index 0 — gutter-element indices don't correspond to source
 * line numbers, so the click has to be positioned by the line's own
 * bounding box instead (docs/execution-model.md (toolchain engines)).
 */
async function clickGutterAtLine(page: Page, lineIndex0Based: number): Promise<void> {
  const lineBox = await page.locator('.cm-content .cm-line').nth(lineIndex0Based).boundingBox();
  const gutterBox = await page.locator('.cm-bp-gutter').boundingBox();
  if (!lineBox || !gutterBox) throw new Error('editor gutter not laid out');
  await page.mouse.click(gutterBox.x + gutterBox.width / 2, lineBox.y + lineBox.height / 2);
}

// Read from disk rather than retyping: the source gained a `right;` line
// (mellonis/machines-demo#136 review round 1) so the run actually appends a
// mark instead of re-marking an already-marked cell.
const UNARY_INCREMENT = readFileSync(
  path.join(__dirname, '../src/lib/toolchain/examples/unary-increment.pmc'),
  'utf8',
);

test.describe('PM-1 page', () => {
  test.beforeEach(async ({ page }) => {
    // Playwright gives each test a fresh, isolated browser context, so
    // localStorage already starts empty — no explicit clear needed (and
    // `addInitScript` would re-fire on every navigation within the test,
    // including `page.reload()`, wiping state a persistence test just set).
    await page.goto('/pm1');
    await expect(page.getByTestId('tapes-stack')).toBeVisible();
    await expect(logLine(page, /^built — 1 band\(s\): tape/)).toBeVisible({ timeout: 15_000 });
  });

  test('E-tc-boot: the first example builds and seeds the tape with three marks', async ({ page }) => {
    expect(await nonBlank(page)).toEqual(['*', '*', '*']);
    await expect(page.getByRole('tab', { name: 'main.pmc' })).toHaveAttribute('aria-selected', 'true');
  });

  test('E-tc-build-error: a syntax error fails the Build with a positioned error and the counter pill', async ({ page }) => {
    await setEditorText(page, 'main() {\n    mark;\n');
    await expect(page.locator('[data-testid="diag-pill"][data-severity="error"]')).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: /^build$/i }).click();
    await expect(logLine(page, /^build failed: .* \(line \d+\)/)).toBeVisible({ timeout: 10_000 });
    await setEditorText(page, UNARY_INCREMENT);
    await page.getByRole('button', { name: /^build$/i }).click();
    await expect(logLine(page, /^built — 1 band\(s\)/).nth(1)).toBeVisible({ timeout: 10_000 });
  });

  test('E-tc-run: Run to completion appends one mark', async ({ page }) => {
    await page.getByRole('button', { name: /^run$/i }).click();
    await expect(logLine(page, /^stopped after \d+ step\(s\)/)).toBeVisible({ timeout: 15_000 });
    expect(await nonBlank(page)).toEqual(['*', '*', '*', '*']);
  });

  test('E-tc-step: Step pauses, highlights the ip line, and Continue runs to the end', async ({ page }) => {
    await page.getByRole('button', { name: /^step$/i }).click();
    await expect(logLine(page, /^step 1: main\.pmc:/)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.cm-ip-line')).toHaveCount(1);
    await expect(page.getByRole('button', { name: /^continue$/i })).toBeVisible();
    await page.getByRole('button', { name: /^continue$/i }).click();
    await expect(logLine(page, /^stopped after \d+ step\(s\)/)).toBeVisible({ timeout: 15_000 });
  });

  test('E-tc-step-into-std: stepping into std::goToEnd switches to the stdlib tab with the ip line highlighted', async ({ page }) => {
    // Step is one retired instruction, not one source-level transition
    // (docs/execution-model.md (toolchain engines)); no `paused` line is
    // logged in step mode. The call into std::goToEnd retires first
    // (its frame's entry instruction carries no source line — "std.pmc:?"
    // — mirroring main's own entry step), so poll a bounded number of Step
    // clicks for a *numbered* std.pmc line to appear, not just the tab
    // switch (which happens one step earlier, on the line-less entry).
    const wanted = /^step \d+: std\.pmc:\d+ std::goToEnd/;
    for (let i = 0; i < 8; i++) {
      await page.getByRole('button', { name: /^step$/i }).click();
      await page.waitForTimeout(150);
      if ((await logLine(page, wanted).count()) > 0) break;
    }
    // Asserting the locator (rather than a boolean flag) means a genuine
    // failure prints the locator and a page snapshot, not just "false".
    await expect(logLine(page, wanted).first()).toBeVisible({ timeout: 2_000 });
    await expect(page.getByRole('tab', { name: 'std.pmc' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.cm-ip-line')).toHaveCount(1);
  });

  test('E-tc-breakpoint: a gutter click on `mark;` pauses the run there with debug on', async ({ page }) => {
    await page.getByRole('checkbox', { name: /^debug$/i }).check();
    // Line 6 is `    mark;` in the current example (0-based line index 5).
    await clickGutterAtLine(page, 5);
    await expect(page.locator('.cm-bp-gutter .cm-gutterElement:not(.cm-bp-spacer) .cm-bp-marker')).toHaveCount(1);
    await page.getByRole('button', { name: /^run$/i }).click();
    await expect(logLine(page, /^paused at main\.pmc:6 in main \(breakpoint\)/)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.cm-ip-line')).toHaveCount(1);
    expect(await nonBlank(page)).toEqual(['*', '*', '*']);
    await page.getByRole('button', { name: /^continue$/i }).click();
    await expect(logLine(page, /^stopped after \d+ step\(s\)/)).toBeVisible({ timeout: 15_000 });
  });

  test('E-tc-breakpoint-refused: a comment line cannot take a breakpoint', async ({ page }) => {
    // The unmappable marker exists without a click — line 1 is a comment.
    const refuse = page.locator('.cm-bp-gutter .cm-bp-refuse').first();
    await expect(refuse).toHaveAttribute('title', 'no instruction on this line');
    await refuse.dispatchEvent('mousedown');
    await expect(page.locator('.cm-bp-gutter .cm-gutterElement:not(.cm-bp-spacer) .cm-bp-marker')).toHaveCount(0);
  });

  test('E-tc-format: Format rewrites the buffer and lights the stale-build dot', async ({ page }) => {
    await setEditorText(page, 'main() {\n  @std::goToEnd();  mark;\n  @std::goToBegin();\n}\n');
    await page.getByRole('button', { name: /^build$/i }).click();
    await expect(logLine(page, /^built — 1 band\(s\)/).nth(1)).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /^format$/i }).click();
    await expect(logLine(page, /^formatted/)).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.cm-content')).toContainText('mark;');
    // Format's rewrite goes through the same debounced view→bound-`code`
    // sync as setEditorText (see its doc comment) — give it room to flush.
    await expect(page.getByRole('button', { name: /^build$/i })).toHaveAttribute('title', 'code changed since last Build', { timeout: 8_000 });
  });

  test('E-tc-kind-switch: switching to assembly disassembles the last Build, which builds and runs to the same tape', async ({ page }) => {
    await page.getByLabel('Buffer language').selectOption('asm');
    await expect(logLine(page, /^disassembled last Build into main\.pma/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('tab', { name: 'main.pma' })).toBeVisible();
    await expect(page.locator('.cm-content')).toContainText('.func main');
    await page.getByRole('button', { name: /^run$/i }).click();
    await expect(logLine(page, /^stopped after \d+ step\(s\)/)).toBeVisible({ timeout: 15_000 });
    expect(await nonBlank(page)).toEqual(['*', '*', '*', '*']);
  });

  test('E-tc-seed-persists: a seed edited on the panel survives a reload', async ({ page }) => {
    // Select write '*' + move right once, then Apply four times: the first
    // three re-write already-marked cells (no-ops) while walking the head
    // to the first blank past the run; the fourth actually extends it.
    // The buffer itself is left untouched — this exercises the localStorage
    // boot tier for seeds independently of the code tier.
    await page.getByRole('button', { name: 'Move right' }).click();
    await page.getByRole('button', { name: 'Write *' }).click();
    for (let i = 0; i < 4; i++) {
      await page.getByRole('button', { name: 'Apply' }).click();
    }
    const before = await nonBlank(page);
    expect(before).toEqual(['*', '*', '*', '*']);
    await page.reload();
    await expect(logLine(page, /^built — 1 band\(s\)/)).toBeVisible({ timeout: 15_000 });
    expect(await nonBlank(page)).toEqual(before);
  });

  test('E-tc-tapeblock-roundtrip: Save tape block then Load restores the seed', async ({ page }) => {
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save tape block' }).click();
    const file = await download;
    const suggestedName = file.suggestedFilename();
    expect(suggestedName).toMatch(/\.pmt$/);
    const filePath = await file.path();
    await expect(logLine(page, /^saved tape block /)).toBeVisible();

    // Blank the seed (write blank + move right, applied three times to
    // clear all three marks), then load the saved block back.
    await page.getByRole('button', { name: 'Write blank' }).click();
    await page.getByRole('button', { name: 'Move right' }).click();
    for (let i = 0; i < 3; i++) {
      await page.getByRole('button', { name: 'Apply' }).click();
    }
    expect(await nonBlank(page)).toEqual([]);

    // Playwright's download.path() is a temp file with a generated (not
    // `.pmt`-suffixed) basename; pass the bytes under the real suggested
    // name so the File the page receives carries the extension the log
    // line (and the app's own kind sniffing) expects.
    await page.getByTestId('tape-block-input').setInputFiles({
      name: suggestedName,
      mimeType: 'application/octet-stream',
      buffer: readFileSync(filePath!),
    });
    await expect(logLine(page, /^loaded tape block ".*\.pmt": 1 band\(s\)/)).toBeVisible({ timeout: 10_000 });
    expect(await nonBlank(page)).toEqual(['*', '*', '*']);
  });

  test('E-tc-std-tab: the stdlib tab is read-only and shows the library text', async ({ page }) => {
    await page.getByRole('tab', { name: 'std.pmc' }).click();
    await expect(page.locator('.cm-content')).toContainText('export goToEnd()');
    await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
  });

  test('E-tc-std-completion: typing std:: offers the exported names', async ({ page }) => {
    await setEditorText(page, 'main() {\n    @std::');
    await page.keyboard.press('ControlOrMeta+Space');
    await expect(page.locator('.cm-tooltip-autocomplete')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.cm-tooltip-autocomplete')).toContainText('goToEnd');
  });
});
