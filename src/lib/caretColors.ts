/** Per-tape caret palette — the same five colors as MachineView.svelte's
 *  CARET_COLORS. It covers the JS engines' MAX_TAPES (lib/caps.ts) outright;
 *  `TapesStack` / `ControlPanel` repeat it modulo its length for the
 *  toolchain engines, where a TM-1 world may declare up to sixteen bands. */
export const CARET_COLORS: readonly string[] = ['#6ea8fe', '#ff6b6b', '#5fd068', '#c084fc', '#ffd166'];
