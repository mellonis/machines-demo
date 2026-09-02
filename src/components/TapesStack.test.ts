// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import TapesStack from './TapesStack.svelte';

describe('TapesStack', () => {
  afterEach(() => cleanup());

  it('C-stack-actions: the optional actions snippet renders in the corner slot', () => {
    const actions = createRawSnippet(() => ({ render: () => '<button type="button">Load tape block</button>' }));
    render(TapesStack, { props: { tapeCount: 1, caretColors: ['#fff'], actions } });
    expect(screen.getByRole('button', { name: 'Load tape block' })).toBeInTheDocument();
    expect(screen.getByTestId('stack-actions')).toBeInTheDocument();
  });

  it('C-stack-actions-absent: no slot markup without the snippet', () => {
    render(TapesStack, { props: { tapeCount: 1, caretColors: ['#fff'] } });
    expect(screen.queryByTestId('stack-actions')).not.toBeInTheDocument();
  });
});
