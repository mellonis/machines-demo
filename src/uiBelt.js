// Virtualized UI belt: head fixed at viewport center, belt slides under it.
// Phase A: setFromSnapshot snaps without animation. The transition class is
// wired so later phases can flip it on for sliding.

const VISIBLE_CELLS = 15;          // odd; head sits at the exact middle
const BUFFER_CELLS = 2;             // extra cells off-screen on each side
const TOTAL_CELLS = VISIBLE_CELLS + BUFFER_CELLS * 2;
const MIDDLE_INDEX = (TOTAL_CELLS - 1) / 2;
const CELL_WIDTH = 32;
const CELL_GAP = 4;
const FADE_CELLS = 2.5;

const VIEWPORT_WIDTH_PX = VISIBLE_CELLS * CELL_WIDTH + (VISIBLE_CELLS - 1) * CELL_GAP;
const FADE_PX = FADE_CELLS * (CELL_WIDTH + CELL_GAP);

export class UiBelt {
  constructor(container) {
    this.container = container;
    this.cells = [];
    this.symbols = [];
    this.head = 0;
    this.blank = ' ';
    this._build();
  }

  _build() {
    this.container.innerHTML = '';
    this.container.classList.add('ui-belt');

    const viewport = document.createElement('div');
    viewport.className = 'ui-belt-viewport';
    viewport.style.setProperty('--ui-belt-width', `${VIEWPORT_WIDTH_PX}px`);
    viewport.style.setProperty('--ui-belt-fade', `${FADE_PX}px`);

    const center = document.createElement('div');
    center.className = 'ui-belt-center';

    const strip = document.createElement('div');
    strip.className = 'ui-belt-strip';
    for (let i = 0; i < TOTAL_CELLS; i += 1) {
      const cell = document.createElement('div');
      cell.className = 'ui-belt-cell';
      const sym = document.createElement('span');
      sym.className = 'ui-belt-sym';
      cell.appendChild(sym);
      strip.appendChild(cell);
      this.cells.push(cell);
    }
    center.appendChild(strip);
    viewport.appendChild(center);

    const caret = document.createElement('div');
    caret.className = 'ui-belt-caret';
    viewport.appendChild(caret);

    this.container.appendChild(viewport);
    this.viewport = viewport;
    this.strip = strip;

    this._renderCells();
  }

  setFromSnapshot(snapshot) {
    if (!snapshot) {
      this.symbols = [];
      this.head = 0;
      this._renderCells();
      return;
    }
    this.symbols = [...snapshot.symbols];
    this.head = snapshot.position;
    this.blank = snapshot.blank;
    this._renderCells();
  }

  clear() {
    this.symbols = [];
    this.head = 0;
    this._renderCells();
  }

  apply({ symbol, movement }, { animate = false } = {}) {
    const delta = movement === 'L' ? -1 : movement === 'R' ? +1 : 0;
    if (symbol !== undefined && symbol !== null) {
      this.symbols[this.head] = symbol;
    }
    this.head += delta;
    this._renderCells();
    if (!animate || delta === 0) return;
    this.strip.classList.remove('transitions-on');
    this.strip.style.transform = `translateX(calc(${delta} * var(--pitch)))`;
    void this.strip.offsetWidth;
    this.strip.classList.add('transitions-on');
    this.strip.style.transform = 'translateX(0)';
  }

  setTransitionsEnabled(on) {
    if (on) {
      this.strip.classList.add('transitions-on');
    } else {
      this.strip.classList.remove('transitions-on');
      this.strip.style.transform = 'translateX(0)';
    }
  }

  _renderCells() {
    for (let i = 0; i < TOTAL_CELLS; i += 1) {
      const offset = i - MIDDLE_INDEX;
      const abs = this.head + offset;
      const raw = this.symbols[abs];
      const isOutOfRange = raw === undefined;
      const isBlank = isOutOfRange || raw === this.blank;
      const display = isBlank ? '␣' : raw;
      const cell = this.cells[i];
      cell.querySelector('.ui-belt-sym').textContent = display;
      cell.classList.toggle('blank', isBlank);
      cell.classList.toggle('out-of-range', isOutOfRange);
    }
  }
}
