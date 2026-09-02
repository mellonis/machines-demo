// Test-only: initialises the vendored wasm module from bytes under Node, once
// per process, the way the toolchains' own smoke script does.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as glue from '$mtc';

let ready: Promise<typeof glue> | null = null;

export function loadMtcForTests(): Promise<typeof glue> {
  if (!ready) {
    const wasmPath = fileURLToPath(new URL('../../../vendor/mtc-wasm/mtc_wasm_bg.wasm', import.meta.url));
    ready = glue.default({ module_or_path: readFileSync(wasmPath) }).then(() => glue);
  }
  return ready;
}
