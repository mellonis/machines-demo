// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import Toolbar from './Toolbar.svelte';
import type { Example } from '../lib/defaultCode';
import type { Snippets } from '../lib/persist';

type Mode =
  | 'DEMO' | 'MANUAL'
  | 'RUNNING_STEP' | 'RUNNING_AUTO' | 'RUNNING_CONTINUOUS'
  | 'RUNNING_PAUSED_AT_BREAK'
  | 'HALTED';

function defaultProps() {
  return {
    executionMode: 'DEMO' as Mode,
    loadDisabled: false,
    stepDisabled: false,
    runDisabled: false,
    intervalIsValid: true,
    examples: [] as readonly Example[],
    selectedExampleId: '',
    withPause: false,
    debugMode: false,
    intervalText: '1s',
    snippets: {} as Snippets,
    loadedSnippetId: null,
    dirty: false,
    onBuild: vi.fn(),
    onStep: vi.fn(),
    onRun: vi.fn(),
    onStop: vi.fn(),
    onPickExample: vi.fn(),
    onSaveSnippet: vi.fn(),
    onSaveChanges: vi.fn(),
    onLoadSnippet: vi.fn(),
    onDeleteSnippet: vi.fn(),
    onRenameSnippet: vi.fn(),
  };
}

describe('Toolbar', () => {
  afterEach(() => cleanup());

  describe('runLabel', () => {
    it('C-toolbar-run-label-default: shows "Run" outside paused', () => {
      render(Toolbar, { props: { ...defaultProps(), executionMode: 'DEMO' } });
      expect(screen.getByRole('button', { name: /^run$/i })).toBeInTheDocument();
    });

    it('C-toolbar-run-label-paused: shows "Continue" in RUNNING_PAUSED_AT_BREAK', () => {
      render(Toolbar, { props: { ...defaultProps(), executionMode: 'RUNNING_PAUSED_AT_BREAK' } });
      expect(screen.getByRole('button', { name: /^continue$/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^run$/i })).not.toBeInTheDocument();
    });

    it('C-toolbar-step-label-default: shows "Step" outside running-auto', () => {
      render(Toolbar, { props: { ...defaultProps(), executionMode: 'DEMO' } });
      expect(screen.getByRole('button', { name: /^step$/i })).toBeInTheDocument();
    });

    it('C-toolbar-step-label-running-auto: shows "Pause" in RUNNING_AUTO', () => {
      render(Toolbar, { props: { ...defaultProps(), executionMode: 'RUNNING_AUTO' } });
      expect(screen.getByRole('button', { name: /^pause$/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^step$/i })).not.toBeInTheDocument();
    });
  });
});
