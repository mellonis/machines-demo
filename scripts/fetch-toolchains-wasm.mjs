#!/usr/bin/env node
// Fetches the machine-toolchains wasm bundle pinned in toolchains-wasm.json
// into vendor/mtc-wasm/, verifying every file's SHA-256 against the pin.
// No-op when the cached directory already verifies. MTC_WASM_DIR=<dir>
// copies an unpacked local bundle instead (no hash check; warns).
//
//   node scripts/fetch-toolchains-wasm.mjs          # used by `postinstall`
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = 'mellonis/machine-toolchains';
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const VENDOR_DIR = join(ROOT, 'vendor', 'mtc-wasm');
export const PIN_PATH = join(ROOT, 'toolchains-wasm.json');

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** Returns the first file name whose hash differs, or null when all verify. */
function firstMismatch(dir, files) {
  for (const [name, expected] of Object.entries(files)) {
    const p = join(dir, name);
    if (!existsSync(p)) return name;
    if (sha256(p) !== expected) return name;
  }
  return null;
}

export function releaseUrl(tag) {
  return `https://github.com/${REPO}/releases/download/${tag}/machine-toolchains-wasm-${tag}.tar.gz`;
}

/**
 * @param {{ url: string, files: Record<string,string>, outDir: string, overrideDir?: string, log: (m: string) => void }} opts
 */
export async function fetchBundle({ url, files, outDir, overrideDir, log }) {
  if (overrideDir) {
    log(`WARNING: MTC_WASM_DIR=${overrideDir} — copying an unverified local bundle (hashes not checked)`);
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    for (const name of Object.keys(files)) cpSync(join(overrideDir, name), join(outDir, name));
    return;
  }
  if (existsSync(outDir) && firstMismatch(outDir, files) === null) {
    log(`toolchains wasm bundle already verified in ${outDir}`);
    return;
  }
  log(`fetching ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText} for ${url}`);
  const tmp = mkdtempSync(join(tmpdir(), 'mtc-wasm-'));
  try {
    const tar = join(tmp, 'bundle.tar.gz');
    writeFileSync(tar, Buffer.from(await res.arrayBuffer()));
    execFileSync('tar', ['xzf', tar, '-C', tmp]);
    // The tarball unpacks to one directory; find the one holding manifest.json.
    const unpacked = readdirSync(tmp)
      .map((n) => join(tmp, n))
      .find((p) => statSync(p).isDirectory() && existsSync(join(p, 'manifest.json')));
    if (!unpacked) throw new Error('tarball holds no directory with manifest.json');
    const bad = firstMismatch(unpacked, files);
    if (bad !== null) throw new Error(`checksum mismatch for ${bad} — the pin in toolchains-wasm.json does not match the downloaded bundle`);
    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(dirname(outDir), { recursive: true });
    cpSync(unpacked, outDir, { recursive: true });
    for (const name of Object.keys(files)) log(`verified ${name}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const pin = JSON.parse(readFileSync(PIN_PATH, 'utf8'));
  fetchBundle({
    url: releaseUrl(pin.tag),
    files: pin.files,
    outDir: VENDOR_DIR,
    overrideDir: process.env.MTC_WASM_DIR || undefined,
    log: (m) => console.log(`[fetch-toolchains-wasm] ${m}`),
  }).catch((err) => { console.error(`[fetch-toolchains-wasm] ${err.message}`); process.exit(1); });
}
