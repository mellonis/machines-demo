import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { fetchBundle } from './fetch-toolchains-wasm.mjs';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

/** Builds a tarball with the bundle's file names and returns { tarPath, hashes }. */
function makeFixture(dir, corrupt = false) {
  const inner = join(dir, 'machine-toolchains-wasm-v9.9.9');
  mkdirSync(inner, { recursive: true });
  const files = {
    'mtc_wasm_bg.wasm': Buffer.from('\0asm-fake'),
    'mtc_wasm.js': Buffer.from('export default async function init() {}\n'),
    'mtc_wasm.d.ts': Buffer.from('export {};\n'),
  };
  for (const [name, buf] of Object.entries(files)) writeFileSync(join(inner, name), buf);
  const manifest = { toolchains_version: '9.9.9', files: Object.fromEntries(Object.entries(files).map(([n, b]) => [n, sha(b)])) };
  const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(join(inner, 'manifest.json'), manifestBuf);
  const hashes = { ...manifest.files, 'manifest.json': sha(manifestBuf) };
  if (corrupt) hashes['mtc_wasm.js'] = '0'.repeat(64);
  const tarPath = join(dir, 'machine-toolchains-wasm-v9.9.9.tar.gz');
  execFileSync('tar', ['czf', tarPath, '-C', dir, 'machine-toolchains-wasm-v9.9.9']);
  return { tarPath, hashes };
}

function serve(tarPath) {
  let hits = 0;
  const server = createServer((req, res) => { hits++; res.writeHead(200); res.end(readFileSync(tarPath)); });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    resolve({ url: `http://127.0.0.1:${port}/bundle.tar.gz`, hits: () => hits, close: () => server.close() });
  }));
}

test('T-fetch-good: verified download lands the four files', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mtc-'));
  const { tarPath, hashes } = makeFixture(dir);
  const srv = await serve(tarPath);
  const out = join(dir, 'vendor');
  const log = [];
  await fetchBundle({ url: srv.url, files: hashes, outDir: out, log: (m) => log.push(m) });
  assert.ok(existsSync(join(out, 'mtc_wasm.js')));
  assert.ok(existsSync(join(out, 'manifest.json')));
  assert.equal(srv.hits(), 1);
  srv.close(); rmSync(dir, { recursive: true });
});

test('T-fetch-corrupt: a hash mismatch fails naming the file and leaves no vendor dir', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mtc-'));
  const { tarPath, hashes } = makeFixture(dir, true);
  const srv = await serve(tarPath);
  const out = join(dir, 'vendor');
  await assert.rejects(
    fetchBundle({ url: srv.url, files: hashes, outDir: out, log: () => {} }),
    /mtc_wasm\.js/,
  );
  assert.ok(!existsSync(join(out, 'mtc_wasm.js')));
  srv.close(); rmSync(dir, { recursive: true });
});

test('T-fetch-noop: a verified cache makes no network request', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mtc-'));
  const { tarPath, hashes } = makeFixture(dir);
  const srv = await serve(tarPath);
  const out = join(dir, 'vendor');
  await fetchBundle({ url: srv.url, files: hashes, outDir: out, log: () => {} });
  const log = [];
  await fetchBundle({ url: srv.url, files: hashes, outDir: out, log: (m) => log.push(m) });
  assert.equal(srv.hits(), 1);
  assert.ok(log.some((m) => /already verified/.test(m)));
  srv.close(); rmSync(dir, { recursive: true });
});

test('T-fetch-override: MTC_WASM_DIR copies without hashing and warns', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mtc-'));
  const { hashes } = makeFixture(dir);
  const src = join(dir, 'machine-toolchains-wasm-v9.9.9');
  writeFileSync(join(src, 'mtc_wasm.js'), 'export default 1;\n'); // now differs from the pinned hash
  const out = join(dir, 'vendor');
  const log = [];
  await fetchBundle({ url: 'http://127.0.0.1:1/unused', files: hashes, outDir: out, overrideDir: src, log: (m) => log.push(m) });
  assert.equal(readFileSync(join(out, 'mtc_wasm.js'), 'utf8'), 'export default 1;\n');
  assert.ok(log.some((m) => /WARNING/.test(m)));
  rmSync(dir, { recursive: true });
});
