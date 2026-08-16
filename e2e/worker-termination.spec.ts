import { test, expect, type Page } from '@playwright/test';

/**
 * Worker-termination progress restore: when the worker is killed mid-run —
 * watchdog timeout or hand Stop — the tape view must not silently stay at
 * the pre-run state. The worker posts time-gated `progress` heartbeats from
 * its run loop; the runner keeps the last one; the timeout error and the
 * Stop path restore the display from it and log which step it reflects.
 *
 * Uses a non-halting machine that WRITES a trail as it moves so the restored
 * tape is visually distinct from the initial one (exactly one non-blank cell
 * initially, a written run of them after restore) — a right-mover over
 * blanks would leave an all-blank viewport that a cleared tape could fake.
 * `workerTimeoutMs` is floored to 1s and `maxSteps` to Infinity via the
 * settings storage keys so a continuous run reaches the watchdog instead of
 * the step cap.
 */

const TRAIL_WRITER_TURING = `const { Alphabet, State, Tape, TapeBlock, TuringMachine, ifOtherSymbol, movements } = imports;

const alphabet = new Alphabet(['␣', 'a']);
const tape = new Tape({ alphabet, symbols: ['a'] });
const tapeBlock = TapeBlock.fromTapes([tape]);
const machine = new TuringMachine({ tapeBlock });

const initialState = new State({
  [ifOtherSymbol]: {
    command: [{ symbol: 'a', movement: movements.right }],
  },
});

return { machine, initialState, tape };
`;

const RESTORE_LINE = /tape shows step \d+ at '.+' — last snapshot before termination/;

/** Replace the whole editor buffer (insertText bypasses the CodeMirror
 *  keymap — same rationale as in the settings spec). */
async function setEditorText(page: Page, text: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(text);
}

async function buildTrailWriter(page: Page) {
  await setEditorText(page, TRAIL_WRITER_TURING);
  // svelte-codemirror-editor debounces bind:value propagation; the reset
  // overlay appears once the app's `code` state absorbed the edit.
  await expect(page.getByRole('button', { name: 'Reset to selected example' })).toBeVisible();
  await page.getByRole('button', { name: /^build$/i }).click();
  // Second 'loaded — ready' (the first is the boot build).
  await expect(page.getByTestId('log-line').filter({ hasText: 'loaded — ready' })).toHaveCount(2);
}

function nonBlankCells(page: Page) {
  return page.locator('[data-testid="tape-cell"][data-blank="false"]');
}

test.describe('worker termination restores last progress', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/turing');
    await expect(page.getByTestId('tapes-stack')).toBeVisible();
    await page.evaluate(() => {
      localStorage.setItem('machines-demo:settings:workerTimeoutMs', '1000');
      localStorage.setItem('machines-demo:settings:maxSteps', 'Infinity');
    });
  });

  test('E-term-timeout-restores-progress: a continuous-run watchdog timeout restores the tape from the last heartbeat and logs the step', async ({ page }) => {
    await buildTrailWriter(page);
    await expect(nonBlankCells(page)).toHaveCount(1);

    await page.getByRole('button', { name: /^run$/i }).click();
    await expect(
      page.getByTestId('log-line').filter({ hasText: 'timeout after 1000ms' }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('log-line').filter({ hasText: RESTORE_LINE })).toBeVisible();

    // The restored viewport shows the written trail behind the head — many
    // non-blank cells, not the single pre-run 'a'.
    await expect(nonBlankCells(page).nth(1)).toBeVisible();

    // The termination leaves a workable HALTED surface: Run must be
    // clickable and respawn a fresh worker.
    await expect(page.getByRole('button', { name: /^run$/i })).toBeEnabled();
  });

  test('E-term-stop-restores-progress: hand Stop mid-continuous-run restores the tape from the last heartbeat and logs the step', async ({ page }) => {
    await buildTrailWriter(page);
    await expect(nonBlankCells(page)).toHaveCount(1);

    await page.getByRole('button', { name: /^run$/i }).click();
    // Give the run time for at least one 250ms heartbeat, then Stop well
    // before the 1s watchdog.
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: /^stop$/i }).click();

    await expect(page.getByTestId('log-line').filter({ hasText: 'stopped' })).toBeVisible();
    await expect(page.getByTestId('log-line').filter({ hasText: RESTORE_LINE })).toBeVisible();
    await expect(nonBlankCells(page).nth(1)).toBeVisible();
  });

  test('E-term-auto-stop-no-restore: stopping an auto-run does not regress the display (no restore line — per-iter rendering is already current)', async ({ page }) => {
    await buildTrailWriter(page);

    await page.getByRole('checkbox', { name: /^with pause$/i }).check();
    await page.getByRole('button', { name: /^run$/i }).click();
    // Wait until at least one iter rendered, then stop mid-throttle.
    await expect(page.getByTestId('log-line').filter({ hasText: 'step 1:' })).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: /^stop$/i }).click();

    await expect(page.getByTestId('log-line').filter({ hasText: 'stopped' })).toBeVisible();
    await expect(page.getByTestId('log-line').filter({ hasText: RESTORE_LINE })).toHaveCount(0);
  });
});
