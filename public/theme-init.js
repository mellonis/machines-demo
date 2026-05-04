/* Sync, pre-paint theme bootstrap. Loaded as a classic <script> in <head>
   so it runs before the SPA bundle and before first paint, preventing a
   flash between the default-rendered theme and the saved/preferred one.
   Lives in public/ rather than inline because the production CSP is
   `script-src 'self' 'unsafe-eval'` (no 'unsafe-inline'). */
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
    document.documentElement.setAttribute('data-theme', resolved);
  } catch (_e) {
    /* localStorage may throw in private modes / sandboxed contexts —
       fall back to default (dark) by leaving the attribute unset. */
  }
})();
