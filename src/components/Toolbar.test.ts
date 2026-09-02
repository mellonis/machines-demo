// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/svelte';
import Toolbar from './Toolbar.svelte';
import type { Example } from '../lib/defaultCode';
import type { Snippets } from '../lib/persist';

type Mode =
  | 'MANUAL'
  | 'RUNNING_AUTO' | 'RUNNING_CONTINUOUS'
  | 'RUNNING_PAUSED'
  | 'HALTED';

function defaultProps() {
  return {
    executionMode: 'MANUAL' as Mode,
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
    staleBuild: false,
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
      render(Toolbar, { props: { ...defaultProps(), executionMode: 'MANUAL' } });
      expect(screen.getByRole('button', { name: /^run$/i })).toBeInTheDocument();
    });

    it('C-toolbar-run-label-paused: shows "Continue" in RUNNING_PAUSED', () => {
      render(Toolbar, { props: { ...defaultProps(), executionMode: 'RUNNING_PAUSED' } });
      expect(screen.getByRole('button', { name: /^continue$/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^run$/i })).not.toBeInTheDocument();
    });

    it('C-toolbar-run-label-running-auto: shows "Continue" in RUNNING_AUTO (run already in flight)', () => {
      render(Toolbar, { props: { ...defaultProps(), executionMode: 'RUNNING_AUTO' } });
      expect(screen.getByRole('button', { name: /^continue$/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^run$/i })).not.toBeInTheDocument();
    });

    it('C-toolbar-run-label-running-continuous: shows "Continue" in RUNNING_CONTINUOUS (run already in flight)', () => {
      render(Toolbar, { props: { ...defaultProps(), executionMode: 'RUNNING_CONTINUOUS' } });
      expect(screen.getByRole('button', { name: /^continue$/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^run$/i })).not.toBeInTheDocument();
    });

    it('C-toolbar-step-label-default: shows "Step" outside running-auto', () => {
      render(Toolbar, { props: { ...defaultProps(), executionMode: 'MANUAL' } });
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
      render(Toolbar, { props: { ...defaultProps(), executionMode: 'MANUAL', runDisabled: true } });
      expect(screen.getByRole('button', { name: /^run$/i })).toBeDisabled();
      expect(screen.getByRole('checkbox', { name: /with pause/i })).toBeDisabled();
      expect(screen.getByRole('checkbox', { name: /^debug$/i })).toBeDisabled();
    });
  });

  describe('visibility', () => {
    it('C-toolbar-config-visible-manual: with-pause + debug checkboxes render in MANUAL', () => {
      render(Toolbar, { props: { ...defaultProps(), executionMode: 'MANUAL' } });
      expect(screen.getByRole('checkbox', { name: /with pause/i })).toBeInTheDocument();
      expect(screen.getByRole('checkbox', { name: /^debug$/i })).toBeInTheDocument();
    });

    it('C-toolbar-config-hidden-running-auto: config row absent in RUNNING_AUTO', () => {
      render(Toolbar, { props: { ...defaultProps(), executionMode: 'RUNNING_AUTO' } });
      expect(screen.queryByRole('checkbox', { name: /with pause/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('checkbox', { name: /^debug$/i })).not.toBeInTheDocument();
    });

    it('C-toolbar-stop-visible-running-paused: Stop button renders in RUNNING_PAUSED', () => {
      render(Toolbar, { props: { ...defaultProps(), executionMode: 'RUNNING_PAUSED' } });
      expect(screen.getByRole('button', { name: /^stop$/i })).toBeInTheDocument();
    });

    it('C-toolbar-stop-hidden-halted: Stop button absent in HALTED', () => {
      render(Toolbar, { props: { ...defaultProps(), executionMode: 'HALTED' } });
      expect(screen.queryByRole('button', { name: /^stop$/i })).not.toBeInTheDocument();
    });

    it('C-toolbar-stop-visible-running-auto: Stop button renders in RUNNING_AUTO', () => {
      render(Toolbar, { props: { ...defaultProps(), executionMode: 'RUNNING_AUTO' } });
      expect(screen.getByRole('button', { name: /^stop$/i })).toBeInTheDocument();
    });

    it('C-toolbar-stop-visible-running-continuous: Stop button renders in RUNNING_CONTINUOUS (kill-switch for continuous runs)', () => {
      render(Toolbar, { props: { ...defaultProps(), executionMode: 'RUNNING_CONTINUOUS' } });
      expect(screen.getByRole('button', { name: /^stop$/i })).toBeInTheDocument();
    });

    it('C-toolbar-pause-label-running-auto: Step button shows "Pause" label in RUNNING_AUTO (doubles as Pause)', () => {
      render(Toolbar, { props: { ...defaultProps(), executionMode: 'RUNNING_AUTO' } });
      expect(screen.getByRole('button', { name: /^pause$/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^step$/i })).not.toBeInTheDocument();
    });
  });

  describe('interval', () => {
    it('C-toolbar-interval-invalid: intervalIsValid=false marks input .invalid', () => {
      render(Toolbar, {
        props: {
          ...defaultProps(),
          executionMode: 'MANUAL',
          withPause: true,
          intervalIsValid: false,
        },
      });
      const input = screen.getByPlaceholderText('1s');
      expect(input.classList.contains('invalid')).toBe(true);
    });
  });

  describe('stale build', () => {
    it('C-toolbar-stale-dot-visible: Build button carries the stale accent + title when staleBuild', () => {
      render(Toolbar, { props: { ...defaultProps(), staleBuild: true } });
      const build = screen.getByRole('button', { name: /^build$/i });
      expect(build).toHaveClass('stale');
      expect(build).toHaveAttribute('title', 'code changed since last Build');
    });

    it('C-toolbar-stale-dot-hidden: no stale accent or title when the build is current', () => {
      render(Toolbar, { props: defaultProps() });
      const build = screen.getByRole('button', { name: /^build$/i });
      expect(build).not.toHaveClass('stale');
      expect(build).not.toHaveAttribute('title');
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

    it('C-toolbar-callback-run-stop: Run invokes onRun; Stop (in RUNNING_PAUSED) invokes onStop', async () => {
      const propsA = defaultProps();
      const { unmount } = render(Toolbar, { props: propsA });
      await fireEvent.click(screen.getByRole('button', { name: /^run$/i }));
      expect(propsA.onRun).toHaveBeenCalledTimes(1);
      unmount();

      const propsB = { ...defaultProps(), executionMode: 'RUNNING_PAUSED' as Mode };
      render(Toolbar, { props: propsB });
      await fireEvent.click(screen.getByRole('button', { name: /^stop$/i }));
      expect(propsB.onStop).toHaveBeenCalledTimes(1);
    });
  });

  describe('format and file menu', () => {
    it('C-toolbar-format-hidden: no Format button without onFormat', () => {
      render(Toolbar, { props: defaultProps() });
      expect(screen.queryByRole('button', { name: /^format$/i })).not.toBeInTheDocument();
    });

    it('C-toolbar-format-click: Format calls onFormat', async () => {
      const onFormat = vi.fn();
      render(Toolbar, { props: { ...defaultProps(), onFormat } });
      await fireEvent.click(screen.getByRole('button', { name: /^format$/i }));
      expect(onFormat).toHaveBeenCalledTimes(1);
    });

    it('C-toolbar-file-menu: Open / Save render only with their callbacks; Save calls back; Open forwards the picked file', async () => {
      const onOpenFile = vi.fn();
      const onSaveFile = vi.fn();
      render(Toolbar, { props: { ...defaultProps(), onOpenFile, onSaveFile } });
      await fireEvent.click(screen.getByRole('button', { name: 'Save source file' }));
      expect(onSaveFile).toHaveBeenCalledTimes(1);
      const input = screen.getByTestId('open-file-input') as HTMLInputElement;
      const file = new File(['main() {}'], 'x.pmc', { type: 'text/plain' });
      Object.defineProperty(input, 'files', { value: [file] });
      await fireEvent.change(input);
      expect(onOpenFile).toHaveBeenCalledWith(file);
    });
  });
});
