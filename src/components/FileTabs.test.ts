// @vitest-environment happy-dom
import type { ComponentProps } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import FileTabs from './FileTabs.svelte';

function props(over: Partial<ComponentProps<typeof FileTabs>> = {}) {
  return { active: 'main' as const, arch: 'tm' as const, kind: 'source' as const, kindSwitchEnabled: true, onSelect: vi.fn(), onKindChange: vi.fn(), ...over };
}

describe('FileTabs', () => {
  afterEach(() => cleanup());

  it('C-tabs-names: tab names follow arch and kind; std keeps the source extension', () => {
    render(FileTabs, { props: props() });
    expect(screen.getByRole('tab', { name: 'main.tmc' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'std.tmc' })).toHaveAttribute('aria-selected', 'false');
    cleanup();
    render(FileTabs, { props: props({ kind: 'asm', arch: 'pm', active: 'std' }) });
    expect(screen.getByRole('tab', { name: 'main.pma' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: 'std.pmc' })).toHaveAttribute('aria-selected', 'true');
  });

  it('C-tabs-select: clicking a tab calls onSelect', async () => {
    const p = props();
    render(FileTabs, { props: p });
    await fireEvent.click(screen.getByRole('tab', { name: 'std.tmc' }));
    expect(p.onSelect).toHaveBeenCalledWith('std');
  });

  it('C-tabs-kind: the language select reports the new kind and is disabled while an op is pending', async () => {
    const p = props();
    render(FileTabs, { props: p });
    const select = screen.getByLabelText('Buffer language') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['.tmc', '.tma']);
    await fireEvent.change(select, { target: { value: 'asm' } });
    expect(p.onKindChange).toHaveBeenCalledWith('asm');
    cleanup();
    render(FileTabs, { props: props({ kindSwitchEnabled: false }) });
    expect(screen.getByLabelText('Buffer language')).toBeDisabled();
  });
});
