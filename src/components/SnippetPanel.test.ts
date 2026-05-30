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
    graph: { initialId: 0, alphabets: [[' ', 'a', 'b']], nodes: {} } as never,
    alphabets: [[' ', 'a', 'b']],
    frames: [
      { step: 0, tape: [{ symbols: ['a', 'b'], position: 0 }], highlight: null },
      { step: 1, tape: [{ symbols: ['b', 'b'], position: 1 }], highlight: null },
      { step: 2, tape: [{ symbols: ['b', 'a'], position: 1 }], highlight: null },
    ],
    ...overrides,
  };
}

// IntersectionObserver test double: stores the callback on the constructed
// instance so a test can `instance.fire(true)` to simulate scroll-into-view.
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  callback: IntersectionObserverCallback;
  observed: Element[] = [];
  disconnected = false;
  constructor(cb: IntersectionObserverCallback) {
    this.callback = cb;
    FakeIntersectionObserver.instances.push(this);
  }
  observe(el: Element) { this.observed.push(el); }
  disconnect() { this.disconnected = true; }
  unobserve() {}
  takeRecords() { return []; }
  root = null;
  rootMargin = '';
  thresholds: number[] = [];
  fire(isIntersecting: boolean) {
    this.callback(
      [{ isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
}

beforeEach(() => {
  FakeIntersectionObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
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
    expect(screen.getByText('A test snippet')).toBeInTheDocument();
  });

  it('S-snippet-panel-renders-caption: falls back to id when description is absent', () => {
    render(SnippetPanel, {
      snippet: stubSnippet({ description: undefined, id: 'fallback-id' }),
    });
    expect(screen.getByText('fallback-id')).toBeInTheDocument();
  });

  it('S-snippet-panel-static-on-mount: sits on frame 0 until IO fires', () => {
    render(SnippetPanel, { snippet: stubSnippet() });
    expect(screen.getByTestId('snippet-frame-index').textContent).toBe('0');
  });

  it('S-snippet-panel-autoplay-on-intersect: advances frames after intersect', () => {
    render(SnippetPanel, { snippet: stubSnippet({ intervalMs: 100 }) });
    expect(FakeIntersectionObserver.instances).toHaveLength(1);
    const io = FakeIntersectionObserver.instances[0];
    io.fire(true);
    expect(io.disconnected).toBe(true);
    // Advance interval — should step to frame 1.
    vi.advanceTimersByTime(100);
    flushSync();
    expect(screen.getByTestId('snippet-frame-index').textContent).toBe('1');
    vi.advanceTimersByTime(100);
    flushSync();
    expect(screen.getByTestId('snippet-frame-index').textContent).toBe('2');
  });

  it('S-snippet-panel-freeze-at-halt: timer stops at the last frame and Replay appears', () => {
    render(SnippetPanel, { snippet: stubSnippet({ intervalMs: 50 }) });
    FakeIntersectionObserver.instances[0].fire(true);
    // 3 frames: index 0 → 1 → 2 (done). 2 ticks reach done.
    vi.advanceTimersByTime(50);
    vi.advanceTimersByTime(50);
    flushSync();
    expect(screen.getByTestId('snippet-frame-index').textContent).toBe('2');
    // Extra ticks must not advance past the last frame.
    vi.advanceTimersByTime(500);
    flushSync();
    expect(screen.getByTestId('snippet-frame-index').textContent).toBe('2');
    // Replay button appears when done.
    expect(screen.getByRole('button', { name: /Replay/i })).toBeInTheDocument();
  });

  it('S-snippet-panel-replay-resets: Replay jumps back to frame 0 and replays', async () => {
    render(SnippetPanel, { snippet: stubSnippet({ intervalMs: 50 }) });
    FakeIntersectionObserver.instances[0].fire(true);
    vi.advanceTimersByTime(50);
    vi.advanceTimersByTime(50);
    flushSync();
    expect(screen.getByTestId('snippet-frame-index').textContent).toBe('2');
    await fireEvent.click(screen.getByRole('button', { name: /Replay/i }));
    flushSync();
    expect(screen.getByTestId('snippet-frame-index').textContent).toBe('0');
    vi.advanceTimersByTime(50);
    flushSync();
    expect(screen.getByTestId('snippet-frame-index').textContent).toBe('1');
  });

  it('S-snippet-panel-reduced-motion: jumps to the final frame on mount, no IO', () => {
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
    render(SnippetPanel, { snippet: stubSnippet() });
    expect(screen.getByTestId('snippet-frame-index').textContent).toBe('2');
    // No IntersectionObserver should have been created under reduced motion.
    expect(FakeIntersectionObserver.instances).toHaveLength(0);
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
