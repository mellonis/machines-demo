// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
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

  describe('disabled', () => {
    it('C-toolbar-disabled-build: loadDisabled disables Build button', () => {
      render(Toolbar, { props: { ...defaultProps(), loadDisabled: true } });
      expect(screen.getByRole('button', { name: /^build$/i })).toBeDisabled();
    });

    it('C-toolbar-disabled-step: stepDisabled disables Step button', () => {
      render(Toolbar, { props: { ...defaultProps(), stepDisabled: true } });
      expect(screen.getByRole('button', { name: /^step$/i })).toBeDisabled();
    });

    it('C-toolbar-disabled-run-cascade: runDisabled disables Run + with-pause + debug', () => {
      render(Toolbar, { props: { ...defaultProps(), executionMode: 'DEMO', runDisabled: true } });
      expect(screen.getByRole('button', { name: /^run$/i })).toBeDisabled();
      expect(screen.getByRole('checkbox', { name: /with pause/i })).toBeDisabled();
      expect(screen.getByRole('checkbox', { name: /^debug$/i })).toBeDisabled();
    });
  });

  describe('visibility', () => {
    it('C-toolbar-config-visible-demo: with-pause + debug checkboxes render in DEMO', () => {
      render(Toolbar, { props: { ...defaultProps(), executionMode: 'DEMO' } });
      expect(screen.getByRole('checkbox', { name: /with pause/i })).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: /^debug$/i })).toBeInTheDocument();
    });

    it('C-toolbar-config-hidden-running-auto: config row absent in RUNNING_AUTO', () => {
      render(Toolbar, { props: { ...defaultProps(), executionMode: 'RUNNING_AUTO' } });
      expect(screen.queryByRole('checkbox', { name: /with pause/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('checkbox', { name: /^debug$/i })).not.toBeInTheDocument();
    });

    it('C-toolbar-stop-visible-running-step: Stop button renders in RUNNING_STEP', () => {
      render(Toolbar, { props: { ...defaultProps(), executionMode: 'RUNNING_STEP' } });
      expect(screen.getByRole('button', { name: /^stop$/i })).toBeInTheDocument();
    });

    it('C-toolbar-stop-hidden-halted: Stop button absent in HALTED', () => {
      render(Toolbar, { props: { ...defaultProps(), executionMode: 'HALTED' } });
      expect(screen.queryByRole('button', { name: /^stop$/i })).not.toBeInTheDocument();
    });
  });

  describe('interval', () => {
    it('C-toolbar-interval-invalid: intervalIsValid=false marks input .invalid', () => {
      render(Toolbar, {
        props: {
          ...defaultProps(),
          executionMode: 'DEMO',
          withPause: true,
          intervalIsValid: false,
        },
      });
      const input = screen.getByPlaceholderText('1s');
      expect(input.classList.contains('invalid')).toBe(true);
    });
  });

  describe('callbacks', () => {
    it('C-toolbar-callback-build: clicking Build invokes onBuild', async () => {
      const props = defaultProps();
      render(Toolbar, { props });
      await fireEvent.click(screen.getByRole('button', { name: /^build$/i }));
      expect(props.onBuild).toHaveBeenCalledTimes(1);
    });

    it('C-toolbar-callback-step: clicking Step invokes onStep', async () => {
      const props = defaultProps();
      render(Toolbar, { props });
      await fireEvent.click(screen.getByRole('button', { name: /^step$/i }));
      expect(props.onStep).toHaveBeenCalledTimes(1);
    });

    it('C-toolbar-callback-run-stop: Run invokes onRun; Stop (in RUNNING_STEP) invokes onStop', async () => {
      const propsA = defaultProps();
      const { unmount } = render(Toolbar, { props: propsA });
      await fireEvent.click(screen.getByRole('button', { name: /^run$/i }));
      expect(propsA.onRun).toHaveBeenCalledTimes(1);
      unmount();

      const propsB = { ...defaultProps(), executionMode: 'RUNNING_STEP' as Mode };
      render(Toolbar, { props: propsB });
      await fireEvent.click(screen.getByRole('button', { name: /^stop$/i }));
      expect(propsB.onStop).toHaveBeenCalledTimes(1);
    });
  });
});
