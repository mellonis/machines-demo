# Palette sandbox

Standalone HTML page for iterating on the state-graph color palette without rebuilding the demo. Serves the actual rendered SVG of a real machine, with all of `MachineGraph.svelte`'s CSS overrides applied — what you see here is what you'll get in production.

## Open

With Vite running (`npm run dev` in the repo root):

```
http://localhost:5173/docs/palette-sandbox/variant-a.html
```

Files:
- **`variant-a.html`** — the live sandbox (dual-pane + interactive picker)
- **`variant-b.html`** — older single-pane variant from the initial design pass (kept for reference)
- **`index.html`** — original template, baseline tokens (kept for reference)
- **`sample.svg`** — the machine graph being styled

For surrounding-UI visual context, open [demo.machines.mellonis.ru](https://demo.machines.mellonis.ru) (or `http://localhost:5173/turing` against a local dev server) in a sibling tab.

## Workflow

1. **Edit `<style id="tokens">` at the top of `variant-a.html`** to start from new values, or
2. **Use the picker panel at the bottom** to tweak interactively:
   - Each row shows a token name + a (swatch | hex) pair for the **dark** and **light** themes
   - **Derived tokens** (`var(...)` / `color-mix(...)`) render as read-only swatch divs with a tooltip showing the formula — picking would break the derivation chain
   - **Solid tokens** render as editable color inputs; picks write inline overrides scoped to the per-theme `.theme-X` container (a dark-side pick doesn't affect the light pane)
3. Click **"Toggle debugger pause"** to cycle through highlight states — paused regular state, paused tagged state, from→edge→to triple — applied to both panes simultaneously
4. Click **"Copy CSS (both themes)"** to snapshot current values into a `:root` + `:root[data-theme='light']` CSS snippet on your clipboard

## Replacing the sample machine

`sample.svg` is exported from the live Turing demo. To replace it with a different machine:

1. Open the demo at `http://localhost:5173/turing`
2. Paste your code into the editor (or set it via `localStorage.setItem('machines-demo:turing:code', '<code>')` then reload)
3. Click **Build**, then run this in DevTools:
   ```js
   const svg = document.querySelector('.svg-host svg').outerHTML;
   const blob = new Blob([svg], { type: 'image/svg+xml' });
   const a = document.createElement('a');
   a.href = URL.createObjectURL(blob);
   a.download = 'sample.svg';
   a.click();
   ```
4. Move `~/Downloads/sample.svg` into this folder

Pick a machine that exercises the structures you're styling:
- Multiple `wohs` levels → subgraph clusters (`callable subtree of …`)
- `.tag('main')` and `.tag('debug')` on different states → tagged-state styling
- A wrapper chain → thick `==>` call arrows + dotted `-. return .->` arrows
