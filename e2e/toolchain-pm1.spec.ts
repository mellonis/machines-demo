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
 * shared "simple" request channel, which serialises requests: a lint still
 * in flight delays the next one behind it (docs/execution-model.md
 * (toolchain engines)). Verified empirically: a plain fixed wait here is
 * necessary but not sufficient everywhere — call sites that read `code`
 * through a *retrying* assertion (e.g. `toHaveAttribute` with a generous
 * timeout) ride out the rest.
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
// The full (unfiltered) viewport strip — unlike `nonBlank`, this is
// head-sensitive: `Tape.svelte` centers the viewport on the head, so a
// head move shifts where the marks land in the strip even when `nonBlank`
// (which drops blanks) reads the same run of marks either way.
const strip = async (page: Page) => (await cells(page).allInnerTexts()).map((s) => s.trim());

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

// Read from disk rather than retyping, so the assertions below track the
// shipped example. `std::goToEnd` leaves the head on the last mark, so the
// `right;` between it and `mark;` is what makes the run append a fourth mark
// instead of re-marking the one already under the head.
const UNARY_INCREMENT = readFileSync(
  path.join(__dirname, '../src/lib/toolchain/examples/unary-increment.pmc'),
  'utf8',
);

// The bundled `Unary sum` example with a `debugger;` inserted after the two
// `right;` lines — it lands on line 9, and the instruction that follows it
// (the `@goToEnd();` on line 10) is what the engine reports as the ip when
// the pause arrives.
const SUM_WITH_DEBUGGER = readFileSync(
  path.join(__dirname, '../src/lib/toolchain/examples/sum.pmc'),
  'utf8',
).replace('    right;\n    right;\n', '    right;\n    right;\n    debugger;\n');

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

  test('E-tc-boot-example-query: ?example=<id> wins the boot tier over a differing persisted seed/kind', async ({ page }) => {
    // Plant a stale localStorage seed/kind (5-mark seed, kind 'source') on a
    // plain visit — the URL-example tier (ToolchainView.svelte's
    // `bootTierExample`) must win over it on the next navigation, not the
    // localStorage tier `loadSeeds`/`loadKind` would otherwise resolve.
    await page.evaluate(() => {
      localStorage.setItem('machines-demo:pm1:seeds', JSON.stringify([{ cells: ['*', '*', '*', '*', '*'], origin: 0, head: 0 }]));
      localStorage.setItem('machines-demo:pm1:kind', 'source');
    });
    await page.goto('/pm1?example=unary-increment-asm');
    await expect(page.getByTestId('tapes-stack')).toBeVisible();
    await expect(logLine(page, /^built — 1 band\(s\): tape/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('tab', { name: 'main.pma' })).toHaveAttribute('aria-selected', 'true');
    expect(await nonBlank(page)).toEqual(['*', '*', '*']);
  });

  test('E-tc-boot-snippet-query: ?snippet=<uuid> wins the boot tier over the localStorage seed', async ({ page }) => {
    // Distinctive seed: 4 marks (one more than the bundled example's 3),
    // built the same way E-tc-seed-persists does — walk the head across the
    // three existing marks (no-ops) then extend with a fourth.
    await page.getByRole('button', { name: 'Move right' }).click();
    await page.getByRole('button', { name: 'Write *' }).click();
    for (let i = 0; i < 4; i++) {
      await page.getByRole('button', { name: 'Apply' }).click();
    }
    expect(await nonBlank(page)).toEqual(['*', '*', '*', '*']);

    await page.getByRole('button', { name: 'Save snippet' }).click();
    await page.getByPlaceholder('Snippet name').fill('boot-snippet-test');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('.save-popover')).toBeHidden();

    const snippetUrl = page.url();
    const snippetId = new URL(snippetUrl).searchParams.get('snippet');
    expect(snippetId).not.toBeNull();

    // Clear the localStorage seed tier (leave the snippets key, which holds
    // the snippet's own seed) — proves the snippet tier is what resolves
    // the belt, not a coincidental localStorage carry-over.
    await page.evaluate(() => localStorage.removeItem('machines-demo:pm1:seeds'));

    await page.goto(snippetUrl);
    await expect(page.getByTestId('tapes-stack')).toBeVisible();
    await expect(logLine(page, /^built — 1 band\(s\): tape/)).toBeVisible({ timeout: 15_000 });
    expect(await nonBlank(page)).toEqual(['*', '*', '*', '*']);

    await page.getByRole('button', { name: 'Example code sources' }).click();
    await expect(page.getByRole('menuitem', { name: 'boot-snippet-test' })).toHaveClass(/selected/);
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

  test('E-tc-reset-restores-kind: Reset after a language switch restores the example buffer, kind and all', async ({ page }) => {
    await page.getByLabel('Buffer language').selectOption('asm');
    await expect(page.getByRole('tab', { name: 'main.pma' })).toBeVisible();
    await expect(page.locator('.cm-content')).toContainText('.func main');
    // The buffer's language is part of what Reset restores: putting `.pmc`
    // source back into an assembly buffer would mis-highlight it and fail
    // the next Build in the assembler.
    await page.getByRole('button', { name: 'Reset to selected example' }).click();
    await expect(page.getByRole('tab', { name: 'main.pmc' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.cm-content')).toContainText('@std::goToEnd();');
    await expect(page.locator('.cm-content')).not.toContainText('.func main');
  });

  test('E-tc-std-goto-def: Cmd/Ctrl-click on a bare imported name opens its stdlib definition', async ({ page }) => {
    // `Unary sum` imports with `use std::goToEnd, …;` and then calls the
    // bare `@goToEnd();` — the spelling that carries no `std::` prefix.
    await page.getByRole('button', { name: 'Example code sources' }).click();
    await page.getByRole('menuitem', { name: 'Unary sum' }).click();
    const line = page.locator('.cm-line').filter({ hasText: '@goToEnd();' }).first();
    await expect(line).toBeVisible();
    // Click the token itself, measured with a DOM Range: a centred click on
    // the line would land in the padding past `;`, which is punctuation and
    // resolves to no name at all.
    const lineBox = await line.boundingBox();
    const token = await line.evaluate((el, name: string) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = (n.textContent ?? '').indexOf(name);
        if (i === -1) continue;
        const r = document.createRange();
        r.setStart(n, i + 2);
        r.setEnd(n, i + 3);
        const rect = r.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }
      return null;
    }, 'goToEnd');
    if (!lineBox || !token) throw new Error('goToEnd token not laid out');
    await line.click({ modifiers: ['ControlOrMeta'], position: { x: token.x - lineBox.x, y: token.y - lineBox.y } });
    await expect(page.getByRole('tab', { name: 'std.pmc' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.cm-line').filter({ hasText: 'export goToEnd()' }).first()).toBeInViewport();
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

  test('E-tc-pick-seeds-now: picking an example seeds the belt immediately, without a Build', async ({ page }) => {
    expect(await logLine(page, /^built —/).count()).toBe(1);
    await page.getByRole('button', { name: 'Example code sources' }).click();
    await page.getByRole('menuitem', { name: 'Unary sum' }).click();
    // The sum example's seed is ['*', '*', '*', ' ', '*', '*'] — five marks
    // around a one-cell gap — applied to the still-loaded program's bands
    // (unchanged layout), so no Build is needed for it to fit.
    expect(await nonBlank(page)).toEqual(['*', '*', '*', '*', '*']);
    expect(await logLine(page, /^built —/).count()).toBe(1);
  });

  test('E-tc-pick-then-build-keeps-panel-edit: a panel edit made after picking survives the next Build', async ({ page }) => {
    await page.getByRole('button', { name: 'Example code sources' }).click();
    await page.getByRole('menuitem', { name: 'Unary sum' }).click();
    expect(await nonBlank(page)).toEqual(['*', '*', '*', '*', '*']);
    const beforeMove = await strip(page);

    // Move the head right with no write (the panel's write selector stays on
    // "keep" by default), applied once — moves the head without touching the
    // seed's marks. The move shifts the marks within the head-centered
    // viewport, which is what makes the post-Build comparison below
    // head-sensitive (`nonBlank` alone can't tell the two cases apart: the
    // same five marks read identically whether the head moved or not).
    await page.getByRole('button', { name: 'Move right' }).click();
    await page.getByRole('button', { name: 'Apply' }).click();
    const beforeBuild = await strip(page);
    expect(beforeBuild).not.toEqual(beforeMove);
    expect(beforeBuild.filter((s) => s !== '')).toEqual(['*', '*', '*', '*', '*']);

    await page.getByRole('button', { name: /^build$/i }).click();
    await expect(logLine(page, /^built — 1 band\(s\)/).nth(1)).toBeVisible({ timeout: 10_000 });
    expect(await strip(page)).toEqual(beforeBuild);
  });

  test('E-tc-snippet-load-seeds-now: loading a saved snippet seeds the belt immediately, without a Build', async ({ page }) => {
    // A distinctive seed: 4 marks (one more than either bundled example),
    // same recipe as E-tc-boot-snippet-query.
    await page.getByRole('button', { name: 'Move right' }).click();
    await page.getByRole('button', { name: 'Write *' }).click();
    for (let i = 0; i < 4; i++) {
      await page.getByRole('button', { name: 'Apply' }).click();
    }
    expect(await nonBlank(page)).toEqual(['*', '*', '*', '*']);

    await page.getByRole('button', { name: 'Save snippet' }).click();
    await page.getByPlaceholder('Snippet name').fill('seed-now-test');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('.save-popover')).toBeHidden();

    await page.getByRole('button', { name: 'Example code sources' }).click();
    await page.getByRole('menuitem', { name: 'Unary increment', exact: true }).click();
    expect(await nonBlank(page)).toEqual(['*', '*', '*']);

    const buildCountBefore = await logLine(page, /^built —/).count();
    await page.getByRole('button', { name: 'Example code sources' }).click();
    await page.getByRole('menuitem', { name: 'seed-now-test' }).click();
    expect(await nonBlank(page)).toEqual(['*', '*', '*', '*']);
    expect(await logLine(page, /^built —/).count()).toBe(buildCountBefore);
  });

  test('E-tc-breakpoint-on-added-line: a line added since the last Build takes a breakpoint without building first', async ({ page }) => {
    // The line map is the last Build's; a line the user just typed owns no
    // instruction in it, so a strictly-map-driven gutter would refuse the
    // breakpoint until the next Build. While the build is stale any non-blank
    // user line takes one instead, and the Build resolves it.
    //
    // The new `right;` goes *after* `@std::goToBegin();`, so it lands on line
    // 8 — the built program's closing `}`, which owns no instruction. Placing
    // it higher up would land on a line the stale map already maps (the built
    // program's lines 4-7 all carry instructions) and the case would pass
    // with or without the fix.
    const withExtraRight = UNARY_INCREMENT.replace('    @std::goToBegin();\n', '    @std::goToBegin();\n    right;\n');
    expect(withExtraRight).not.toEqual(UNARY_INCREMENT);
    await setEditorText(page, withExtraRight);
    // The stale-build dot is the sync point: it lights once the debounced
    // view→`code` sync has landed, which is also what flips `staleBuild`.
    await expect(page.getByRole('button', { name: /^build$/i })).toHaveAttribute('title', 'code changed since last Build', { timeout: 8_000 });

    // The inserted `right;` is line 8 (0-based index 7).
    await clickGutterAtLine(page, 7);
    await expect(page.locator('.cm-bp-gutter .cm-gutterElement:not(.cm-bp-spacer) .cm-bp-marker')).toHaveCount(1);

    await page.getByRole('checkbox', { name: /^debug$/i }).check();
    await page.getByRole('button', { name: /^run$/i }).click();
    await expect(logLine(page, /^paused at main\.pmc:8 in main \(breakpoint\)/)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /^continue$/i }).click();
    await expect(logLine(page, /^stopped after \d+ step\(s\)/)).toBeVisible({ timeout: 15_000 });
  });

  test('E-tc-breakpoint-follows-insert: inserting a line above a breakpoint moves it with the text', async ({ page }) => {
    await page.getByRole('checkbox', { name: /^debug$/i }).check();
    // Line 6 is `    mark;` (0-based index 5) in the built example.
    await clickGutterAtLine(page, 5);
    const markerEl = page.locator('.cm-bp-gutter .cm-gutterElement:not(.cm-bp-spacer)').filter({ has: page.locator('.cm-bp-marker') });
    // Anchored: the second comment line reads "… on the first mark; the run
    // grows …", so a plain `mark;` substring match would find that instead.
    const markLine = page.locator('.cm-line').filter({ hasText: /^\s*mark;\s*$/ }).first();
    await expect(markerEl).toHaveCount(1);
    const before = await markerEl.boundingBox();
    const markBefore = await markLine.boundingBox();
    if (!before || !markBefore) throw new Error('gutter marker not laid out');
    expect(Math.abs(before.y - markBefore.y)).toBeLessThan(3);

    // A real edit of the existing document, not a whole-buffer replacement
    // (`setEditorText` replaces everything, which is a new buffer rather than
    // an edit — see breakpointGutter.ts's line mapping). Enter at the very
    // start pushes every line down by one; ArrowUp + typing then fills the
    // new first line without a completion tooltip ever being open.
    await page.locator('.cm-content').first().click();
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.type('// a note above');
    await expect(page.getByRole('button', { name: /^build$/i })).toHaveAttribute('title', 'code changed since last Build', { timeout: 8_000 });

    const after = await markerEl.boundingBox();
    const markAfter = await markLine.boundingBox();
    if (!after || !markAfter) throw new Error('gutter marker not laid out after the edit');
    // The marker rode down with `mark;` rather than staying on line 6.
    expect(after.y).toBeGreaterThan(before.y);
    expect(Math.abs(after.y - markAfter.y)).toBeLessThan(3);

    await page.getByRole('button', { name: /^run$/i }).click();
    await expect(logLine(page, /^paused at main\.pmc:7 in main \(breakpoint\)/)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: /^continue$/i }).click();
    await expect(logLine(page, /^stopped after \d+ step\(s\)/)).toBeVisible({ timeout: 15_000 });
  });

  test('E-tc-debugger-pauses-on-its-line: a `debugger` pauses on its own line, not the next one', async ({ page }) => {
    // A retired `debugger` pauses at the *next* instruction boundary, so the
    // engine reports the following instruction's ip — the page has to name
    // the `debugger;` line itself (line 9 here, not line 10).
    await page.getByRole('button', { name: 'Example code sources' }).click();
    await page.getByRole('menuitem', { name: 'Unary sum' }).click();
    await setEditorText(page, SUM_WITH_DEBUGGER);
    await page.getByRole('checkbox', { name: /^debug$/i }).check();
    await page.getByRole('button', { name: /^run$/i }).click();
    await expect(logLine(page, /^paused at main\.pmc:9 in main \(debugger\)/)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.cm-ip-line')).toHaveCount(1);
    await expect(page.locator('.cm-ip-line')).toContainText('debugger;');
    await page.getByRole('button', { name: /^continue$/i }).click();
    await expect(logLine(page, /^stopped after \d+ step\(s\)/)).toBeVisible({ timeout: 15_000 });
  });
});
