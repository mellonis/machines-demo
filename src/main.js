import { EditorView, basicSetup } from 'codemirror';
import { javascript, javascriptLanguage } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import * as turingNs from '@turing-machine-js/machine';
import * as postNs from '@post-machine-js/machine';
import { MachineRunner } from './runner.js';
import { UiBelt } from './uiBelt.js';
import { ControlPanel } from './controlPanel.js';
import { icons } from './icons.js';
import pkg from '../package.json';

const APP_VERSION = pkg.version;

function buildCompletions(ns) {
  return Object.keys(ns)
    .filter((k) => k !== 'default')
    .sort()
    .map((name) => {
      const v = ns[name];
      let type = 'variable';
      if (typeof v === 'function') {
        type = /^[A-Z]/.test(name) ? 'class' : 'function';
      }
      return { label: name, type };
    });
}

const COMPLETIONS = {
  turing: buildCompletions(turingNs),
  post: buildCompletions(postNs),
};

function importsCompletion(options) {
  return javascriptLanguage.data.of({
    autocomplete: (context) => {
      const word = context.matchBefore(/[\w$]+/);
      if (!word || (word.from === word.to && !context.explicit)) return null;
      return { from: word.from, options, validFor: /^[\w$]*$/ };
    },
  });
}

const TURING_DEFAULT = `// Replace every 'b' on the tape with '*'.
// Available imports (named exports of @turing-machine-js/machine):
//   Alphabet, State, Tape, TapeBlock, TuringMachine,
//   haltState, ifOtherSymbol, movements, symbolCommands, ...
// Return: { machine, initialState, tape }

const {
  Alphabet, State, Tape, TapeBlock, TuringMachine,
  haltState, ifOtherSymbol, movements,
} = imports;

const alphabet = new Alphabet([' ', 'a', 'b', 'c', '*']);
const tape = new Tape({ alphabet, symbols: ['a', 'b', 'c', 'b', 'a'] });
const tapeBlock = TapeBlock.fromTapes([tape]);
const machine = new TuringMachine({ tapeBlock });

const initialState = new State({
  [tapeBlock.symbol(['b'])]: {
    command: [{ symbol: '*', movement: movements.right }],
  },
  [tapeBlock.symbol([alphabet.blankSymbol])]: {
    command: [{ movement: movements.left }],
    nextState: haltState,
  },
  [ifOtherSymbol]: {
    command: [{ movement: movements.right }],
  },
});

return { machine, initialState, tape };
`;

const POST_DEFAULT = `// Walk right while marked; mark the first blank cell found.
// Available imports (named exports of @post-machine-js/machine):
//   PostMachine, Tape, alphabet, blankSymbol, markSymbol,
//   call, check, erase, left, mark, noop, right, stop, ...
// Return: { machine } — initialState and tape default from the machine.

const { PostMachine, Tape, check, mark, right, stop } = imports;

const machine = new PostMachine({
  10: check(20, 30),
  20: right(10),
  30: mark,
  40: stop,
});

machine.replaceTapeWith(new Tape({
  alphabet: machine.tape.alphabet,
  symbols: ['*', '*', ' '],
}));

return { machine };
`;

function decorateButton(btn, iconSvg) {
  const label = btn.textContent;
  btn.innerHTML = `${iconSvg}<span class="btn-label">${label}</span>`;
}

function setStatus(el, text, kind) {
  el.textContent = text;
  el.classList.remove('error', 'ok');
  if (kind) el.classList.add(kind);
}

function appendLog(logEl, text, kind) {
  if (!logEl) return;
  const line = document.createElement('div');
  line.className = 'log-line';
  if (kind) line.classList.add(kind);
  line.textContent = text;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

const MODE = {
  DEMO: 'DEMO',
  MANUAL: 'MANUAL',
  RUNNING_STEP: 'RUNNING_STEP',
  RUNNING_AUTO: 'RUNNING_AUTO',
  RUNNING_CONTINUOUS: 'RUNNING_CONTINUOUS',
  HALTED: 'HALTED',
};

const MIN_AUTO_INTERVAL_MS = 500;

function parseInterval(str) {
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m)?$/i.exec((str || '').trim());
  if (!match) return null;
  const n = parseFloat(match[1]);
  const unit = (match[2] || 's').toLowerCase();
  const ms = unit === 'ms' ? n : unit === 's' ? n * 1000 : n * 60000;
  return ms >= MIN_AUTO_INTERVAL_MS ? Math.round(ms) : null;
}

function setButtonIcon(btn, iconSvg) {
  const labelEl = btn.querySelector('.btn-label');
  const label = labelEl ? labelEl.textContent : btn.textContent.trim();
  btn.innerHTML = `${iconSvg}<span class="btn-label">${label}</span>`;
}

function describeCommand(cmd) {
  if (!cmd) return '';
  const sym = cmd.symbol === null || cmd.symbol === undefined
    ? 'keep'
    : `wrote '${cmd.symbol === ' ' ? '␣' : cmd.symbol}'`;
  const mv = cmd.movement === 'L' ? 'left' : cmd.movement === 'R' ? 'right' : 'stay';
  return `${sym} + ${mv}`;
}

function formatAlphabet(alphabet) {
  if (!alphabet) return '';
  return alphabet.map((s, i) => i === 0 ? '␣' : `'${s}'`).join(', ');
}

function formatTape(tape) {
  if (!tape) return '';
  return tape.symbols.map((sym, i) => {
    const display = sym === tape.blank ? '␣' : sym;
    return i === tape.position ? `[${display}]` : display;
  }).join(' ');
}

function appendLogBatch(logEl, entries) {
  if (!logEl || !entries.length) return;
  const frag = document.createDocumentFragment();
  entries.forEach(({ text, kind }) => {
    const line = document.createElement('div');
    line.className = 'log-line';
    if (kind) line.classList.add(kind);
    line.textContent = text;
    frag.appendChild(line);
  });
  logEl.appendChild(frag);
  logEl.scrollTop = logEl.scrollHeight;
}

const SYNTHETIC_ALPHABET = [' ', 'a', 'b', '*'];
const DEMO_INTERVAL_MS = 1600;
const DEMO_REFLECT_DELAY_MS = 700;
const BELT_ANIM_MS = 400;
const NEUTRAL_COMMAND = { movement: 'S', symbol: null };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomDemoCommand(alphabet) {
  const movement = pickRandom(['L', 'S', 'R']);
  const useKeep = Math.random() < 0.4;
  const symbol = useKeep ? null : pickRandom(alphabet);
  return { movement, symbol };
}

function wireTab(section) {
  const mode = section.dataset.mode;
  const tapeEl = section.querySelector('[data-role="tape"]');
  const controlPanelEl = section.querySelector('[data-role="control-panel"]');
  const statusEl = section.querySelector('[data-role="status"]');
  const logEl = section.querySelector('[data-role="log"]');
  const logClearBtn = section.querySelector('[data-role="log-clear"]');
  if (logClearBtn) {
    logClearBtn.innerHTML = icons.eraser;
    logClearBtn.addEventListener('click', () => {
      if (logEl) logEl.innerHTML = '';
    });
  }
  const codeEl = section.querySelector('[data-role="code"]');
  const versionEl = section.querySelector('[data-role="version"]');
  if (versionEl) versionEl.textContent = `v${APP_VERSION}`;
  const loadBtn = section.querySelector('[data-role="load"]');
  const stepBtn = section.querySelector('[data-role="step"]');
  const runBtn = section.querySelector('[data-role="run"]');
  const takeControlBtn = section.querySelector('[data-role="take-control"]');
  const withPauseCb = section.querySelector('[data-role="with-pause"]');
  const intervalInput = section.querySelector('[data-role="interval"]');
  decorateButton(loadBtn, icons.load);
  decorateButton(stepBtn, icons.step);
  decorateButton(runBtn, icons.run);
  decorateButton(takeControlBtn, icons.takeControl);

  let runIntentDisabled = true;
  const intervalIsValid = () => parseInterval(intervalInput.value) !== null;
  const refreshIntervalUi = () => intervalInput.classList.toggle('invalid', !intervalIsValid());
  const applyRunDisabled = () => {
    const intervalBlocks = withPauseCb.checked && !intervalIsValid();
    runBtn.disabled = runIntentDisabled || intervalBlocks;
    withPauseCb.disabled = runBtn.disabled;
  };
  const setRunDisabled = (disabled) => {
    runIntentDisabled = disabled;
    applyRunDisabled();
  };

  withPauseCb.addEventListener('change', () => {
    intervalInput.classList.toggle('hidden', !withPauseCb.checked);
    refreshIntervalUi();
    applyRunDisabled();
  });
  intervalInput.addEventListener('input', () => {
    refreshIntervalUi();
    applyRunDisabled();
  });
  refreshIntervalUi();

  const storageKey = `machines-demo:code:${mode}`;
  const defaultCode = mode === 'turing' ? TURING_DEFAULT : POST_DEFAULT;
  const initialCode = (() => {
    try {
      return localStorage.getItem(storageKey) ?? defaultCode;
    } catch {
      return defaultCode;
    }
  })();
  const persist = EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;
    try {
      localStorage.setItem(storageKey, update.state.doc.toString());
    } catch { /* quota / private mode — ignore */ }
  });
  const editor = new EditorView({
    doc: initialCode,
    extensions: [
      basicSetup,
      javascript(),
      oneDark,
      importsCompletion(COMPLETIONS[mode]),
      persist,
    ],
    parent: codeEl,
  });
  const getCode = () => editor.state.doc.toString();

  const runner = new MachineRunner(mode);
  const belt = new UiBelt(tapeEl);

  const report = (text, kind) => {
    setStatus(statusEl, text, kind);
    appendLog(logEl, text, kind);
  };

  let currentMode = MODE.DEMO;
  let userTookControl = false;
  let demoEnabled = true;
  let demoTimer = null;
  let demoApplyTimer = null;
  let autoTimer = null;
  let autoInFlight = false;
  let lastWorkerSnapshot = null;
  let beltAlphabet = SYNTHETIC_ALPHABET;
  let halted = false;

  function demoTick() {
    const cmd = randomDemoCommand(beltAlphabet);
    panel.reflect(cmd);
    demoApplyTimer = setTimeout(() => {
      demoApplyTimer = null;
      panel.flashApply();
      belt.apply(cmd, { animate: true });
    }, DEMO_REFLECT_DELAY_MS);
  }

  function startDemoTimer() {
    stopDemoTimer();
    if (!demoEnabled) return;
    demoTick();
    demoTimer = setInterval(demoTick, DEMO_INTERVAL_MS);
  }

  function stopDemoTimer() {
    if (demoTimer) {
      clearInterval(demoTimer);
      demoTimer = null;
    }
    if (demoApplyTimer) {
      clearTimeout(demoApplyTimer);
      demoApplyTimer = null;
    }
  }

  function setTakeControlVisible(on) {
    takeControlBtn.classList.toggle('hidden', !on);
  }

  function setStepIcon(mode) {
    const isAuto = mode === MODE.RUNNING_AUTO;
    setButtonIcon(stepBtn, isAuto ? icons.pause : icons.step);
    const labelEl = stepBtn.querySelector('.btn-label');
    if (labelEl) labelEl.textContent = isAuto ? 'Pause' : 'Step';
  }

  async function autoTick() {
    if (autoInFlight || currentMode !== MODE.RUNNING_AUTO) return;
    autoInFlight = true;
    try {
      const res = await runner.step();
      lastWorkerSnapshot = res.tape;
      halted = res.halted;
      if (currentMode !== MODE.RUNNING_AUTO) return;
      if (res.command) {
        panel.reflect(res.command);
        belt.apply(res.command, { animate: true });
      } else {
        belt.setFromSnapshot(res.tape);
      }
      if (res.halted) {
        stopAutoTimer();
        report(`halted after ${res.stepsApplied} step(s)`, 'ok');
        applyMode(MODE.HALTED);
      } else {
        report(`step ${res.stepsApplied}: ${describeCommand(res.command)}`);
      }
    } catch (err) {
      stopAutoTimer();
      report(`error: ${err.message}`, 'error');
      halted = true;
      applyMode(MODE.HALTED);
    } finally {
      autoInFlight = false;
    }
  }

  function startAutoTimer(intervalMs) {
    stopAutoTimer();
    autoTick();
    autoTimer = setInterval(autoTick, intervalMs);
  }

  function stopAutoTimer() {
    if (autoTimer) {
      clearInterval(autoTimer);
      autoTimer = null;
    }
  }

  function applyMode(next) {
    currentMode = next;
    panel.setVisible(true);
    panel.setApplyVisible(true);
    belt.setTransitionsEnabled(true);
    stopDemoTimer();
    if (next !== MODE.RUNNING_AUTO) stopAutoTimer();
    setStepIcon(next);
    switch (next) {
      case MODE.DEMO:
        panel.setEnabled(false);
        setTakeControlVisible(true);
        startDemoTimer();
        break;
      case MODE.MANUAL:
        panel.setEnabled(true);
        setTakeControlVisible(false);
        break;
      case MODE.RUNNING_STEP:
        panel.setEnabled(false);
        panel.setApplyVisible(false);
        setTakeControlVisible(true);
        break;
      case MODE.RUNNING_AUTO:
        panel.setEnabled(false);
        panel.setApplyVisible(false);
        setTakeControlVisible(true);
        setRunDisabled(true);
        stepBtn.disabled = false;
        break;
      case MODE.RUNNING_CONTINUOUS:
        panel.setEnabled(false);
        panel.setApplyVisible(false);
        setTakeControlVisible(false);
        belt.setTransitionsEnabled(false);
        break;
      case MODE.HALTED:
        panel.setEnabled(false);
        panel.setApplyVisible(false);
        setTakeControlVisible(true);
        break;
    }
  }

  function takeControl() {
    userTookControl = true;
    applyMode(MODE.MANUAL);
  }

  function idleMode() {
    return userTookControl ? MODE.MANUAL : MODE.DEMO;
  }

  const panel = new ControlPanel(controlPanelEl, {
    onApply: (cmd) => {
      belt.apply(cmd, { animate: true });
      appendLog(logEl, `applied: ${describeCommand(cmd)}`);
    },
  });
  panel.setAlphabet(SYNTHETIC_ALPHABET);
  takeControlBtn.addEventListener('click', takeControl);
  applyMode(MODE.DEMO);

  function setBusy(busy) {
    loadBtn.disabled = busy;
    stepBtn.disabled = busy || !runner.worker || halted;
    setRunDisabled(busy || !runner.worker || halted);
  }

  async function doLoad({ userInitiated = false } = {}) {
    if (userInitiated) {
      demoEnabled = false;
      stopDemoTimer();
    }
    report('loading…');
    setBusy(true);
    try {
      const res = await runner.load(getCode());
      panel.setAlphabet(res.alphabet);
      beltAlphabet = res.alphabet;
      belt.setFromSnapshot(res.tape);
      lastWorkerSnapshot = res.tape;
      halted = res.halted;
      appendLog(logEl, `alphabet: ${formatAlphabet(res.alphabet)}`);
      appendLog(logEl, `tape: ${formatTape(res.tape)}`);
      if (res.halted) {
        report('loaded — halted immediately', 'ok');
      } else {
        report('loaded — ready', 'ok');
      }
      applyMode(idleMode());
      if (res.nextCommand) {
        panel.reflect(res.nextCommand);
      }
      loadBtn.disabled = false;
      stepBtn.disabled = halted;
      setRunDisabled(halted);
    } catch (err) {
      panel.setAlphabet(SYNTHETIC_ALPHABET);
      beltAlphabet = SYNTHETIC_ALPHABET;
      belt.clear();
      lastWorkerSnapshot = null;
      halted = true;
      report(`error: ${err.message}`, 'error');
      applyMode(idleMode());
      loadBtn.disabled = false;
      stepBtn.disabled = true;
      setRunDisabled(true);
    }
  }
  loadBtn.addEventListener('click', () => doLoad({ userInitiated: true }));
  doLoad();

  stepBtn.addEventListener('click', async () => {
    if (currentMode === MODE.RUNNING_AUTO) {
      stopAutoTimer();
      applyMode(MODE.RUNNING_STEP);
      report('paused');
      return;
    }
    if (currentMode !== MODE.RUNNING_STEP) {
      if (lastWorkerSnapshot) belt.setFromSnapshot(lastWorkerSnapshot);
      applyMode(MODE.RUNNING_STEP);
    }
    setBusy(true);
    try {
      const res = await runner.step();
      lastWorkerSnapshot = res.tape;
      halted = res.halted;
      if (res.halted) {
        report(`halted after ${res.stepsApplied} step(s)`, 'ok');
        applyMode(MODE.HALTED);
      } else {
        report(`step ${res.stepsApplied}: ${describeCommand(res.command)}`);
      }
      loadBtn.disabled = false;
      stepBtn.disabled = halted;
      setRunDisabled(halted);
      if (res.command) {
        panel.reflect(res.command);
        belt.apply(res.command, { animate: true });
        await sleep(BELT_ANIM_MS);
        if (res.nextCommand) {
          panel.reflect(res.nextCommand);
        }
      } else {
        belt.setFromSnapshot(res.tape);
      }
    } catch (err) {
      report(`error: ${err.message}`, 'error');
      halted = true;
      applyMode(MODE.HALTED);
      loadBtn.disabled = false;
      stepBtn.disabled = true;
      setRunDisabled(true);
    }
  });

  runBtn.addEventListener('click', async () => {
    if (withPauseCb.checked) {
      const intervalMs = parseInterval(intervalInput.value) ?? 1000;
      if (currentMode !== MODE.RUNNING_STEP) {
        if (lastWorkerSnapshot) belt.setFromSnapshot(lastWorkerSnapshot);
      }
      applyMode(MODE.RUNNING_AUTO);
      report(`auto-stepping every ${intervalMs}ms`);
      startAutoTimer(intervalMs);
      return;
    }
    if (lastWorkerSnapshot) belt.setFromSnapshot(lastWorkerSnapshot);
    panel.reflect(NEUTRAL_COMMAND);
    applyMode(MODE.RUNNING_CONTINUOUS);
    report('running…');
    setBusy(true);
    try {
      const res = await runner.run();
      lastWorkerSnapshot = res.tape;
      belt.setFromSnapshot(res.tape);
      halted = true;
      panel.reflect(NEUTRAL_COMMAND);
      if (res.commands && res.commands.length) {
        appendLogBatch(logEl, res.commands.map((cmd, i) => ({
          text: `step ${res.startSteps + i + 1}: ${describeCommand(cmd)}`,
        })));
      }
      if (res.truncated) {
        report(`truncated at ${res.stepsApplied} steps (limit hit)`, 'error');
      } else {
        report(`halted after ${res.stepsApplied} step(s)`, 'ok');
      }
      applyMode(MODE.HALTED);
      loadBtn.disabled = false;
      stepBtn.disabled = true;
      setRunDisabled(true);
    } catch (err) {
      report(`error: ${err.message}`, 'error');
      halted = true;
      panel.reflect(NEUTRAL_COMMAND);
      applyMode(MODE.HALTED);
      loadBtn.disabled = false;
      stepBtn.disabled = true;
      setRunDisabled(true);
    }
  });
}

function activateTab(mode) {
  const target = mode === 'post' ? 'post' : 'turing';
  document.querySelectorAll('#tabs button').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === target);
  });
  document.querySelectorAll('main .tab').forEach((sec) => {
    sec.classList.toggle('hidden', sec.dataset.mode !== target);
  });
  const url = new URL(window.location);
  if (target === 'turing') {
    url.searchParams.delete('machine');
  } else {
    url.searchParams.set('machine', target);
  }
  history.replaceState(null, '', url);
}

function wireTabs() {
  document.getElementById('tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tab]');
    if (btn) activateTab(btn.dataset.tab);
  });
  const initial = new URL(window.location).searchParams.get('machine');
  activateTab(initial);
}

document.querySelectorAll('main .tab').forEach(wireTab);
wireTabs();

const repoLink = document.querySelector('[data-role="repo-link"]');
if (repoLink) repoLink.innerHTML = icons.github;
