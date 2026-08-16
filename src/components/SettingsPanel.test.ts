// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import SettingsPanel from './SettingsPanel.svelte';

function dialog(): HTMLDialogElement {
  return screen.getByTestId('settings-dialog') as HTMLDialogElement;
}

async function openPanel() {
  await fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
}

describe('SettingsPanel', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('C-settings-open: gear button opens the dialog with the three fields at their defaults', async () => {
    render(SettingsPanel);
    expect(dialog().open).toBe(false);

    await openPanel();

    expect(dialog().open).toBe(true);
    expect(screen.getByLabelText('Max run steps')).toHaveValue('100000');
    expect(screen.getByLabelText('Worker timeout (ms)')).toHaveValue('5000');
    expect(screen.getByLabelText('Log render cap')).toHaveValue('5000');
  });

  it('C-settings-valid-persists: a valid value persists immediately on input', async () => {
    render(SettingsPanel);
    await openPanel();

    await fireEvent.input(screen.getByLabelText('Max run steps'), { target: { value: '500' } });

    expect(localStorage.getItem('machines-demo:settings:maxSteps')).toBe('500');
  });

  it('C-settings-invalid-shows-error: invalid input marks the field and persists nothing', async () => {
    render(SettingsPanel);
    await openPanel();

    const input = screen.getByLabelText('Max run steps');
    await fireEvent.input(input, { target: { value: '500' } });
    await fireEvent.input(input, { target: { value: 'abc' } });

    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('settings-error-maxSteps')).toBeVisible();
    // The last valid value stays in effect.
    expect(localStorage.getItem('machines-demo:settings:maxSteps')).toBe('500');
  });

  it('C-settings-infinity: ∞ is accepted for Max run steps only', async () => {
    render(SettingsPanel);
    await openPanel();

    await fireEvent.input(screen.getByLabelText('Max run steps'), { target: { value: '∞' } });
    expect(localStorage.getItem('machines-demo:settings:maxSteps')).toBe('Infinity');

    const timeout = screen.getByLabelText('Worker timeout (ms)');
    await fireEvent.input(timeout, { target: { value: '∞' } });
    expect(timeout).toHaveAttribute('aria-invalid', 'true');
    expect(localStorage.getItem('machines-demo:settings:workerTimeoutMs')).toBe(null);
  });

  it('C-settings-reset: the per-field reset restores the default and drops the override', async () => {
    localStorage.setItem('machines-demo:settings:maxSteps', '500');
    render(SettingsPanel);
    await openPanel();

    expect(screen.getByLabelText('Max run steps')).toHaveValue('500');

    await fireEvent.click(screen.getByRole('button', { name: 'Reset Max run steps to default' }));

    expect(screen.getByLabelText('Max run steps')).toHaveValue('100000');
    expect(localStorage.getItem('machines-demo:settings:maxSteps')).toBe(null);
  });

  it('C-settings-reset-hidden-at-default: no reset affordance while every field is at its default', async () => {
    render(SettingsPanel);
    await openPanel();

    expect(screen.queryAllByRole('button', { name: /Reset .* to default/ })).toHaveLength(0);
  });
});
