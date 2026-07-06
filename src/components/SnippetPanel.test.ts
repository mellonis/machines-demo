// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { flushSync } from 'svelte';
import SnippetPanel from './SnippetPanel.svelte';
import type { Snippet } from '@turing-machine-js/visuals';

// Mock mermaid + ELK so the embedded MachineGraph doesn't try to load real
// renderers in happy-dom (same approach as MachineGraph.test.ts). SnippetPanel
// tests run at the frame-index / lifecycle level — full SVG rendering is left
// to the E2E suite per the plan.
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    registerLayoutLoaders: vi.fn(),
    render: vi.fn(async (id: string) => ({
      svg: `<svg data-testid="mock-svg" data-id="${id}"></svg>`,
      bindFunctions: undefined,
    })),
  },
}));

vi.mock('@mermaid-js/layout-elk', () => ({
  default: [],
}));

type SnippetWithMeta = Snippet & {
  engine: 'turing' | 'post';
  id: string;
  description?: string;
  intervalMs?: number;
};

function stubSnippet(overrides: Partial<SnippetWithMeta> = {}): SnippetWithMeta {
  return {
    version: 1,
    engine: 'turing',
    id: 'showcase-1',
    description: 'A test snippet',
    graph: {
      initialId: 1,
      alphabets: [[' ', 'a', 'b']],
      nodes: {
        0: { id: 0, name: 'halt', transitions: [], isWrapper: false, isHaltMarker: false, tags: [] },
        1: { id: 1, name: 'S', transitions: [], isWrapper: false, isHaltMarker: false, tags: [] },
      },
    } as never,
    alphabets: [[' ', 'a', 'b']],
    frames: [
      { step: 0, tape: [{ symbols: ['a', 'b'], position: 0 }], highlight: null },
      {
        step: 1,
        tape: [{ symbols: ['b', 'b'], position: 1 }],
        commands: [{ movement: 'R', read: 'a', write: 'b' }],
        highlight: { fromId: 1, toId: 1, strong: 'from', paused: false },
      },
      {
        step: 2,
        tape: [{ symbols: ['b', 'a'], position: 1 }],
        commands: [{ movement: 'L', read: 'b', write: 'a' }],
        highlight: { fromId: 1, toId: 0, strong: 'from', paused: false },
      },
    ],
    ...overrides,
  };
}

// `aria-current="step"` is set on the trace row whose `data-step` matches the
// current `frameIndex`. Frame 0 has no row (no transition fired yet); frames
// 1..N each get a row. Helper returns the highlighted row's `data-step` value,
// or null when no row is current.
function currentStep(): number | null {
  const row = document.querySelector<HTMLTableRowElement>(
    '[data-testid="trace-row"][aria-current="step"]',
  );
  if (!row) return null;
  return Number(row.dataset.step);
}

beforeEach(() => {
  // Default to motion ON; individual tests can override matchMedia.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cleanup();
});

describe('SnippetPanel', () => {
  it('S-snippet-panel-renders-caption: renders the snippet description', () => {
    render(SnippetPanel, { snippet: stubSnippet() });
    // Caption renders in <h2> AND in the lesson-notes placeholder — scope to
    // the heading so the assertion picks the right element.
    expect(
      screen.getByRole('heading', { name: 'A test snippet' }),
    ).toBeInTheDocument();
  });

  it('S-snippet-panel-renders-caption: falls back to id when description is absent', () => {
    render(SnippetPanel, {
      snippet: stubSnippet({ description: undefined, id: 'fallback-id' }),
    });
    expect(
      screen.getByRole('heading', { name: 'fallback-id' }),
    ).toBeInTheDocument();
  });

  it('S-snippet-panel-static-on-mount: sits on frame 0 when inactive', () => {
    render(SnippetPanel, { snippet: stubSnippet() });
    // Default active=false → no row carries aria-current.
    expect(currentStep()).toBe(null);
  });

  it('S-snippet-panel-active-plays: advances frames once active is set', () => {
    render(SnippetPanel, {
      snippet: stubSnippet({ intervalMs: 100 }),
      active: true,
    });
    // The active-toggle $effect resets the player and schedules the timer.
    vi.advanceTimersByTime(100);
    flushSync();
    expect(currentStep()).toBe(1);
    vi.advanceTimersByTime(100);
    flushSync();
    expect(currentStep()).toBe(2);
  });

  it('S-snippet-panel-freeze-at-halt: timer stops at the last frame, highlight clears, Replay appears', () => {
    render(SnippetPanel, {
      snippet: stubSnippet({ intervalMs: 50 }),
      active: true,
    });
    // 3 frames: index 0 → 1 → 2 (done). 2 ticks reach the last frame.
    vi.advanceTimersByTime(50);
    vi.advanceTimersByTime(50);
    flushSync();
    expect(currentStep()).toBe(2);
    // One more tick: player.forward() returns false → highlight clears (natural-end parity).
    vi.advanceTimersByTime(50);
    flushSync();
    expect(currentStep()).toBe(null);
    // Replay button appears.
    expect(screen.getByRole('button', { name: /Replay/i })).toBeInTheDocument();
  });

  it('S-snippet-panel-replay-resets: Replay jumps back to frame 0 and replays', async () => {
    render(SnippetPanel, {
      snippet: stubSnippet({ intervalMs: 50 }),
      active: true,
    });
    vi.advanceTimersByTime(50);
    vi.advanceTimersByTime(50);
    flushSync();
    expect(currentStep()).toBe(2);
    await fireEvent.click(screen.getByRole('button', { name: /Replay/i }));
    flushSync();
    expect(currentStep()).toBe(null);
    vi.advanceTimersByTime(50);
    flushSync();
    expect(currentStep()).toBe(1);
  });

  it('S-snippet-panel-inactive-pauses: inactive mid-playback preserves the current row', async () => {
    const snippet = stubSnippet({ intervalMs: 50 });
    const { rerender } = render(SnippetPanel, { snippet, active: true });
    vi.advanceTimersByTime(50);
    flushSync();
    expect(currentStep()).toBe(1);
    // Pause: highlight stays at frame 1, timer stops, no further advance.
    await rerender({ snippet, active: false });
    flushSync();
    expect(currentStep()).toBe(1);
    vi.advanceTimersByTime(500);
    flushSync();
    expect(currentStep()).toBe(1);
    // Resume: ticks pick up from where we paused — next tick lands on 2.
    await rerender({ snippet, active: true });
    flushSync();
    vi.advanceTimersByTime(50);
    flushSync();
    expect(currentStep()).toBe(2);
  });

  it('S-snippet-panel-done-no-autoreplay: a finished snippet does not auto-replay on re-activation', async () => {
    const snippet = stubSnippet({ intervalMs: 50 });
    const { rerender } = render(SnippetPanel, { snippet, active: true });
    // Run to completion: 2 advances reach the last frame, a 3rd triggers
    // the natural-end cleanup that flips state to 'done'.
    vi.advanceTimersByTime(50);
    vi.advanceTimersByTime(50);
    vi.advanceTimersByTime(50);
    flushSync();
    expect(currentStep()).toBe(null);
    expect(screen.getByRole('button', { name: /Replay/i })).toBeInTheDocument();
    // Scroll away and back — no auto-replay, no highlight.
    await rerender({ snippet, active: false });
    flushSync();
    await rerender({ snippet, active: true });
    flushSync();
    vi.advanceTimersByTime(500);
    flushSync();
    expect(currentStep()).toBe(null);
    expect(screen.getByRole('button', { name: /Replay/i })).toBeInTheDocument();
  });

  it('S-snippet-panel-reduced-motion: jumps to the final frame on mount, ignores active', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query.includes('reduce'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    // Even with active=false, reduced motion pins to the final frame —
    // matches the graph's static final-frame snapshot.
    render(SnippetPanel, { snippet: stubSnippet(), active: false });
    expect(currentStep()).toBe(2);
    // Play button shown (instead of Replay) under reduced motion.
    expect(screen.getByRole('button', { name: /Play/i })).toBeInTheDocument();
  });

  it('S-snippet-panel-deep-link: Open-in-editor link points at /engine?example=id', () => {
    render(SnippetPanel, {
      snippet: stubSnippet({ engine: 'post', id: 'pe-1' }),
    });
    const link = screen.getByRole('link', { name: /Open in editor/i });
    expect(link).toHaveAttribute('href', '/post?example=pe-1');
  });
});
