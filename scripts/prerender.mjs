// Prerenders the single page into dist/index.html after both Vite builds have run,
// so the hero text paints before any JavaScript loads. The client then hydrates it.
import { readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = path.join(root, 'dist', 'index.html');
const ssrDir = path.join(root, 'dist-ssr');
const PLACEHOLDER = '<!--app-html-->';

const { render } = await import(pathToFileURL(path.join(ssrDir, 'entry-server.js')).href);
const template = await readFile(htmlPath, 'utf8');

if (!template.includes(PLACEHOLDER)) {
  throw new Error(`Prerender placeholder ${PLACEHOLDER} not found in dist/index.html`);
}

await writeFile(htmlPath, template.replace(PLACEHOLDER, render()));
await rm(ssrDir, { recursive: true, force: true });

console.log('Prerendered dist/index.html');
