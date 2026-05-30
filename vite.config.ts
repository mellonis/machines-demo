import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync } from 'node:fs';

const pkgVersion = (pkg: string): string =>
  JSON.parse(readFileSync(`./node_modules/${pkg}/package.json`, 'utf-8')).version;

const VIRTUAL_ID = 'virtual:lib-versions';

const appVersion = (): string =>
  JSON.parse(readFileSync('./package.json', 'utf-8')).version;

const libVersions = (): Plugin => ({
  name: 'lib-versions',
  resolveId(id) {
    if (id === VIRTUAL_ID) return `\0${VIRTUAL_ID}`;
  },
  load(id) {
    if (id !== `\0${VIRTUAL_ID}`) return;
    const turing = pkgVersion('@turing-machine-js/machine');
    const post = pkgVersion('@post-machine-js/machine');
    const visuals = pkgVersion('@turing-machine-js/visuals');
    const app = appVersion();
    return `export const turingVersion = ${JSON.stringify(turing)};
export const postVersion = ${JSON.stringify(post)};
export const visualsVersion = ${JSON.stringify(visuals)};
export const appVersion = ${JSON.stringify(app)};
`;
  },
});

export default defineConfig({
  plugins: [svelte(), libVersions()],
});
