/* Sync, pre-paint theme bootstrap. Loaded as a classic <script> in <head>
   so it runs before the SPA bundle and before first paint, preventing a
   flash between the default-rendered theme and the saved/preferred one.
   Lives in public/ rather than inline because the production CSP is
   `script-src 'self' 'unsafe-eval'` (no 'unsafe-inline').

   Two things happen here:

   1. Set <html data-theme>. CSS in app.css branches on this attribute and
      flips token values for the light theme.

   2. Paint <html> with the resolved theme's bg + fg via inline style.
      Production has its CSS link in <head> (render-blocking), so step 1
      alone is enough there. But `npm run dev` injects CSS via the JS
      module at runtime — between paint and that injection the body
      renders with browser-default white, then snaps to the dark theme
      once styles arrive. The inline style on documentElement covers that
      gap; once the real CSS loads, its rules on `html, body` override
      the inline value with the same tokens. Keep these literals in sync
      with the matching tokens in app.css. */
(function () {
  try {
    var saved = localStorage.getItem('machines-demo:theme');
    var prefersLight = window.matchMedia
      && window.matchMedia('(prefers-color-scheme: light)').matches;
    /* Saved choice is one of 'system' | 'dark' | 'light'. 'system' (and any
       missing/legacy value) resolves through prefers-color-scheme. The DOM
       attribute always carries a concrete 'dark' | 'light' so CSS selectors
       match without a system-aware fallback path. */
    var resolved = saved === 'dark' || saved === 'light'
      ? saved
      : (prefersLight ? 'light' : 'dark');
    var root = document.documentElement;
    root.setAttribute('data-theme', resolved);
    if (resolved === 'light') {
      root.style.backgroundColor = '#ffffff';
      root.style.color = '#1a1b1e';
    } else {
      root.style.backgroundColor = '#1a1b1e';
      root.style.color = '#e6e6e6';
    }
  } catch (_e) {
    /* localStorage may throw in private modes / sandboxed contexts —
       fall back to default (dark) by leaving the attribute unset. */
  }
})();
