// Thin Web Worker shell: initialises the wasm module once, then forwards
// every request to a ToolchainCore. The Vite `?worker` import lives in
// ToolchainView.svelte; this file stays plain TypeScript.
import init, * as mtc from '$mtc';
import { ToolchainCore } from './workerCore.ts';
import type { ToolchainRequest } from './types.ts';

// The glue resolves `mtc_wasm_bg.wasm` relative to itself via
// `new URL(…, import.meta.url)`, which Vite turns into a hashed asset.
const ready: Promise<ToolchainCore> = init().then(
  () =>
    new ToolchainCore(mtc, {
      post: (r) => self.postMessage(r),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      yieldTurn: () => new Promise((resolve) => setTimeout(resolve, 0)),
      now: () => performance.now(),
    }),
);

// A module that never loaded (a 404 on the hashed wasm asset, a MIME or CSP
// refusal — `docs/wasm.md (failure modes)`) must answer every request with a
// readable fatal error; without this the requests hang and the main thread's
// only signal is a watchdog timeout blaming the user's program.
let initError: string | null = null;
ready.catch((err: unknown) => {
  initError = `toolchain module failed to load: ${err instanceof Error ? err.message : String(err)}`;
});

self.onmessage = (e: MessageEvent<ToolchainRequest>) => {
  void ready.then(
    (core) => core.handle(e.data),
    () => self.postMessage({ type: 'error', fatal: true, message: initError ?? 'toolchain module failed to load' }),
  );
};
