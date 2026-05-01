import { icons } from './icons.js';

export const KEEP = Symbol.for('machines-demo.keep-current-symbol');

const MOVEMENTS = [
  ['L', icons.left, 'Move head left'],
  ['S', icons.stay, 'Stay (no head movement)'],
  ['R', icons.right, 'Move head right'],
];

export class ControlPanel {
  constructor(container, { onApply } = {}) {
    this.container = container;
    this.onApply = onApply;
    this.state = { movement: 'S', symbol: KEEP };
    this.alphabet = null;
    this.enabled = true;
    this.movementButtons = {};
    this.symbolChips = new Map();
    this.keepChip = null;
    this._build();
  }

  _build() {
    this.container.innerHTML = '';
    this.container.classList.add('control-panel');

    const interactive = document.createElement('div');
    interactive.className = 'cp-interactive';
    this.interactiveEl = interactive;
    this.container.appendChild(interactive);

    const movementRow = document.createElement('div');
    movementRow.className = 'cp-row cp-movement';
    MOVEMENTS.forEach(([code, svg, label]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cp-btn cp-mv';
      btn.dataset.movement = code;
      btn.innerHTML = svg;
      btn.title = label;
      btn.setAttribute('aria-label', label);
      btn.addEventListener('click', () => this._setMovement(code));
      movementRow.appendChild(btn);
      this.movementButtons[code] = btn;
    });

    const symbolRow = document.createElement('div');
    symbolRow.className = 'cp-row cp-symbols';
    this.symbolRowEl = symbolRow;

    const applyRow = document.createElement('div');
    applyRow.className = 'cp-row cp-apply-row';
    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.className = 'cp-btn cp-apply';
    applyBtn.innerHTML = icons.apply;
    applyBtn.title = 'Apply';
    applyBtn.setAttribute('aria-label', 'Apply');
    applyBtn.addEventListener('click', () => this._fireApply());
    applyRow.appendChild(applyBtn);
    this.applyBtn = applyBtn;

    this.interactiveEl.appendChild(movementRow);
    this.interactiveEl.appendChild(symbolRow);
    this.interactiveEl.appendChild(applyRow);

    this._renderHighlights();
  }

  setAlphabet(symbols) {
    this.alphabet = symbols ? [...symbols] : null;
    this.symbolRowEl.innerHTML = '';
    this.symbolChips.clear();
    this.keepChip = null;
    if (!symbols) return;

    const keepChip = document.createElement('button');
    keepChip.type = 'button';
    keepChip.className = 'cp-btn cp-sym cp-keep';
    keepChip.innerHTML = icons.keep;
    keepChip.title = 'Keep current symbol';
    keepChip.setAttribute('aria-label', 'Keep current symbol');
    keepChip.addEventListener('click', () => this._setSymbol(KEEP));
    this.symbolRowEl.appendChild(keepChip);
    this.keepChip = keepChip;

    symbols.forEach((sym, i) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'cp-btn cp-sym';
      chip.dataset.symbol = sym;
      chip.textContent = i === 0 ? '␣' : sym;
      const label = i === 0 ? 'Write blank' : `Write ${sym}`;
      chip.title = label;
      chip.setAttribute('aria-label', label);
      chip.addEventListener('click', () => this._setSymbol(sym));
      this.symbolRowEl.appendChild(chip);
      this.symbolChips.set(sym, chip);
    });

    this._renderHighlights();
  }

  setEnabled(on) {
    this.enabled = on;
    this.container.classList.toggle('disabled', !on);
  }

  setVisible(on) {
    this.container.classList.toggle('hidden', !on);
  }

  setApplyVisible(on) {
    this.container.classList.toggle('no-apply', !on);
  }

  flashApply() {
    if (!this.applyBtn) return;
    this.applyBtn.classList.add('pressed');
    if (this._flashTimer) clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => {
      this.applyBtn.classList.remove('pressed');
      this._flashTimer = null;
    }, 240);
  }

  reflect({ movement, symbol }) {
    if (movement) this.state.movement = movement;
    this.state.symbol = symbol === undefined || symbol === null ? KEEP : symbol;
    this._renderHighlights();
  }

  _setMovement(code) {
    if (!this.enabled) return;
    this.state.movement = code;
    this._renderHighlights();
  }

  _setSymbol(sym) {
    if (!this.enabled) return;
    this.state.symbol = sym;
    this._renderHighlights();
  }

  _fireApply() {
    if (!this.enabled || !this.onApply) return;
    this.onApply({
      movement: this.state.movement,
      symbol: this.state.symbol === KEEP ? undefined : this.state.symbol,
    });
  }

  _renderHighlights() {
    Object.entries(this.movementButtons).forEach(([code, btn]) => {
      btn.classList.toggle('selected', code === this.state.movement);
    });
    if (this.keepChip) {
      this.keepChip.classList.toggle('selected', this.state.symbol === KEEP);
    }
    this.symbolChips.forEach((chip, sym) => {
      chip.classList.toggle('selected', this.state.symbol === sym);
    });
  }
}
