import { test, expect, type Page } from '@playwright/test';

/**
 * Settings panel (gear in the header): the unit suites cover validation and
 * storage (`src/lib/settings.test.ts`) and the panel's field behavior
 * (`src/components/SettingsPanel.test.ts`); these tests cover the wiring the
 * unit specs cannot reach — persistence across a real reload, and a changed
 * `maxSteps` actually bounding a worker run.
 */

/** Moves right forever — never halts, so a run always hits the step cap. */
const INFINITE_TURING = `const { Alphabet, State, Tape, TapeBlock, TuringMachine, ifOtherSymbol, movements } = imports;

const alphabet = new Alphabet(['␣', 'a']);
const tape = new Tape({ alphabet, symbols: ['a'] });
const tapeBlock = TapeBlock.fromTapes([tape]);
const machine = new TuringMachine({ tapeBlock });

const initialState = new State({
  [ifOtherSymbol]: {
    command: [{ movement: movements.right }],
  },
});

return { machine, initialState, tape };
`;

async function openSettings(page: Page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByTestId('settings-dialog')).toBeVisible();
}

async function closeSettings(page: Page) {
  await page.getByRole('button', { name: 'Close settings' }).click();
  await expect(page.getByTestId('settings-dialog')).toBeHidden();
}

/** Replace the whole editor buffer (insertText bypasses the CodeMirror
 *  keymap — same rationale as in the diagnostics-counter spec). */
async function setEditorText(page: Page, text: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.insertText(text);
}

test.describe('settings panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/turing');
    await expect(page.getByTestId('tapes-stack')).toBeVisible();
  });

  test('E-settings-persist-across-reload: a changed value is stored and survives reload', async ({ page }) => {
    await openSettings(page);
    // exact: true — the field's "Reset Max run steps to default" button would
    // otherwise also match once the value diverges (getByLabel substring-matches).
    await page.getByLabel('Max run steps', { exact: true }).fill('200000');
    await closeSettings(page);

    await page.reload();
    await expect(page.getByTestId('tapes-stack')).toBeVisible();

    await openSettings(page);
    await expect(page.getByLabel('Max run steps', { exact: true })).toHaveValue('200000');
  });

  test('E-settings-invalid-not-persisted: invalid input shows the field error and is dropped on reload', async ({ page }) => {
    await openSettings(page);
    await page.getByLabel('Max run steps', { exact: true }).fill('abc');
    await expect(page.getByTestId('settings-error-maxSteps')).toBeVisible();

    await page.reload();
    await expect(page.getByTestId('tapes-stack')).toBeVisible();

    await openSettings(page);
    await expect(page.getByLabel('Max run steps', { exact: true })).toHaveValue('100000');
  });

  test('E-settings-maxsteps-bounds-run: a lowered Max run steps truncates a non-halting run', async ({ page }) => {
    await openSettings(page);
    await page.getByLabel('Max run steps', { exact: true }).fill('100');
    await closeSettings(page);

    await setEditorText(page, INFINITE_TURING);
    // svelte-codemirror-editor debounces bind:value propagation (300ms);
    // clicking Build immediately would rebuild the previous code. The
    // reset-to-example overlay appears exactly when the app's `code` state
    // has absorbed the edit — wait for it before building.
    await expect(page.getByRole('button', { name: 'Reset to selected example' })).toBeVisible();
    await page.getByRole('button', { name: /^build$/i }).click();
    // Second 'loaded — ready' (the first is the boot build) — the new
    // machine is in the worker before Run.
    await expect(page.getByTestId('log-line').filter({ hasText: 'loaded — ready' })).toHaveCount(2);
    await page.getByRole('button', { name: /^run$/i }).click();

    await expect(
      page.getByTestId('log-line').filter({ hasText: 'truncated at 100 steps (limit hit)' }),
    ).toBeVisible({ timeout: 10_000 });
  });
});
